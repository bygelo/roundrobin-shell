// The phase-2 exit condition for booking, executed.
//
//   "A slot can be held, confirmed, and cancelled from the browser, and the
//    409 on a contested slot renders as a human sentence, not a stack trace."
//
// The last clause is the one that needs a real database. describeFailure can be
// unit-tested against a hand-made DiscoveryError, but that only proves the
// mapping — it does not prove the shell ever RECEIVES a 409, which depends on
// the pack raising it, the kernel's error boundary mapping SQLSTATE to a
// status, and the client preserving both status and message on the way back.
// Four layers, any of which could turn the guarantee into a 500.
//
// So this contests a slot for real and asserts the sentence a person reads.

import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { Uuid } from '@bygelo/roundrobin-kernel'
import {
  actionFor,
  createBookingApi,
  groupByResource,
  holdMinuteRemaining,
} from '../src/view/booking.ts'
import { describeFailure } from '../src/view/failure.ts'
import { seedParty, standUpTenant, type Tenant } from './harness.ts'

const DATABASE_URL = process.env['DATABASE_URL']

describe('booking, through the shell, against a real OS', { skip: !DATABASE_URL }, () => {
  let tenant: Tenant
  let api: ReturnType<typeof createBookingApi>

  // Fixed instants, so the board does not depend on when the suite runs.
  const STARTS_AT = '2027-04-01T02:00:00.000Z'
  const ENDS_AT = '2027-04-01T03:00:00.000Z'
  const RANGE = {
    starts_at: new Date('2027-04-01T00:00:00.000Z'),
    ends_at: new Date('2027-04-02T00:00:00.000Z'),
  }

  before(async () => {
    tenant = await standUpTenant({ database_url: DATABASE_URL!, prefix: 'shell-booking' })
    api = createBookingApi(tenant.client)
    await seedParty(tenant, 'A Player')

    await tenant.inside(async (inside) => {
      // Two courts on one session, so a contested booking and an uncontested
      // one can both be demonstrated against the same slot.
      const [site] = await inside.query<{ site_id: Uuid }[]>`
        INSERT INTO site (organization_id, site_code, display_name, time_zone)
        VALUES (${tenant.organization_id}, 'main', 'Main Venue', 'Asia/Manila') RETURNING site_id`

      const resource_id: Uuid[] = []
      for (const code of ['court-1', 'court-2']) {
        const [row] = await inside.query<{ resource_id: Uuid }[]>`
          INSERT INTO resource (organization_id, site_id, resource_code, display_name)
          VALUES (${tenant.organization_id}, ${site!.site_id}, ${code}, ${code})
          RETURNING resource_id`
        resource_id.push(row!.resource_id)
      }

      const [booking_session] = await inside.query<{ session_id: Uuid }[]>`
        INSERT INTO session (organization_id, site_id, session_code, starts_at, ends_at,
                             capacity_count, price_amount, is_published)
        VALUES (${tenant.organization_id}, ${site!.site_id}, 'evening',
                ${STARTS_AT}, ${ENDS_AT}, 4, 500.00, true)
        RETURNING session_id`

      for (const one of resource_id) {
        await inside.query`
          INSERT INTO session_resource (organization_id, session_id, resource_id)
          VALUES (${tenant.organization_id}, ${booking_session!.session_id}, ${one})`
      }
    })
  })

  after(() => tenant.teardown())

  const session = () => tenant.session['operator']!

  it('reads a board with a column per resource', async () => {
    const column = groupByResource(await api.listAvailable(session(), RANGE))

    assert.equal(column.length, 2, 'two courts, two columns')
    assert.deepEqual(column.map((one) => one.resource_code).sort(), ['court-1', 'court-2'])
    assert.equal(column[0]?.slot[0]?.price_amount, '500.00', 'the settled price, as the API promises')
  })

  it('holds, confirms, and cancels — and the slot comes back', async () => {
    const [first] = await api.listAvailable(session(), RANGE)
    assert.ok(first)

    const held = await api.hold(session(), {
      session_id: first.session_id,
      resource_id: first.resource_id,
    })
    assert.equal(held.status, 'hold')
    assert.ok(holdMinuteRemaining(held, new Date()), 'a fresh hold has time left on it')
    assert.deepEqual(actionFor(held, new Date()), ['confirm', 'cancel'])

    // The board must lose the slot immediately — a hold occupies the resource
    // exactly as a confirmed booking does.
    assert.equal((await api.listAvailable(session(), RANGE)).length, 1)

    const confirmed = await api.confirm(session(), held.booking_code)
    assert.equal(confirmed.status, 'confirmed')
    assert.equal(confirmed.hold_expire_at, null)
    assert.deepEqual(actionFor(confirmed, new Date()), ['cancel'])

    await api.cancel(session(), held.booking_code)
    assert.equal((await api.listAvailable(session(), RANGE)).length, 2, 'and it comes back')
  })

  // THE test. Four layers have to behave for this sentence to reach a person:
  // the pack raises a conflict, the database refuses the overlap, the kernel's
  // error boundary maps it to 409 rather than 500, and the client preserves the
  // status and the message.
  it('renders a contested slot as a human sentence, not a stack trace', async () => {
    const [first] = await api.listAvailable(session(), RANGE)
    assert.ok(first)

    const held = await api.hold(session(), {
      session_id: first.session_id,
      resource_id: first.resource_id,
    })

    let failure: ReturnType<typeof describeFailure> | undefined
    try {
      await api.hold(session(), { session_id: first.session_id, resource_id: first.resource_id })
      assert.fail('the second hold on the same slot must be refused')
    } catch (error) {
      failure = describeFailure(error)
    }

    assert.ok(failure)
    assert.equal(failure.headline, 'Someone got there first')
    assert.match(failure.detail, /already taken/i)
    assert.equal(failure.is_retryable, true)
    assert.equal(failure.is_signed_out, false)

    // What this is here to prevent.
    assert.doesNotMatch(failure.headline, /\b409\b/)
    assert.doesNotMatch(failure.detail, /\b409\b|at Object|node:internal/)

    await api.cancel(session(), held.booking_code)
  })

  it('lets the other court take the same time', async () => {
    const slot = await api.listAvailable(session(), RANGE)
    assert.equal(slot.length, 2)

    const one = await api.hold(session(), {
      session_id: slot[0]!.session_id,
      resource_id: slot[0]!.resource_id,
    })
    const two = await api.hold(session(), {
      session_id: slot[1]!.session_id,
      resource_id: slot[1]!.resource_id,
    })

    assert.equal(one.status, 'hold')
    assert.equal(two.status, 'hold', 'the guarantee keys on resource, not on time alone')

    await api.cancel(session(), one.booking_code)
    await api.cancel(session(), two.booking_code)
  })

  it('finds a booking by the code a guest would quote', async () => {
    const [first] = await api.listAvailable(session(), RANGE)
    const held = await api.hold(session(), {
      session_id: first!.session_id,
      resource_id: first!.resource_id,
    })

    const found = await api.find(session(), held.booking_code)
    assert.equal(found?.booking_id, held.booking_id)

    await api.cancel(session(), held.booking_code)
  })

  it('explains a refused confirm instead of leaking the 400', async () => {
    let failure: ReturnType<typeof describeFailure> | undefined
    try {
      await api.confirm(session(), 'no-such-code')
      assert.fail('confirming an unknown code must be refused')
    } catch (error) {
      failure = describeFailure(error)
    }

    assert.ok(failure)
    assert.equal(failure.is_retryable, false, 'the same request will fail the same way')
    assert.match(failure.detail, /not on hold|expired|cancelled|confirmed/i)
  })
})
