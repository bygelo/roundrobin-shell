// The assembly — the layer nobody had ever watched.
//
// Between the pure logic (covered) and the DOM primitive (covered) sat the code
// that decides which button appears next to what. That layer produces no error
// when it is wrong; it produces a page missing a control, and a missing control
// is a bug nobody reports because nobody saw it. These tests put the shell into
// states that would be tedious to provoke against a live server and impossible
// to hold still — a lapsed hold, a contested slot, a read-only session — and
// assert what a person would actually see.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from '../src/dom.ts'
import { deriveNavigation, type Capability } from '../src/navigation.ts'
import {
  renderBoard,
  renderDiscovery,
  renderFailure,
  renderNavigation,
  renderNotBuilt,
  renderSignIn,
  type BoardState,
} from '../src/render.ts'
import { describeFailure } from '../src/view/failure.ts'
import { DiscoveryError } from '../src/discovery.ts'
import type { Booking, Slot } from '../src/view/booking.ts'
import { buttonLabel, byClass, byTag, fire, stubDocument, textOf } from './stub-dom.ts'

const element = createElement(stubDocument())
const ZONE = 'Asia/Manila'
const NOW = new Date('2027-04-01T00:00:00.000Z')

const NOOP = {
  onHold: () => {},
  onConfirm: () => {},
  onCancel: () => {},
  onBack: () => {},
}

function slot(over: Partial<Slot> = {}): Slot {
  return {
    session_id: 's',
    resource_id: 'court-1',
    resource_code: 'court-1',
    display_name: 'Court 1',
    starts_at: '2027-04-01T02:00:00.000Z',
    ends_at: '2027-04-01T03:00:00.000Z',
    price_amount: '500.00',
    session_type: 'private',
    ...over,
  }
}

function booking(over: Partial<Booking> = {}): Booking {
  return {
    booking_id: 'b',
    booking_code: 'ABC123',
    status: 'hold',
    starts_at: '2027-04-01T02:00:00.000Z',
    ends_at: '2027-04-01T03:00:00.000Z',
    price_amount: '500.00',
    hold_expire_at: '2027-04-01T00:10:00.000Z',
    session_id: 's',
    resource_id: 'court-1',
    session_type: 'private',
    ...over,
  }
}

function board(over: Partial<BoardState> = {}): BoardState {
  return {
    status: 'ready',
    column: [{ resource_id: 'court-1', resource_code: 'court-1', display_name: 'Court 1', slot: [slot()] }],
    held: null,
    zone: ZONE,
    day: '2027-04-01T00:00:00.000Z',
    now: NOW,
    ...over,
  }
}

function capability(module_code: string[], held: string[]): Capability {
  return {
    organization_id: 'org-1',
    module: module_code.map((code) => ({
      module_code: code,
      is_enabled: true,
      schema_version: 1,
      is_upgrade_pending: false,
      route_prefix: [`/api/v1/${code}`],
    })),
    capability: held,
  }
}

describe('sign in renders', () => {
  it('draws the three fields the route requires and nothing else', () => {
    const tree = renderSignIn(element, { brand: 'Venue' }, { onSubmit: () => {} })
    assert.deepEqual(
      byTag(tree, 'input').map((one) => one.attribute['name']),
      ['organization_code', 'actor_code', 'secret'],
    )
  })

  it('masks the secret', () => {
    const tree = renderSignIn(element, { brand: 'Venue' }, { onSubmit: () => {} })
    const secret = byTag(tree, 'input').find((one) => one.attribute['name'] === 'secret')
    assert.equal(secret?.attribute['type'], 'password')
  })

  it('shows no error line until there is an error', () => {
    const clean = renderSignIn(element, { brand: 'Venue' }, { onSubmit: () => {} })
    assert.equal(byClass(clean, 'error').length, 0, 'an empty error paragraph is still a visible gap')

    const failed = renderSignIn(element, { brand: 'Venue', message: 'nope' }, { onSubmit: () => {} })
    assert.equal(byClass(failed, 'error').length, 1)
  })

  it('submits through the handler it was given', () => {
    let submitted = false
    const tree = renderSignIn(element, { brand: 'Venue' }, { onSubmit: () => (submitted = true) })
    fire(tree as never, 'submit')
    assert.equal(submitted, true)
  })
})

