// The notification and commerce views.
//
// The last pair, and paired because they are the two screens a counter has
// open: what went out to whom, and what was sold. Both are logs an operator
// scans for the thing that went wrong, which is why neither defaults to a happy
// filter.
//
// Both packs shipped without a collection read, so neither screen could be
// started until `GET /api/v1/notification` and `GET /api/v1/order` existed.
// That closes K38 at eight packs of eight.

import type { ShellClient, Session } from '../discovery.ts'
import { formatMoney } from './billing.ts'

/**
 * One outbox line.
 *
 * Note what is NOT here: `recipient`, `body`, `claim_token`. The pack projects
 * a mask precisely so a screen an operator leaves open all day cannot display a
 * resident's phone number, and this type refuses to re-introduce it.
 */
export type DeliveryLine = {
  notification_delivery_id: string
  party_id: string | null
  delivery_kind: string
  delivery_channel: string
  recipient_mask: string
  subject: string | null
  is_essential: boolean
  status: string
  attempt_count: number
  created_at: string
}

export type Order = {
  sales_order_id: string
  order_code: string
  status: string
  channel: string
  currency_code: string
  subtotal_amount: string
  total_amount: string
  idempotency_key: string
  buyer_party_id: string | null
  placed_at: string
}

export type CounterApi = {
  listDelivery: (session: Session, filter?: { status?: string; delivery_kind?: string }) => Promise<DeliveryLine[]>
  listOrder: (session: Session, filter?: { status?: string }) => Promise<Order[]>
}

export function createCounterApi(client: ShellClient): CounterApi {
  return {
    listDelivery: async (session, filter) =>
      (
        await client.get<{ notification_delivery: DeliveryLine[] }>(session, '/api/v1/notification', {
          status: filter?.status,
          delivery_kind: filter?.delivery_kind,
        })
      ).notification_delivery,

    listOrder: async (session, filter) =>
      (
        await client.get<{ order: Order[] }>(session, '/api/v1/order', { status: filter?.status })
      ).order,
  }
}

// ---------------------------------------------------------------------------
// the pure part
// ---------------------------------------------------------------------------

export type DeliveryReading = {
  headline: string
  /** What to do about it, when there is anything. */
  detail: string
  /** Whether this line is the operator's problem right now. */
  is_attention: boolean
}

/**
 * What an outbox status means to the person watching it.
 *
 * Same discipline as the gate's deny vocabulary: `failed` with an attempt count
 * is a machine fact, and the operator needs to know whether the system is still
 * trying or has given up — because those want different actions and only one of
 * them is theirs.
 */
export function readDeliveryStatus(status: string, attempt_count: number): DeliveryReading {
  switch (status) {
    case 'queued':
      return {
        headline: 'Waiting to send',
        detail: 'The worker has not picked this up yet.',
        is_attention: false,
      }
    case 'sending':
      return { headline: 'Sending', detail: 'In flight now.', is_attention: false }
    case 'sent':
      return { headline: 'Sent', detail: 'Handed to the provider.', is_attention: false }
    case 'failed':
      return {
        headline: 'Failed',
        detail:
          attempt_count > 1
            ? `Gave up after ${attempt_count} attempts. Check the number and send again.`
            : 'One attempt failed. It will be retried.',
        // Only a genuine give-up is the operator's problem; a first failure
        // that will retry is not, and flagging it trains them to ignore the flag.
        is_attention: attempt_count > 1,
      }
    case 'suppressed':
      return {
        headline: 'Not sent',
        detail: 'Consent or quiet hours blocked it. That is the system working.',
        is_attention: false,
      }
    default:
      return { headline: status, detail: '', is_attention: false }
  }
}

/** Orders and money, for the line at the top of a counter screen. */
export type CounterTally = {
  order_count: number
  /** Assembled in centavo, formatted once — never summed as floats. */
  taken_amount: string
  attention_count: number
}

export function tallyCounter(order: Order[], delivery: DeliveryLine[]): CounterTally {
  // Same reason billing sums in centavo: '0.10' + '0.20' as floats is 0.30000000000000004,
  // and a counter total that disagrees with the ledger is a support call.
  let centavo = 0
  for (const one of order) {
    if (one.status === 'cancelled') continue
    const [whole = '0', fraction = '0'] = one.total_amount.split('.')
    centavo += Math.abs(Number(whole)) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2))
  }

  return {
    order_count: order.filter((one) => one.status !== 'cancelled').length,
    taken_amount: `${Math.floor(centavo / 100)}.${String(centavo % 100).padStart(2, '0')}`,
    attention_count: delivery.filter(
      (one) => readDeliveryStatus(one.status, one.attempt_count).is_attention,
    ).length,
  }
}

/** Money, reusing billing's formatter so two screens cannot disagree. */
export function formatOrderTotal(order: Order): string {
  return formatMoney(order.total_amount, order.currency_code)
}
