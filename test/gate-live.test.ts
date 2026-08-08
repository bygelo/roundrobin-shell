// The gate story against a real OS.
//
// The exit condition for this checkpoint, from docs/frontend.md: **a pass is
// issued, a credential enrolled, and a scan allows then denies at the door
// console.**
//
// Both packs shipped with zero read routes, so none of this was reachable a
// commit ago. Six reads went into the OS first.
//
// The scan is the part that needs a real database rather than a stub: an allow
// has to consume a trip, and the deny that follows has to be the pack's own
// judgement about a spent pass — not something this file arranged.

import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { Uuid } from '@bygelo/roundrobbin-kernel'
import {
  createPlan,
  enrollCredential,
  issueMembership,
  issuePass,
} from '@bygelo/roundrobbin-membership'
import { createAccessPoint } from '@bygelo/roundrobbin-access'
import { createGateApi, isPassUsable, readDeny, tallyScan } from '../src/view/gate.ts'
import { describeFailure } from '../src/view/failure.ts'
import { seedParty, standUpTenant, type Tenant } from './harness.ts'

const DATABASE_URL = process.env['DATABASE_URL']

describe('the gate story, through the shell, against a real OS', { skip: !DATABASE_URL }, () => {
  let tenant: Tenant
  let party_id: Uuid
  let access_point_id: Uuid
  let pass_code: string
  let api: ReturnType<typeof createGateApi>

  before(async () => {
    tenant = await standUpTenant({
      database_url: DATABASE_URL!,
      prefix: 'shell-gate',
      role: [
        { role_code: 'owner', display_name: 'Owner' },
        // A guard who may WATCH the feed and not present a code.
        { role_code: 'watcher', display_name: 'Watcher', capability_code: ['access.read'] },
      ],
      actor: [
        { actor_code: 'guard', role_code: 'owner' },
        { actor_code: 'watcher', role_code: 'watcher' },
      ],
    })

    api = createGateApi(tenant.client)
    party_id = await seedParty(tenant, 'Resident 12A')

    await tenant.inside(async (inside) => {
      const plan = await createPlan(inside, { plan_code: 'resident', display_name: 'Resident' })
      const membership = await issueMembership(inside, {
        party_id,
        membership_plan_id: plan.membership_plan_id,
      })

      // A ONE-trip pass, valid now. One trip is what makes the allow-then-deny
      // sequence the pack's own judgement rather than something arranged here.
      const day = 24 * 60 * 60 * 1000
      const pass = await issuePass(inside, {
        party_id,
        membership_id: membership.membership_id,
        valid_from: new Date(Date.now() - day),
        valid_until: new Date(Date.now() + day),
        use_limit: 1,
      })
      pass_code = pass.pass_code

      await enrollCredential(inside, {
        party_id,
        credential_kind: 'qr',
        token: 'a-secret-token',
        display_label: 'Phone QR',
      })

      const point = await createAccessPoint(inside, {
        access_point_code: 'main-gate',
        display_name: 'Main Gate',
      })
      access_point_id = point.access_point_id
    })
  })

  after(() => tenant.teardown())

  const guard = () => tenant.session['guard']!

  it('reads what was issued', async () => {
    const membership = await api.listMembership(guard())
    assert.equal(membership.length, 1)
    assert.equal(membership[0]?.status, 'active')

    const pass = await api.listPass(guard())
    assert.equal(pass.length, 1)
    assert.equal(isPassUsable(pass[0]!, new Date()), true, 'issued, in window, one trip left')

    const plan = await api.listPlan(guard())
    assert.equal(plan[0]?.plan_code, 'resident')
  })

  // The security property, over the wire this time rather than in a projection.
  it('never sends a credential token or its hash to the browser', async () => {
    const credential = await api.listCredential(guard())
    assert.equal(credential.length, 1)
    assert.equal(credential[0]?.display_label, 'Phone QR')

    const serialised = JSON.stringify(credential)
    assert.doesNotMatch(serialised, /token/i)
    assert.doesNotMatch(serialised, /a-secret-token/)
  })

  it('lists the doors a console can watch', async () => {
    const point = await api.listAccessPoint(guard())
    assert.equal(point.length, 1)
    assert.equal(point[0]?.access_point_code, 'main-gate')
    assert.equal(point[0]?.is_active, true)
  })

  // THE test for this checkpoint. Allow, then deny, and the deny is the pack's
  // own judgement about a pass with no trips left.
  it('allows a pass once, then denies it — and the guard reads a sentence', async () => {
    const allowed = await api.scan(guard(), { access_point_id, presented: pass_code })
    assert.equal(allowed.outcome, 'allowed')
    assert.equal(allowed.party_id, party_id)

    const denied = await api.scan(guard(), { access_point_id, presented: pass_code })
    assert.equal(denied.outcome, 'denied')
    assert.equal(denied.deny_reason_code, 'trip_limit', 'the pack decided this, not the test')

    // What a guard actually reads off the door.
    const reading = readDeny(denied.deny_reason_code)
    assert.equal(reading.headline, 'No trips left')
    assert.match(reading.detail, /Issue a new one/)
    assert.equal(reading.is_resolvable, true)
    assert.doesNotMatch(reading.headline, /trip_limit/)

    // And the pass now reads as spent, without the shell tracking it.
    const pass = await api.listPass(guard())
    assert.equal(isPassUsable(pass[0]!, new Date()), false)
  })

  it('shows both outcomes in the feed, newest first', async () => {
    const scan = await api.listScanEvent(guard())
    assert.ok(scan.length >= 2)

    const tally = tallyScan(scan)
    assert.ok(tally.allowed_count >= 1)
    assert.ok(tally.denied_count >= 1, 'a console hiding denials hides the point of a console')

    const first = new Date(scan[0]!.occurred_at).getTime()
    const second = new Date(scan[1]!.occurred_at).getTime()
    assert.ok(first >= second, 'newest first — a gate answers "what just happened"')
  })

  it('filters the feed to the denials a guard is looking for', async () => {
    const denied = await api.listScanEvent(guard(), { outcome: 'denied' })
    assert.ok(denied.length >= 1)
    assert.ok(denied.every((one) => one.outcome === 'denied'))
  })

  it('refuses an unknown code with a reason the shell can read', async () => {
    const result = await api.scan(guard(), { access_point_id, presented: 'not-a-real-code' })
    assert.equal(result.outcome, 'denied')
    assert.equal(result.deny_reason_code, 'unknown_credential')
    assert.match(readDeny(result.deny_reason_code).headline, /Not recognised/)
  })

  // A denial is a recorded event, not an exception — a gate that threw on a
  // refusal would lose the log entry that matters most.
  it('records a denial rather than throwing one', async () => {
    const before_count = (await api.listScanEvent(guard())).length
    await api.scan(guard(), { access_point_id, presented: 'still-not-real' })
    const after_count = (await api.listScanEvent(guard())).length
    assert.equal(after_count, before_count + 1, 'the deny is appended to the log')
  })

  it('lets a watcher read the feed and refuses to let them present a code', async () => {
    const watcher = tenant.session['watcher']!

    const scan = await api.listScanEvent(watcher)
    assert.ok(scan.length >= 1, 'a watcher may watch')

    let failure: ReturnType<typeof describeFailure> | undefined
    try {
      await api.scan(watcher, { access_point_id, presented: pass_code })
      assert.fail('a watcher must not be able to present a code')
    } catch (error) {
      failure = describeFailure(error)
    }

    assert.ok(failure)
    assert.match(failure.headline, /do not have permission/)
    assert.equal(failure.is_retryable, false)
  })
})