describe('navigation renders', () => {
  it('draws one button per module, plus sign out', () => {
    const navigation = deriveNavigation(
      capability(['booking', 'billing'], ['booking.read', 'billing.read']),
    )
    const tree = renderNavigation(element, { brand: 'Venue', navigation }, {
      onSelect: () => {},
      onSignOut: () => {},
    })

    assert.deepEqual(buttonLabel(tree), ['Booking', 'Billing', 'Sign out'])
  })

  it('selects the item the button belongs to', () => {
    const navigation = deriveNavigation(
      capability(['booking', 'billing'], ['booking.read', 'billing.read']),
    )
    let chosen = ''
    const tree = renderNavigation(element, { brand: 'Venue', navigation }, {
      onSelect: (item) => (chosen = item.module_code),
      onSignOut: () => {},
    })

    // The second nav button, not the first — a closure capturing the loop
    // variable wrongly would send every button to the same module.
    fire(byClass(tree, 'nav-item')[1]!)
    assert.equal(chosen, 'billing')
  })

  it('flags a module whose migrations are behind', () => {
    const payload = capability(['booking'], ['booking.read'])
    payload.module[0]!.is_upgrade_pending = true
    const navigation = deriveNavigation(payload)
    const tree = renderNavigation(element, { brand: 'Venue', navigation }, {
      onSelect: () => {},
      onSignOut: () => {},
    })
    assert.equal(byClass(tree, 'pill').length, 1)
  })
})

describe('discovery renders', () => {
  // A read-only session must not be shown buttons it cannot use. Not disabled —
  // absent.
  it('draws no action button for a session that may only read', () => {
    const navigation = deriveNavigation(capability(['booking'], ['booking.read']))
    const tree = element('div', {}, renderDiscovery(element, navigation))

    assert.equal(buttonLabel(tree).length, 0)
    assert.match(textOf(tree), /read only for this session/)
  })

  it('draws exactly the actions the session holds', () => {
    const navigation = deriveNavigation(capability(['booking'], ['booking.read', 'booking.write']))
    const tree = element('div', {}, renderDiscovery(element, navigation))

    assert.deepEqual(buttonLabel(tree), ['Book a slot'], 'Configure needs booking.manage')
  })

  it('names a module it cannot draw rather than staying silent about it', () => {
    const navigation = deriveNavigation(capability(['booking', 'court'], ['booking.read']))
    const tree = element('div', {}, renderDiscovery(element, navigation))

    assert.equal(byClass(tree, 'warn').length, 1)
    assert.match(textOf(tree), /no screens for: court/)
  })

  it('says nothing about a module it is hiding', () => {
    const navigation = deriveNavigation(capability(['booking', 'billing'], ['booking.read']))
    const tree = element('div', {}, renderDiscovery(element, navigation))

    assert.doesNotMatch(textOf(tree), /Billing/, 'a hidden module leaks nothing, not even its name')
  })
})

describe('a refusal renders', () => {
  // THE styling decision. A contested slot is the guarantee working; painting
  // it red teaches an operator the system is broken when it is not.
  it('draws a conflict as news, not as an error', () => {
    const failure = describeFailure(
      new DiscoveryError('that resource is already taken for this time.', 409),
    )
    const tree = renderFailure(element, failure)

    assert.equal(tree.className, 'notice')
    assert.notEqual(tree.className, 'error-box')
    assert.match(textOf(tree), /Someone got there first/)
    assert.doesNotMatch(textOf(tree), /\b409\b/)
  })

  it('draws a rejected request as an error', () => {
    const failure = describeFailure(new DiscoveryError('session_id is required', 400))
    assert.equal(renderFailure(element, failure).className, 'error-box')
  })
})

