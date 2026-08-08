// The refusal-to-sentence mapping.
//
// The 409 case is the phase-2 exit condition in miniature, and the reason this
// file is separate from the booking view: a conflict is not an error, it is the
// double-booking guarantee working, and the interface has to say so.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DiscoveryError } from '../src/discovery.ts'
import { describeFailure } from '../src/view/failure.ts'

describe('describeFailure', () => {
  // THE test. A contested slot must read like a thing that happened, offer a
  // retry, and keep the server's own sentence — which was written for a person
  // and is better than anything the shell would invent.
  it('renders a contested slot as a human sentence, not a status code', () => {
    const failure = describeFailure(
      new DiscoveryError(
        'that resource is already taken for this time. Someone else booked it first.',
        409,
      ),
    )

    assert.equal(failure.headline, 'Someone got there first')
    assert.match(failure.detail, /Someone else booked it first/)
    assert.equal(failure.is_retryable, true, 'trying again is honest — the board has moved on')
    assert.equal(failure.is_signed_out, false)

    // The thing this exists to prevent.
    assert.doesNotMatch(failure.headline, /409|error|Error/)
    assert.doesNotMatch(failure.detail, /409|stack|at Object/)
  })

  it('sends an expired session back to sign-in rather than offering a retry', () => {
    const failure = describeFailure(new DiscoveryError('session is unknown, revoked, or expired', 401))
    assert.equal(failure.is_signed_out, true)
    assert.equal(failure.is_retryable, false, 'retrying with a dead token just fails again')
  })

  // 404 on a pack route usually means the module is off, not that a record is
  // missing — the OS returns 404 rather than 403 on purpose. The wording has to
  // cover both without claiming to know which.
  it('does not guess whether a 404 is a missing record or a disabled module', () => {
    const failure = describeFailure(new DiscoveryError('not found', 404))
    assert.match(failure.detail, /removed/)
    assert.match(failure.detail, /switched off/)
    assert.equal(failure.is_retryable, false)
  })

  it('separates an unreachable system from a broken one', () => {
    const offline = describeFailure(new DiscoveryError('cannot reach the OS at http://os', 0))
    const broken = describeFailure(new DiscoveryError('boom', 500))

    assert.match(offline.headline, /Cannot reach/)
    assert.match(broken.headline, /had a problem/)
    assert.equal(offline.is_retryable, true)
    assert.equal(broken.is_retryable, true)
    assert.notEqual(offline.headline, broken.headline, 'different fixes, different words')
  })

  it('does not blame the operator for a server fault', () => {
    const failure = describeFailure(new DiscoveryError('boom', 503))
    assert.match(failure.detail, /not your fault/)
  })

  it('passes a validation message through, because the server knows the field', () => {
    const failure = describeFailure(new DiscoveryError('session_id and resource_id are required', 400))
    assert.match(failure.detail, /session_id and resource_id are required/)
    assert.equal(failure.is_retryable, false, 'the same request will fail the same way')
  })

  it('survives something that is not a DiscoveryError at all', () => {
    const failure = describeFailure(new TypeError('undefined is not a function'))
    assert.match(failure.headline, /unexpectedly/)
    assert.match(failure.detail, /undefined is not a function/)
    assert.equal(failure.is_retryable, false)
  })
})
