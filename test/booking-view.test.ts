// The booking view's pure half.
//
// Everything that decides something — how a board is grouped, how long a hold
// has left, what an operator may do with a booking — is testable with no
// server and no clock.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  actionFor,
  formatDay,
  formatRange,
  groupByResource,
  holdMinuteRemaining,
  todayRange,
  type Booking,
  type Slot,
} from '../src/view/booking.ts'

const MANILA = 'Asia/Manila'

function slot(input: Partial<Slot> & { resource_id: string }): Slot {
  return {
    session_id: 's',
    resource_code: input.resource_id,
    display_name: input.resource_id,
    starts_at: '2026-09-01T02:00:00.000Z',
    ends_at: '2026-09-01T03:00:00.000Z',
    price_amount: '500.00',
    session_type: 'private',
    ...input,
  }
}

function booking(input: Partial<Booking>): Booking {
  return {
    booking_id: 'b',
    booking_code: 'code',
    status: 'hold',
    starts_at: '2026-09-01T02:00:00.000Z',
    ends_at: '2026-09-01T03:00:00.000Z',
    price_amount: '500.00',
    hold_expire_at: '2026-09-01T00:10:00.000Z',
    session_id: 's',
    resource_id: 'r',
    session_type: 'private',
    ...input,
  }
}

describe('the board', () => {
  it('groups a flat availability list by resource', () => {
    const column = groupByResource([
      slot({ resource_id: 'court-1' }),
      slot({ resource_id: 'court-2' }),
      slot({ resource_id: 'court-1', starts_at: '2026-09-01T03:00:00.000Z' }),
    ])

    assert.deepEqual(column.map((one) => one.resource_id), ['court-1', 'court-2'])
    assert.equal(column[0]?.slot.length, 2)
    assert.equal(column[1]?.slot.length, 1)
  })

  // The pack orders by starts_at then r.sort_order, and sort_order is the
  // venue's own arrangement of its courts. Re-sorting alphabetically here would
  // quietly override a decision somebody made on purpose.
  it('preserves the order the server chose', () => {
    const column = groupByResource([
      slot({ resource_id: 'z-court' }),
      slot({ resource_id: 'a-court' }),
    ])
    assert.deepEqual(column.map((one) => one.resource_id), ['z-court', 'a-court'])
  })

  it('returns nothing for an empty day rather than a phantom column', () => {
    assert.deepEqual(groupByResource([]), [])
  })
})

describe('time, in the tenant’s zone', () => {
  // A venue in Manila administered from Singapore must not see its evening
  // slots shifted because of where the laptop is.
  it('formats a range in the zone it is given, not the browser’s', () => {
    const manila = formatRange('2026-09-01T02:00:00.000Z', '2026-09-01T03:00:00.000Z', MANILA)
    const utc = formatRange('2026-09-01T02:00:00.000Z', '2026-09-01T03:00:00.000Z', 'UTC')

    assert.match(manila, /10:00/, 'Asia/Manila is UTC+8, so 02:00Z is 10:00 local')
    assert.match(utc, /2:00/)
    assert.notEqual(manila, utc)
  })

  it('formats a day heading in the same zone', () => {
    // 2026-08-31T17:00Z is already 1 September in Manila and still 31 August
    // in UTC. Asserted as day and month separately rather than as one string,
    // because the field ORDER is the locale's business and pinning it here
    // would make this test fail on a correct change to the locale.
    const manila = formatDay('2026-08-31T17:00:00.000Z', MANILA)
    assert.match(manila, /Sep/)
    assert.match(manila, /\b1\b/)

    const utc = formatDay('2026-08-31T17:00:00.000Z', 'UTC')
    assert.match(utc, /Aug/)
    assert.match(utc, /\b31\b/)
  })
})

describe('a hold’s remaining life', () => {
  it('counts whole minutes left', () => {
    const now = new Date('2026-09-01T00:00:00.000Z')
    assert.equal(holdMinuteRemaining(booking({}), now), 10)
  })

  it('is null once the hold has lapsed, so nothing renders a negative countdown', () => {
    const now = new Date('2026-09-01T00:11:00.000Z')
    assert.equal(holdMinuteRemaining(booking({}), now), null)
  })

  it('is null for a booking that is not on hold', () => {
    const now = new Date('2026-09-01T00:00:00.000Z')
    assert.equal(holdMinuteRemaining(booking({ status: 'confirmed', hold_expire_at: null }), now), null)
  })
})

describe('what an operator may do', () => {
  const now = new Date('2026-09-01T00:00:00.000Z')

  it('offers confirm and cancel on a live hold', () => {
    assert.deepEqual(actionFor(booking({}), now), ['confirm', 'cancel'])
  })

  it('offers only cancel once confirmed', () => {
    assert.deepEqual(actionFor(booking({ status: 'confirmed', hold_expire_at: null }), now), ['cancel'])
  })

  // Confirming a lapsed hold 400s. Offering the button would be an invitation
  // to a refusal the shell could see coming.
  it('offers nothing on a lapsed hold', () => {
    assert.deepEqual(actionFor(booking({}), new Date('2026-09-01T00:11:00.000Z')), [])
  })

  it('offers nothing on a cancelled or expired booking', () => {
    assert.deepEqual(actionFor(booking({ status: 'cancelled' }), now), [])
    assert.deepEqual(actionFor(booking({ status: 'expired' }), now), [])
  })
})

describe('the default window', () => {
  it('is one whole local day', () => {
    const range = todayRange(new Date('2026-09-01T13:45:00'))
    assert.equal(range.starts_at.getHours(), 0)
    assert.equal(range.starts_at.getMinutes(), 0)
    assert.equal(
      range.ends_at.getTime() - range.starts_at.getTime(),
      24 * 60 * 60 * 1000,
      'exactly 24 hours, so a slot at 23:30 is not cut off',
    )
  })
})