describe('the booking board renders', () => {
  it('draws a slot button per availability, priced', () => {
    const tree = element('div', {}, renderBoard(element, { display_name: 'Booking', state: board() }, NOOP))
    const button = byClass(tree, 'slot')

    assert.equal(button.length, 1)
    assert.match(textOf(button[0]), /10:00/, 'Asia/Manila is UTC+8, so 02:00Z reads as 10:00')
    assert.match(textOf(button[0]), /₱500\.00/)
  })

  it('holds the slot the button belongs to', () => {
    const state = board({
      column: [
        { resource_id: 'r1', resource_code: 'c1', display_name: 'Court 1', slot: [slot({ resource_id: 'r1' })] },
        { resource_id: 'r2', resource_code: 'c2', display_name: 'Court 2', slot: [slot({ resource_id: 'r2' })] },
      ],
    })
    let chosen = ''
    const tree = element(
      'div',
      {},
      renderBoard(element, { display_name: 'Booking', state }, { ...NOOP, onHold: (one) => (chosen = one.resource_id) }),
    )

    fire(byClass(tree, 'slot')[1]!)
    assert.equal(chosen, 'r2')
  })

  it('says so when the day is empty instead of drawing nothing', () => {
    const tree = element('div', {}, renderBoard(element, { display_name: 'Booking', state: board({ column: [] }) }, NOOP))
    assert.match(textOf(tree), /Nothing bookable/)
  })

  it('does not claim the day is empty while it is still loading', () => {
    const state = board({ status: 'loading', column: [] })
    const tree = element('div', {}, renderBoard(element, { display_name: 'Booking', state }, NOOP))

    assert.doesNotMatch(textOf(tree), /Nothing bookable/)
    assert.match(textOf(tree), /reading availability/)
  })

  it('offers confirm and cancel on a live hold, with the minutes left', () => {
    const tree = element(
      'div',
      {},
      renderBoard(element, { display_name: 'Booking', state: board({ held: booking() }) }, NOOP),
    )

    assert.match(textOf(byClass(tree, 'hold')[0]), /10 minute left/)
    assert.deepEqual(
      byClass(tree, 'hold')[0]!.child.flatMap((one) => buttonLabel(one)),
      ['Confirm', 'Cancel'],
    )
  })

  // Confirming a lapsed hold 400s. The button must be ABSENT, not disabled —
  // this is the exact shape of bug this whole file exists to catch.
  it('offers nothing on a lapsed hold', () => {
    const state = board({ held: booking(), now: new Date('2027-04-01T00:11:00.000Z') })
    const tree = element('div', {}, renderBoard(element, { display_name: 'Booking', state }, NOOP))
    const hold = byClass(tree, 'hold')[0]!

    assert.deepEqual(hold.child.flatMap((one) => buttonLabel(one)), [])
    assert.match(textOf(hold), /this hold has lapsed/)
  })

  it('offers only cancel once confirmed', () => {
    const state = board({ held: booking({ status: 'confirmed', hold_expire_at: null }) })
    const tree = element('div', {}, renderBoard(element, { display_name: 'Booking', state }, NOOP))
    const hold = byClass(tree, 'hold')[0]!

    assert.deepEqual(hold.child.flatMap((one) => buttonLabel(one)), ['Cancel'])
    assert.match(textOf(hold), /confirmed/)
  })

  it('shows a conflict above the board without clearing it', () => {
    const failure = describeFailure(new DiscoveryError('already taken', 409))
    const state = board({ held: null, failure })
    const tree = element('div', {}, renderBoard(element, { display_name: 'Booking', state }, NOOP))

    assert.equal(byClass(tree, 'notice').length, 1)
    assert.equal(byClass(tree, 'slot').length, 1, 'the board stays on screen under the message')
  })
})

describe('an undrawn pack renders', () => {
  it('says it is not built rather than showing an empty panel', () => {
    const tree = element(
      'div',
      {},
      renderNotBuilt(
        element,
        { display_name: 'Billing', noun: 'invoice', route_prefix: ['/api/v1/invoice'] },
        { onBack: () => {} },
      ),
    )
    assert.match(textOf(tree), /not built yet/)
    assert.match(textOf(tree), /\/api\/v1\/invoice/)
  })
})
