// The scan view — pure half and rendering.
//
// Two assertions carry this file, and both are about telling one thing from
// another thing that looks identical.
//
// A CANCELLED code must not read as a forgery. `revoked` and `unknown_code`
// both mean "this did not work", and collapsing them into one sentence tells a
// guard that the person in front of them is carrying a fake when what actually
// happened is that somebody here cancelled it. docs/scan.md is explicit about
// this and the pack pays for it in a separate outcome; a screen that throws the
// distinction away has undone that.
//
// A REPLAY must not read as a second scan. The pack returns the original
// outcome and consumes nothing, so two log lines for one person is the correct
// and expected shape — and the obvious reading of it, "they got in twice", is
// wrong. Someone acts on that reading.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from '../src/dom.ts'
import { renderScan, type ScanState } from '../src/render-scan.ts'
import {
  codeActionFor,
  describeCodeUse,
  isCodeUsable,
  readOutcome,
  tallyResolution,
  targetFor,
  type ScanCode,
  type ScanResolution,
  type ScanTarget,
} from '../src/view/scan.ts'
import { buttonLabel, byClass, stubDocument, textOf } from './stub-dom.ts'

const element = createElement(stubDocument())
const NOW = new Date('2027-04-01T12:00:00.000Z')

function target(over: Partial<ScanTarget> = {}): ScanTarget {
  return {
    scan_target_id: 't1',
    scan_target_code: 'table-menu',
    kind: 'link',
    display_name: 'Table menu',
    destination_url: 'https://example.test/menu',
    command_code: null,
    required_capability: null,
    is_active: true,
    ...over,
  }
}

function code(over: Partial<ScanCode> = {}): ScanCode {
  return {
    scan_code_id: 'c1c1c1c1-0000',
    scan_target_id: 't1',
    token: 'tok',
    label: 'Table 4',
    subject_id: null,
    valid_from: '2027-03-01T00:00:00.000Z',
    valid_until: null,
    use_limit: null,
    use_count: 0,
    is_active: true,
    revoked_at: null,
    ...over,
  }
}

function resolution(over: Partial<ScanResolution> = {}): ScanResolution {
  return {
    scan_resolution_id: 'r1',
    outcome: 'resolved',
    scan_code_id: 'c1c1c1c1-0000',
    label: 'Table 4',
    use_remaining: null,
    detail: null,
    created_at: '2027-04-01T11:00:00.000Z',
    ...over,
  }
}

function ready(over: Partial<ScanState> = {}): ScanState {
  return {
    status: 'ready',
    target: [target()],
    code: [code()],
    resolution: [resolution()],
    failure: undefined,
    held_capability: ['scan.read'],
    now: NOW,
    ...over,
  }
}

describe('the outcome vocabulary', () => {
  // THE assertion of this file.
  it('tells a cancelled code apart from one that was never issued', () => {
    const cancelled = readOutcome('revoked')
    const unknown = readOutcome('unknown_code')

    assert.notEqual(cancelled.headline, unknown.headline)
    assert.notEqual(cancelled.detail, unknown.detail)

    // A cancelled code is not evidence of a forgery, and the wording has to say
    // so rather than merely avoid saying the opposite.
    assert.match(cancelled.detail, /not carrying a forgery/)
    assert.match(cancelled.detail, /cancelled by someone here/)
  })

  it('reports a replay as a repeat that consumed nothing', () => {
    const once = readOutcome('resolved')
    const again = readOutcome('resolved', true)

    assert.equal(once.headline, again.headline, 'a replay is the same outcome')
    assert.doesNotMatch(once.detail, /consumed nothing/)
    assert.match(again.detail, /consumed nothing/)
  })

  it('treats a refused public scan as the rule working, not a fault', () => {
    const reading = readOutcome('forbidden')
    assert.equal(reading.is_refusal, true)
    assert.match(reading.detail, /that is the rule working|the rule working/i)
  })

  it('shows a raw outcome it has no wording for rather than inventing one', () => {
    const reading = readOutcome('something_new' as never)
    assert.match(reading.detail, /something_new/)
    assert.equal(reading.is_refusal, true)
  })

  it('counts resolved, refused and repeat separately', () => {
    const tally = tallyResolution([
      resolution(),
      resolution({ outcome: 'resolved', is_replay: true }),
      resolution({ outcome: 'revoked' }),
      resolution({ outcome: 'expired' }),
    ])

    // A replay is still a resolution, and still not a refusal.
    assert.deepEqual(tally, { resolved_count: 2, refused_count: 2, replay_count: 1 })
  })
})

