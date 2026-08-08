// The notification and commerce views — pure half and rendering.
//
// Two assertions carry this file. A masked recipient must stay masked, because
// an outbox is a screen an operator leaves open all day. And a flag must only
// fire on a genuine give-up: a warning that appears on every first retry is a
// warning people stop reading, which costs more than not having one.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from '../src/dom.ts'
import { renderCounter, renderOutbox, type CounterState } from '../src/render-counter.ts'
import {
  formatOrderTotal,
  readDeliveryStatus,
  tallyCounter,
  type DeliveryLine,
  type Order,
} from '../src/view/counter.ts'
import { byClass, stubDocument, textOf } from './stub-dom.ts'

const element = createElement(stubDocument())

function delivery(over: Partial<DeliveryLine> = {}): DeliveryLine {
  return {
    notification_delivery_id: 'nd',
    party_id: 'p',
    delivery_kind: 'payment_link',
    delivery_channel: 'sms',
    recipient_mask: '+63917****567',
    subject: null,
    is_essential: true,
    status: 'queued',
    attempt_count: 0,
    created_at: '2027-04-01T12:00:00.000Z',
    ...over,
  }
}

function order(over: Partial<Order> = {}): Order {
  return {
    sales_order_id: 'so',
    order_code: 'ord_001',
    status: 'placed',
    channel: 'pos',
    currency_code: 'PHP',
    subtotal_amount: '300.00',
    total_amount: '300.00',
    idempotency_key: 'k',
    buyer_party_id: 'p',
    placed_at: '2027-04-01T12:00:00.000Z',
    ...over,
  }
}

function state(over: Partial<CounterState> = {}): CounterState {
  return {
    status: 'ready',
    delivery: [delivery()],
    order: [order()],
    zone: 'Asia/Manila',
    ...over,
  }
}

const NOOP = { onBack: () => {} }

describe('what an outbox status means', () => {
  it('turns every status into something a person reads', () => {
    for (const one of ['queued', 'sending', 'sent', 'failed', 'suppressed']) {
      const reading = readDeliveryStatus(one, 1)
      assert.ok(reading.headline.length > 2, `${one} needs a headline`)
      assert.doesNotMatch(reading.headline, /_/, `${one} leaked a machine code`)
    }
  })

  // THE flag test. A warning on every first retry is a warning people stop
  // reading, and then the real give-up goes unnoticed too.
  it('flags a give-up but not a first failure that will retry', () => {
    assert.equal(readDeliveryStatus('failed', 1).is_attention, false, 'it will retry')
    assert.equal(readDeliveryStatus('failed', 3).is_attention, true, 'it gave up')
    assert.match(readDeliveryStatus('failed', 3).detail, /Gave up after 3/)
  })

  it('does not flag a suppressed message, which is the system working', () => {
    const reading = readDeliveryStatus('suppressed', 0)
    assert.equal(reading.is_attention, false)
    assert.match(reading.detail, /system working/)
  })

  it('does not flag anything merely in flight', () => {
    assert.equal(readDeliveryStatus('queued', 0).is_attention, false)
    assert.equal(readDeliveryStatus('sending', 0).is_attention, false)
    assert.equal(readDeliveryStatus('sent', 1).is_attention, false)
  })

  it('shows an unknown status rather than inventing wording for it', () => {
    assert.equal(readDeliveryStatus('some_future_state', 0).headline, 'some_future_state')
  })
})

