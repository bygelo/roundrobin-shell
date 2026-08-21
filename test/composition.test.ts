// K36's composition-neutrality claim, as a pure function.
//
// The same PACK_VIEW and the same deriveNavigation produce two different
// operator UIs from two capability payloads — F&B has no booking, court has
// booking and no form. No file is edited between them because there is nothing
// to edit: the shell hardcodes how to render a pack, and discovery decides
// which packs render.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ModuleDeclaration } from '@bygelo/roundrobin-kernel'
import { COURT_COMPOSITION, FNB_COMPOSITION } from '../dev/composition.ts'
import { deriveNavigation, isReachable, type Capability } from '../src/navigation.ts'

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111'

function capabilityOf(declaration: ModuleDeclaration[], held: string[]): Capability {
  return {
    organization_id: ORGANIZATION_ID,
    module: declaration.map((one) => ({
      module_code: one.module_code,
      is_enabled: true,
      schema_version: one.schema_version,
      is_upgrade_pending: false,
      route_prefix: [...one.route_prefix],
    })),
    capability: held,
  }
}

const FNB_HELD = [
  'commerce.read',
  'commerce.write',
  'billing.read',
  'notification.read',
]
const COURT_HELD = [
  'booking.read',
  'booking.write',
  'billing.read',
  'membership.read',
  'commerce.read',
  'notification.read',
]

describe('two compositions from one shell', () => {
  it('names the F&B and court pack sets the roadmap named', () => {
    assert.deepEqual(
      FNB_COMPOSITION.declaration.map((one) => one.module_code).sort(),
      ['billing', 'commerce', 'notification'],
    )
    assert.deepEqual(
      COURT_COMPOSITION.declaration.map((one) => one.module_code).sort(),
      ['billing', 'booking', 'commerce', 'membership', 'notification'],
    )
  })

  it('draws F&B as commerce, billing, notification — and not booking', () => {
    const navigation = deriveNavigation(capabilityOf(FNB_COMPOSITION.declaration, FNB_HELD))
    assert.deepEqual(navigation.item.map((one) => one.module_code).sort(), [
      'billing',
      'commerce',
      'notification',
    ])
    assert.deepEqual(navigation.undrawn_module_code, [])
    assert.equal(isReachable(navigation, '/api/v1/booking'), false)
    assert.equal(isReachable(navigation, '/api/v1/order'), true)
  })

  it('draws court with booking, and still without form', () => {
    const navigation = deriveNavigation(capabilityOf(COURT_COMPOSITION.declaration, COURT_HELD))
    assert.deepEqual(navigation.item.map((one) => one.module_code).sort(), [
      'billing',
      'booking',
      'commerce',
      'membership',
      'notification',
    ])
    assert.ok(navigation.item.some((one) => one.module_code === 'booking'))
    assert.equal(
      navigation.item.some((one) => one.module_code === 'form'),
      false,
    )
    assert.equal(isReachable(navigation, '/api/v1/booking'), true)
    assert.equal(isReachable(navigation, '/api/v1/form'), false)
  })

  it('hides Take an order when the session cannot write commerce', () => {
    const owner = deriveNavigation(capabilityOf(FNB_COMPOSITION.declaration, FNB_HELD))
    const clerk = deriveNavigation(
      capabilityOf(FNB_COMPOSITION.declaration, ['commerce.read', 'billing.read', 'notification.read']),
    )

    const take = (navigation: ReturnType<typeof deriveNavigation>) =>
      navigation.item
        .find((one) => one.module_code === 'commerce')
        ?.action.some((one) => one.action_code === 'commerce.order')

    assert.equal(take(owner), true)
    assert.equal(take(clerk), false, 'a visible button that 403s is the thing this forbids')
  })
})
