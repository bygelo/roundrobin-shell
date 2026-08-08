// The gate story's pure half and its rendering.
//
// The deny vocabulary is the part worth testing hardest. Every other screen in
// this shell can afford a slightly clumsy error message; a gate cannot, because
// the person reading it is standing in a doorway with somebody waiting and has
// to decide what to do in the next few seconds. `trip_limit` does not tell them
// that. "No trips left — issue a new one if that is right" does.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from '../src/dom.ts'
import {
  renderConsole,
  renderMembership,
  type ConsoleState,
  type MembershipState,
} from '../src/render-gate.ts'
import {
  describeUse,
  isPassUsable,
  readDeny,
  tallyScan,
  type AccessPoint,
  type Credential,
  type Pass,
  type ScanEvent,
  type ScanResult,
} from '../src/view/gate.ts'
import { byClass, byTag, fire, stubDocument, textOf } from './stub-dom.ts'

const element = createElement(stubDocument())
const NOW = new Date('2027-04-01T12:00:00.000Z')

function pass(over: Partial<Pass> = {}): Pass {
  return {
    pass_id: 'ps',
    pass_code: 'PASS-001',
    party_id: 'p',
    status: 'active',
    valid_from: '2027-03-01T00:00:00.000Z',
    valid_until: '2027-05-01T00:00:00.000Z',
    use_limit: 5,
    use_count: 2,
    ...over,
  }
}

function credential(over: Partial<Credential> = {}): Credential {
  return {
    credential_id: 'c',
    party_id: 'p',
    credential_kind: 'qr',
    is_active: true,
    external_ref: null,
    display_label: 'Phone QR',
    ...over,
  }
}

function point(over: Partial<AccessPoint> = {}): AccessPoint {
  return {
    access_point_id: 'ap-1',
    access_point_code: 'main-gate',
    display_name: 'Main Gate',
    adapter_code: 'manual_guard',
    is_active: true,
    ...over,
  }
}

function scan(over: Partial<ScanEvent> = {}): ScanEvent {
  return {
    scan_event_id: '1',
    access_point_id: 'ap-1',
    outcome: 'allowed',
    deny_reason_code: null,
    party_id: 'p',
    pass_id: 'ps',
    credential_id: null,
    visit_id: null,
    adapter_code: 'manual_guard',
    occurred_at: '2027-04-01T11:59:00.000Z',
    ...over,
  }
}

function verdict(over: Partial<ScanResult> = {}): ScanResult {
  return {
    outcome: 'allowed',
    deny_reason_code: null,
    party_id: 'p',
    pass_id: 'ps',
    credential_id: null,
    visit_id: null,
    barrier: null,
    ...over,
  }
}

function membershipState(over: Partial<MembershipState> = {}): MembershipState {
  return {
    status: 'ready',
    membership: [],
    pass: [pass()],
    credential: [credential()],
    now: NOW,
    ...over,
  }
}

function consoleState(over: Partial<ConsoleState> = {}): ConsoleState {
  return {
    status: 'ready',
    point: [point()],
    selected_access_point_id: 'ap-1',
    scan: [scan()],
    last: null,
    held_capability: ['access.read', 'access.write'],
    zone: 'Asia/Manila',
    ...over,
  }
}

const NOOP_CONSOLE = { onSelectPoint: () => {}, onScan: () => {}, onBack: () => {} }

describe('the deny vocabulary', () => {
  // THE test for this checkpoint's screens. Every code a guard can actually
  // receive must read as a sentence with a next move.
  it('turns every deny code the pack emits into something actionable', () => {
    for (const code of [
      'unknown_credential',
      'bad_standing',
      'trip_limit',
      'expired',
      'revoked',
      'not_entitled',
      'inactive_point',
    ]) {
      const reading = readDeny(code)
      assert.ok(reading.headline.length > 3, `${code} needs a headline`)
      assert.ok(reading.detail.length > 20, `${code} needs a next move, not a restatement`)
      assert.doesNotMatch(reading.headline, /_/, `${code} leaked the machine code into the headline`)
      assert.notEqual(reading.headline, code)
    }
  })

  it('does not tell a guard to let a revoked pass through', () => {
    const revoked = readDeny('revoked')
    assert.equal(revoked.is_resolvable, false, 'a revoked pass was cancelled on purpose')
    assert.match(revoked.detail, /checking why/)
  })

  it('says an inactive gate is not the visitor’s fault', () => {
    assert.match(readDeny('inactive_point').detail, /Nothing to do with the person/)
  })

  // Inventing a sentence for a code the shell has not been taught is worse than
  // admitting it, because a guard would act on the invention.
  it('admits an unmapped code instead of guessing at it', () => {
    const reading = readDeny('some_future_reason')
    assert.match(reading.detail, /some_future_reason/, 'shows the raw code')
    assert.match(reading.detail, /does not have wording/)
    assert.equal(reading.is_resolvable, false)
  })

  it('handles a deny with no reason recorded', () => {
    assert.match(readDeny(null).headline, /Refused/)
  })
})