describe('the counter tally', () => {
  // Same reason billing sums in centavo. A counter total that disagrees with
  // the ledger by a centavo is a support call.
  it('sums money exactly, where floats would drift', () => {
    const tally = tallyCounter(
      [order({ total_amount: '0.10' }), order({ total_amount: '0.20' })],
      [],
    )
    assert.equal(tally.taken_amount, '0.30')
    assert.notEqual(String(0.1 + 0.2), '0.30', 'the float route really is wrong here')
  })

  it('excludes a cancelled order from both the count and the total', () => {
    const tally = tallyCounter(
      [order(), order({ status: 'cancelled', total_amount: '999.00' })],
      [],
    )
    assert.equal(tally.order_count, 1)
    assert.equal(tally.taken_amount, '300.00')
  })

  it('counts only the deliveries that need attention', () => {
    const tally = tallyCounter(
      [],
      [
        delivery({ status: 'failed', attempt_count: 3 }),
        delivery({ status: 'failed', attempt_count: 1 }),
        delivery({ status: 'sent' }),
      ],
    )
    assert.equal(tally.attention_count, 1)
  })

  it('formats an order total through billing’s formatter, so screens agree', () => {
    assert.equal(formatOrderTotal(order({ total_amount: '1234.50' })), '₱1,234.50')
  })
})

describe('the outbox renders', () => {
  // An outbox is a screen an operator leaves open all day.
  it('shows the mask and nothing that could be a real recipient', () => {
    const tree = element(
      'div',
      {},
      renderOutbox(element, { display_name: 'Notification', state: state() }, NOOP),
    )
    const text = textOf(tree)
    assert.match(text, /\+63917\*\*\*\*567/)
    assert.doesNotMatch(text, /\+639171234567/)
    assert.doesNotMatch(text, /@/, 'no address either')
  })

  it('marks a give-up and leaves a retry alone', () => {
    const tree = element(
      'div',
      {},
      renderOutbox(
        element,
        {
          display_name: 'Notification',
          state: state({
            delivery: [
              delivery({ status: 'failed', attempt_count: 3 }),
              delivery({ status: 'failed', attempt_count: 1 }),
            ],
          }),
        },
        NOOP,
      ),
    )
    assert.equal(byClass(tree, 'attention').length, 1)
    assert.equal(byClass(tree, 'delivery').length, 2)
  })

  it('keeps the attention count quiet when nothing needs it', () => {
    const tree = element(
      'div',
      {},
      renderOutbox(
        element,
        { display_name: 'Notification', state: state({ delivery: [delivery({ status: 'sent' })] }) },
        NOOP,
      ),
    )
    assert.equal(byClass(byClass(tree, 'summary')[0], 'warn').length, 0)
  })

  it('says the outbox is empty rather than drawing an empty list', () => {
    const tree = element(
      'div',
      {},
      renderOutbox(element, { display_name: 'Notification', state: state({ delivery: [] }) }, NOOP),
    )
    assert.match(textOf(tree), /Nothing sent yet/)
  })

  it('does not claim it is empty while it is still loading', () => {
    const tree = element(
      'div',
      {},
      renderOutbox(
        element,
        { display_name: 'Notification', state: state({ status: 'loading', delivery: [] }) },
        NOOP,
      ),
    )
    assert.doesNotMatch(textOf(tree), /Nothing sent yet/)
    assert.match(textOf(tree), /reading the outbox/)
  })
})

describe('the counter renders', () => {
  it('leads with what was taken', () => {
    const tree = element(
      'div',
      {},
      renderCounter(element, { display_name: 'Commerce', state: state() }, NOOP),
    )
    assert.match(textOf(byClass(tree, 'summary')[0]), /₱300\.00/)
    assert.match(textOf(byClass(tree, 'summary')[0]), /1 order/)
  })

  it('marks a cancelled order and leaves it out of the total', () => {
    const tree = element(
      'div',
      {},
      renderCounter(
        element,
        {
          display_name: 'Commerce',
          state: state({ order: [order(), order({ status: 'cancelled', total_amount: '999.00' })] }),
        },
        NOOP,
      ),
    )
    assert.equal(byClass(tree, 'cancelled').length, 1)
    assert.match(textOf(byClass(tree, 'summary')[0]), /₱300\.00/)
  })

  it('says so when nothing has been sold', () => {
    const tree = element(
      'div',
      {},
      renderCounter(element, { display_name: 'Commerce', state: state({ order: [] }) }, NOOP),
    )
    assert.match(textOf(tree), /No order yet/)
  })
})
