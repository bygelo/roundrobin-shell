// The booking pack's view.
//
// First of the nine, and first for the reason docs/frontend.md gives: it is the
// pack every primary buyer needs, and its refusal path is the one worth getting
// right before any other screen exists.
//
// The split this file keeps: everything that DECIDES something is pure and
// below the fold — grouping slots into a board, labelling a time range,
// deciding whether a slot is still actionable. The calls are a thin wrapper
// over the client. The DOM lives in web/, and nothing here imports it.
//
// A note on what is deliberately absent: there is no availability cache and no
// optimistic write. A held slot is a fact the server owns, and pretending
// otherwise is how a booking UI ends up showing a court as free while somebody
// walks onto it.

import type { ShellClient, Session } from '../discovery.ts'

/** One bookable slot, as GET /api/v1/availability returns it. */
export type Slot = {
  session_id: string
  resource_id: string
  resource_code: string
  display_name: string
  /** ISO text on SQLite, an ISO string over JSON from PostgreSQL. Same shape. */
  starts_at: string
  ends_at: string
  price_amount: string
  session_type: string
}

export type Booking = {
  booking_id: string
  booking_code: string
  status: string
  starts_at: string
  ends_at: string
  price_amount: string
  hold_expire_at: string | null
  session_id: string
  resource_id: string
  session_type: string
}

export type Range = { starts_at: Date; ends_at: Date }

export type BookingApi = {
  listAvailable: (session: Session, range: Range, filter?: { site_id?: string; session_type?: string }) => Promise<Slot[]>
  hold: (session: Session, input: { session_id: string; resource_id: string; party_id?: string }) => Promise<Booking>
  confirm: (session: Session, booking_code: string) => Promise<Booking>
  cancel: (session: Session, booking_code: string) => Promise<void>
  find: (session: Session, booking_code: string) => Promise<Booking | null>
}

export function createBookingApi(client: ShellClient): BookingApi {
  return {
    listAvailable: async (session, range, filter) => {
      const body = await client.get<{ slot: Slot[] }>(session, '/api/v1/availability', {
        starts_at: range.starts_at.toISOString(),
        ends_at: range.ends_at.toISOString(),
        site_id: filter?.site_id,
        session_type: filter?.session_type,
      })
      return body.slot
    },

    hold: async (session, input) => {
      const body = await client.post<{ booking: Booking }>(session, '/api/v1/booking', input)
      return body.booking
    },

    confirm: async (session, booking_code) => {
      const body = await client.post<{ booking: Booking }>(
        session,
        `/api/v1/booking/${encodeURIComponent(booking_code)}/confirm`,
      )
      return body.booking
    },

    cancel: async (session, booking_code) => {
      await client.post(session, `/api/v1/booking/${encodeURIComponent(booking_code)}/cancel`)
    },

    find: async (session, booking_code) => {
      const body = await client.get<{ booking: Booking | null }>(
        session,
        `/api/v1/booking/${encodeURIComponent(booking_code)}`,
      )
      return body.booking ?? null
    },
  }
}

// ---------------------------------------------------------------------------
// the pure part
// ---------------------------------------------------------------------------

export type BoardColumn = {
  resource_id: string
  resource_code: string
  display_name: string
  slot: Slot[]
}

/**
 * Availability arrives as a flat list; a board reads by resource.
 *
 * Order is preserved from the server rather than re-sorted here. The booking
 * pack already orders by `s.starts_at, r.sort_order`, and sort_order is the
 * venue's own arrangement of its courts — re-sorting alphabetically would
 * quietly override a decision somebody made on purpose.
 */
export function groupByResource(slot: Slot[]): BoardColumn[] {
  const column = new Map<string, BoardColumn>()

  for (const one of slot) {
    const existing = column.get(one.resource_id)
    if (existing) {
      existing.slot.push(one)
      continue
    }
    column.set(one.resource_id, {
      resource_id: one.resource_id,
      resource_code: one.resource_code,
      display_name: one.display_name,
      slot: [one],
    })
  }

  return [...column.values()]
}

/**
 * "9:00 AM – 10:00 AM", in the tenant's zone.
 *
 * The zone is passed in rather than read from the browser. A venue in Manila
 * administered from Singapore must not see its own evening slots shifted by an
 * hour because of where the laptop happens to be.
 */
export function formatRange(starts_at: string, ends_at: string, time_zone: string): string {
  const time = (value: string): string =>
    new Date(value).toLocaleTimeString('en-PH', {
      timeZone: time_zone,
      hour: 'numeric',
      minute: '2-digit',
    })
  return `${time(starts_at)} – ${time(ends_at)}`
}

/** "Wed 1 Sep", in the tenant's zone, for a board heading. */
export function formatDay(value: string, time_zone: string): string {
  return new Date(value).toLocaleDateString('en-PH', {
    timeZone: time_zone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

/**
 * How long is left on a hold, in whole minutes, or null once it has lapsed.
 *
 * `now` is a parameter so this is testable without waiting ten minutes, and so
 * a board rendering many holds computes them all against one instant rather
 * than drifting across the render.
 */
export function holdMinuteRemaining(booking: Booking, now: Date): number | null {
  if (booking.status !== 'hold' || !booking.hold_expire_at) return null
  const remaining = new Date(booking.hold_expire_at).getTime() - now.getTime()
  if (remaining <= 0) return null
  return Math.ceil(remaining / 60_000)
}

/**
 * What the operator may do with a booking right now.
 *
 * Derived from status rather than tracked alongside it, so a board that
 * re-reads from the server cannot disagree with itself. A lapsed hold offers
 * nothing: the sweep will expire it, and confirming it would 400.
 */
export function actionFor(booking: Booking, now: Date): ('confirm' | 'cancel')[] {
  if (booking.status === 'confirmed') return ['cancel']
  if (booking.status !== 'hold') return []
  return holdMinuteRemaining(booking, now) === null ? [] : ['confirm', 'cancel']
}

/** The default board window: today, in the tenant's zone. */
export function todayRange(now: Date): Range {
  const starts_at = new Date(now)
  starts_at.setHours(0, 0, 0, 0)
  const ends_at = new Date(starts_at)
  ends_at.setDate(ends_at.getDate() + 1)
  return { starts_at, ends_at }
}
