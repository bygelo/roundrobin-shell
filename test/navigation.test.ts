// What the shell shows, and — more importantly — what it refuses to show.
//
// deriveNavigation is pure, so the central claim of this repo is testable with
// no server, no database, and no browser. That is the reason it was written
// pure: the claim IS the product, and a claim you can only check by clicking
// around is not one you check.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PACK_VIEW, deriveNavigation, isReachable, type Capability } from '../src/navigation.ts'

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111'

function capability(input: {
  module?: { code: string; on?: boolean; route?: string[]; pending?: boolean }[]
  held?: string[]
}): Capability {
  return {
    organization_id: ORGANIZATION_ID,
    module: (input.module ?? []).map((one) => ({
      module_code: one.code,
      is_enabled: one.on ?? true,
      schema_version: 1,
      is_upgrade_pending: one.pending ?? false,
      route_prefix: (one.on ?? true) ? (one.route ?? [`/api/v1/${one.code}`]) : [],
    })),
    capability: input.held ?? [],
  }
}

describe('navigation follows discovery', () => {
  // THE test. This is the phase-1 claim in one assertion: the surface is a
  // function of what the server says, so a tenant toggling a module changes the
  // interface with nothing deployed.
  it('drops a module from the nav when the tenant disables it', () => {
    const held = ['booking.read', 'billing.read']

    const both = deriveNavigation(
      capability({ module: [{ code: 'booking' }, { code: 'billing' }], held }),
    )
    assert.deepEqual(
      both.item.map((one) => one.module_code),
      ['booking', 'billing'],
    )

    const off = deriveNavigation(
      capability({ module: [{ code: 'booking' }, { code: 'billing', on: false }], held }),
    )
    assert.deepEqual(
      off.item.map((one) => one.module_code),
      ['booking'],
      'the same shell, the same session, a different answer from the server',
    )
  })

  it('shows nothing for a module this session cannot read', () => {
    const navigation = deriveNavigation(
      capability({ module: [{ code: 'booking' }, { code: 'billing' }], held: ['booking.read'] }),
    )
    assert.deepEqual(navigation.item.map((one) => one.module_code), ['booking'])
  })

  // Silence, not a disabled-looking entry. The server returns 404 rather than
  // 403 for a disabled module precisely so an outsider cannot learn which
  // modules a tenant runs; a greyed-out "Billing" would hand back exactly what
  // that 404 withholds.
  it('does not hint at a module it is hiding', () => {
    const navigation = deriveNavigation(
      capability({ module: [{ code: 'billing' }], held: [] }),
    )
    assert.deepEqual(navigation.item, [])
    assert.deepEqual(navigation.undrawn_module_code, [], 'a hidden module is not reported as undrawn')
  })

  it('renders only the actions this session holds', () => {
    const navigation = deriveNavigation(
      capability({ module: [{ code: 'booking' }], held: ['booking.read', 'booking.write'] }),
    )
    assert.deepEqual(
      navigation.item[0]?.action.map((one) => one.action_code),
      ['booking.hold'],
      'booking.manage was not held, so Configure does not render',
    )
  })

  it('reports a module it has no screens for instead of dropping it', () => {
    const navigation = deriveNavigation(
      capability({ module: [{ code: 'booking' }, { code: 'court' }], held: ['booking.read'] }),
    )
    assert.deepEqual(navigation.item.map((one) => one.module_code), ['booking'])
    assert.deepEqual(
      navigation.undrawn_module_code,
      ['court'],
      'an app module with no view is a gap in the shell, not a fact about the tenant',
    )
  })

  it('honours the app order, and does not punish an app for omitting a pack', () => {
    const navigation = deriveNavigation(
      capability({
        module: [{ code: 'booking' }, { code: 'billing' }, { code: 'form' }],
        held: ['booking.read', 'billing.read', 'form.read'],
      }),
      { navigation_order: ['form', 'billing'] },
    )
    assert.deepEqual(
      navigation.item.map((one) => one.module_code),
      ['form', 'billing', 'booking'],
      'listed packs first in the order given; the rest follow in registry order',
    )
  })

  it('lets the app rename a pack without the OS knowing', () => {
    const navigation = deriveNavigation(
      capability({ module: [{ code: 'booking' }], held: ['booking.read'] }),
      { label: { booking: 'Appointment' } },
    )
    assert.equal(navigation.item[0]?.display_name, 'Appointment')
  })

  it('carries the upgrade-pending flag through rather than hiding it', () => {
    const navigation = deriveNavigation(
      capability({ module: [{ code: 'booking', pending: true }], held: ['booking.read'] }),
    )
    assert.equal(navigation.item[0]?.is_upgrade_pending, true)
  })

  it('knows which paths are worth attempting', () => {
    const navigation = deriveNavigation(
      capability({
        module: [{ code: 'booking', route: ['/api/v1/availability', '/api/v1/booking'] }],
        held: ['booking.read'],
      }),
    )
    assert.equal(isReachable(navigation, '/api/v1/availability?starts_at=x'), true)
    assert.equal(isReachable(navigation, '/api/v1/invoice'), false)
  })
})

describe('the pack registry', () => {
  it('has one entry per pack, with no duplicate module_code', () => {
    const code = PACK_VIEW.map((one) => one.module_code)
    assert.equal(new Set(code).size, code.length)
  })

  // Every capability named here must be one a pack actually declares. A typo
  // is invisible at runtime: the button simply never renders, and nobody files
  // a bug about a feature they never saw.
  it('names capabilities in the pack.verb shape the OS uses', () => {
    for (const view of PACK_VIEW) {
      assert.match(view.read_capability, /^[a-z]+\.[a-z_]+$/, view.module_code)
      assert.ok(
        view.read_capability.startsWith(`${view.module_code}.`),
        `${view.module_code} reads a capability belonging to another pack`,
      )
      for (const action of view.action) {
        assert.ok(
          action.capability.startsWith(`${view.module_code}.`),
          `${action.action_code} is gated on a capability from another pack`,
        )
      }
    }
  })
})