describe('whether a code is usable', () => {
  it('accepts a live open-ended code', () => {
    assert.equal(isCodeUsable(code(), NOW), true)
  })

  // A null valid_until is an open-ended code, not an expired one — the easiest
  // way to write this check wrong is `now <= new Date(null)`, which is false.
  it('does not treat an open-ended code as expired', () => {
    assert.equal(isCodeUsable(code({ valid_until: null }), NOW), true)
  })

  it('refuses a revoked, a spent, an early and a closed code', () => {
    assert.equal(isCodeUsable(code({ revoked_at: '2027-03-05T00:00:00.000Z' }), NOW), false)
    assert.equal(isCodeUsable(code({ is_active: false }), NOW), false)
    assert.equal(isCodeUsable(code({ use_limit: 2, use_count: 2 }), NOW), false)
    assert.equal(isCodeUsable(code({ valid_from: '2027-05-01T00:00:00.000Z' }), NOW), false)
    assert.equal(isCodeUsable(code({ valid_until: '2027-03-30T00:00:00.000Z' }), NOW), false)
  })

  it('says how many uses are left without pretending an unlimited code has a cap', () => {
    assert.equal(describeCodeUse(code({ use_limit: 5, use_count: 2 })), '2 of 5 used')
    assert.equal(describeCodeUse(code({ use_limit: null, use_count: 9 })), '9 used, no limit')
  })
})

describe('what a session may do to a code', () => {
  it('offers revoke only to a session holding scan.manage', () => {
    assert.deepEqual(codeActionFor(code(), ['scan.read']), [])
    assert.deepEqual(codeActionFor(code(), ['scan.read', 'scan.manage']), ['revoke'])
  })

  // Revoking twice is not an action, so it is not offered — the same rule the
  // booking board follows for a lapsed hold.
  it('offers nothing on a code already cancelled', () => {
    assert.deepEqual(codeActionFor(code({ revoked_at: '2027-03-05T00:00:00.000Z' }), ['scan.manage']), [])
    assert.deepEqual(codeActionFor(code({ is_active: false }), ['scan.manage']), [])
  })

  // A spent code can still be cancelled: it stops the limit being raised later.
  it('still offers revoke on a spent but live code', () => {
    assert.deepEqual(codeActionFor(code({ use_limit: 1, use_count: 1 }), ['scan.manage']), ['revoke'])
  })
})

describe('the scan screen renders', () => {
  it('draws the three sections a scan operator asks about', () => {
    const tree = element('div', {}, renderScan(element, { display_name: 'Scan', state: ready() }, {
      onRevoke: () => {},
      onBack: () => {},
    }))

    assert.equal(byClass(tree, 'target-list').length, 1)
    assert.equal(byClass(tree, 'code-list').length, 1)
    assert.equal(byClass(tree, 'resolution-log').length, 1)
  })

  it('names the capability that keeps a target off the public path', () => {
    const state = ready({ target: [target({ required_capability: 'access.write' })] })
    const tree = element('div', {}, renderScan(element, { display_name: 'Scan', state }, {
      onRevoke: () => {},
      onBack: () => {},
    }))

    assert.match(textOf(tree), /Signed-in scanner only/)
    assert.match(textOf(tree), /access\.write/)
  })

  // A read-only session must not be shown a button it cannot use. Not
  // disabled — absent.
  it('draws no revoke button for a session that may only read', () => {
    const tree = element('div', {}, renderScan(element, { display_name: 'Scan', state: ready() }, {
      onRevoke: () => {},
      onBack: () => {},
    }))

    assert.deepEqual(buttonLabel(tree), ['Back'])
  })

  it('revokes the code the button belongs to', () => {
    const state = ready({
      held_capability: ['scan.read', 'scan.manage'],
      code: [code({ scan_code_id: 'first' }), code({ scan_code_id: 'second', label: 'Table 5' })],
    })

    let chosen = ''
    const tree = element('div', {}, renderScan(element, { display_name: 'Scan', state }, {
      onRevoke: (one) => (chosen = one.scan_code_id),
      onBack: () => {},
    }))

    // The second button, not the first — a closure capturing the loop variable
    // wrongly would send every row to the same code.
    const revoke = byClass(tree, 'revoke')
    assert.equal(revoke.length, 2)
    revoke[1]!.listener['click']!({})
    assert.equal(chosen, 'second')
  })

  it('says why an unusable code cannot be used', () => {
    const state = ready({ code: [code({ use_limit: 1, use_count: 1 })] })
    const tree = element('div', {}, renderScan(element, { display_name: 'Scan', state }, {
      onRevoke: () => {},
      onBack: () => {},
    }))

    assert.match(textOf(tree), /Every use has been spent/)
  })

  it('does not claim nothing was scanned while it is still loading', () => {
    const state = ready({ status: 'loading', target: [], code: [], resolution: [] })
    const tree = element('div', {}, renderScan(element, { display_name: 'Scan', state }, {
      onRevoke: () => {},
      onBack: () => {},
    }))

    assert.doesNotMatch(textOf(tree), /Nothing scanned yet/)
    assert.match(textOf(tree), /reading the scan log/)
  })

  it('names a code whose target the list did not include, rather than dropping it', () => {
    const state = ready({ target: [], code: [code()] })
    const tree = element('div', {}, renderScan(element, { display_name: 'Scan', state }, {
      onRevoke: () => {},
      onBack: () => {},
    }))

    assert.match(textOf(tree), /unknown target/)
    assert.equal(targetFor(code(), []), null)
  })
})