describe('whether a pass is usable', () => {
  it('is usable inside its window with trips left', () => {
    assert.equal(isPassUsable(pass(), NOW), true)
  })

  it('is not usable once the trips are spent', () => {
    assert.equal(isPassUsable(pass({ use_count: 5, use_limit: 5 }), NOW), false)
  })

  it('is usable with no trip cap at all', () => {
    assert.equal(isPassUsable(pass({ use_limit: null, use_count: 99 }), NOW), true)
    assert.equal(describeUse(pass({ use_limit: null })), 'unlimited')
  })

  it('is not usable before it opens or after it closes', () => {
    assert.equal(isPassUsable(pass(), new Date('2027-01-01T00:00:00.000Z')), false)
    assert.equal(isPassUsable(pass(), new Date('2027-09-01T00:00:00.000Z')), false)
  })

  it('is not usable when revoked, whatever the dates say', () => {
    assert.equal(isPassUsable(pass({ status: 'revoked' }), NOW), false)
  })

  it('describes use as a count a person reads', () => {
    assert.equal(describeUse(pass()), '2 of 5 used')
  })
})

describe('the feed tally', () => {
  it('counts allow and deny separately', () => {
    const tally = tallyScan([scan(), scan({ outcome: 'denied' }), scan({ outcome: 'denied' })])
    assert.deepEqual(tally, { allowed_count: 1, denied_count: 2 })
  })

  it('is zero for an empty feed', () => {
    assert.deepEqual(tallyScan([]), { allowed_count: 0, denied_count: 0 })
  })
})

describe('the membership screen renders', () => {
  it('marks a spent pass differently from a usable one', () => {
    const tree = element(
      'div',
      {},
      renderMembership(
        element,
        {
          display_name: 'Membership',
          state: membershipState({ pass: [pass(), pass({ use_count: 5 })] }),
        },
        { onBack: () => {} },
      ),
    )
    assert.equal(byClass(tree, 'usable').length, 1)
    assert.equal(byClass(tree, 'spent').length, 1)
  })

  it('never shows anything token-shaped for a credential', () => {
    const tree = element(
      'div',
      {},
      renderMembership(element, { display_name: 'Membership', state: membershipState() }, { onBack: () => {} }),
    )
    const text = textOf(tree)
    assert.match(text, /Phone QR/)
    assert.doesNotMatch(text, /token/i, 'the projection omits it and the screen must not invent it')
  })

  it('flags an inactive credential', () => {
    const tree = element(
      'div',
      {},
      renderMembership(
        element,
        { display_name: 'Membership', state: membershipState({ credential: [credential({ is_active: false })] }) },
        { onBack: () => {} },
      ),
    )
    assert.equal(byClass(tree, 'pill').length, 1)
  })

  it('says so when nothing is issued', () => {
    const tree = element(
      'div',
      {},
      renderMembership(
        element,
        { display_name: 'Membership', state: membershipState({ pass: [], credential: [] }) },
        { onBack: () => {} },
      ),
    )
    assert.match(textOf(tree), /No pass issued/)
    assert.match(textOf(tree), /Nothing enrolled/)
  })
})

describe('the gate console renders', () => {
  it('lets a guard pick which door, and marks the chosen one', () => {
    const tree = element(
      'div',
      {},
      renderConsole(
        element,
        {
          display_name: 'Access',
          state: consoleState({
            point: [point(), point({ access_point_id: 'ap-2', display_name: 'Side Gate' })],
          }),
        },
        NOOP_CONSOLE,
      ),
    )
    assert.equal(byClass(tree, 'gate').length, 2)
    assert.equal(byClass(tree, 'chosen').length, 1)
  })

  it('selects the door the button belongs to', () => {
    let chosen = ''
    const tree = element(
      'div',
      {},
      renderConsole(
        element,
        {
          display_name: 'Access',
          state: consoleState({
            point: [point(), point({ access_point_id: 'ap-2', display_name: 'Side Gate' })],
          }),
        },
        { ...NOOP_CONSOLE, onSelectPoint: (one) => (chosen = one.access_point_id) },
      ),
    )
    fire(byClass(tree, 'gate')[1]!)
    assert.equal(chosen, 'ap-2')
  })

  // Presenting a code is a write. Absent, not disabled.
  it('gives no input at all to a guard who may only watch', () => {
    const tree = element(
      'div',
      {},
      renderConsole(
        element,
        { display_name: 'Access', state: consoleState({ held_capability: ['access.read'] }) },
        NOOP_CONSOLE,
      ),
    )
    assert.equal(byTag(tree, 'input').length, 0)
    assert.equal(byClass(tree, 'present').length, 0)
  })

  it('gives no input until a door is chosen', () => {
    const tree = element(
      'div',
      {},
      renderConsole(
        element,
        { display_name: 'Access', state: consoleState({ selected_access_point_id: null }) },
        NOOP_CONSOLE,
      ),
    )
    assert.equal(byTag(tree, 'input').length, 0)
  })

  it('shows an allow as an instruction, not a status code', () => {
    const tree = element(
      'div',
      {},
      renderConsole(
        element,
        { display_name: 'Access', state: consoleState({ last: verdict() }) },
        NOOP_CONSOLE,
      ),
    )
    const shown = byClass(tree, 'verdict')[0]!
    assert.match(textOf(shown), /Let them in/)
    assert.ok(shown.className.includes('allowed'))
  })

  // THE test. A guard must never read the pack's machine code off a door.
  it('shows a deny as a sentence with the next move, never the raw code', () => {
    const tree = element(
      'div',
      {},
      renderConsole(
        element,
        {
          display_name: 'Access',
          state: consoleState({ last: verdict({ outcome: 'denied', deny_reason_code: 'trip_limit' }) }),
        },
        NOOP_CONSOLE,
      ),
    )
    const shown = byClass(tree, 'verdict')[0]!

    assert.match(textOf(shown), /No trips left/)
    assert.match(textOf(shown), /Issue a new one/)
    assert.doesNotMatch(textOf(shown), /trip_limit/, 'the machine code must not reach the door')
  })

  it('says a repeat scan is a repeat, so one person is not counted twice', () => {
    const tree = element(
      'div',
      {},
      renderConsole(
        element,
        { display_name: 'Access', state: consoleState({ last: verdict({ is_replay: true }) }) },
        NOOP_CONSOLE,
      ),
    )
    assert.match(textOf(byClass(tree, 'verdict')[0]), /repeat scan/)
  })

  it('shows the deny headline in the feed too, not the code', () => {
    const tree = element(
      'div',
      {},
      renderConsole(
        element,
        {
          display_name: 'Access',
          state: consoleState({
            scan: [scan({ outcome: 'denied', deny_reason_code: 'unknown_credential' })],
          }),
        },
        NOOP_CONSOLE,
      ),
    )
    assert.match(textOf(byClass(tree, 'feed')[0]), /Not recognised/)
    assert.doesNotMatch(textOf(byClass(tree, 'feed')[0]), /unknown_credential/)
  })

  it('draws a denial count in warning tone only when there is one', () => {
    const clean = element(
      'div',
      {},
      renderConsole(element, { display_name: 'Access', state: consoleState() }, NOOP_CONSOLE),
    )
    assert.equal(byClass(byClass(clean, 'feed')[0], 'warn').length, 0)

    const trouble = element(
      'div',
      {},
      renderConsole(
        element,
        { display_name: 'Access', state: consoleState({ scan: [scan({ outcome: 'denied' })] }) },
        NOOP_CONSOLE,
      ),
    )
    assert.equal(byClass(byClass(trouble, 'feed')[0], 'warn').length, 1)
  })

  it('says the gate has no doors rather than drawing an empty picker', () => {
    const tree = element(
      'div',
      {},
      renderConsole(
        element,
        { display_name: 'Access', state: consoleState({ point: [], selected_access_point_id: null }) },
        NOOP_CONSOLE,
      ),
    )
    assert.match(textOf(tree), /No access point configured/)
  })

  it('hands the typed code to the handler on submit', () => {
    let presented = ''
    const tree = element(
      'div',
      {},
      renderConsole(
        element,
        { display_name: 'Access', state: consoleState() },
        { ...NOOP_CONSOLE, onScan: (one) => (presented = one) },
      ),
    )
    const form = byClass(tree, 'scan-form')[0]!
    // The stub has no form.elements, so this also proves readPresented does not
    // throw on a shape it does not recognise.
    form.listener['submit']!({ preventDefault: () => {}, target: { elements: { presented: { value: 'PASS-001' } } } })
    assert.equal(presented, 'PASS-001')
  })

  it('does not claim the feed is empty while it is still loading', () => {
    const tree = element(
      'div',
      {},
      renderConsole(
        element,
        { display_name: 'Access', state: consoleState({ status: 'loading', scan: [], point: [] }) },
        NOOP_CONSOLE,
      ),
    )
    assert.doesNotMatch(textOf(tree), /Nothing yet/)
    assert.match(textOf(tree), /reading the gate/)
  })
})
