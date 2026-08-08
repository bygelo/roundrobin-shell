// The node trees for view/notification and view/commerce.
//
// Fourth and last render module. Same contract throughout: take an `element`
// factory, return a tree, touch no global, take every side effect as a callback.
//
// Both screens are logs an operator scans for the thing that went wrong, so
// neither hides a bad row behind a cheerful default, and neither shouts about a
// row that is merely in progress. A flag that fires on every first retry is a
// flag people learn to ignore.

import type { Element } from './render.ts'
import { renderFailure } from './render.ts'
import type { Failure } from './view/failure.ts'
import type { DeliveryLine, Order } from './view/counter.ts'
import { formatOrderTotal, readDeliveryStatus, tallyCounter } from './view/counter.ts'
import { formatMoney } from './view/billing.ts'

export type CounterState = {
  status: 'loading' | 'ready'
  delivery: DeliveryLine[]
  order: Order[]
  failure?: Failure | undefined
  zone: string
}

export type CounterHandler = { onBack: () => void }

/** view/notification — what went out, to whom, and whether it arrived. */
export function renderOutbox(
  element: Element,
  input: { display_name: string; state: CounterState },
  handler: CounterHandler,
): unknown[] {
  const { state } = input
  const tally = tallyCounter(state.order, state.delivery)

  return [
    element('h2', {}, input.display_name),
    state.failure ? renderFailure(element, state.failure) : '',
    state.status === 'loading' ? element('p', { class: 'muted' }, 'reading the outbox…') : '',

    state.status === 'ready'
      ? element('div', { class: 'summary' }, [
          element('strong', {}, `${state.delivery.length}`),
          element('span', { class: 'muted' }, ' delivery · '),
          element(
            'span',
            { class: tally.attention_count > 0 ? 'warn' : 'muted' },
            `${tally.attention_count} needing attention`,
          ),
        ])
      : '',

    state.status === 'ready' && state.delivery.length === 0
      ? element('p', { class: 'muted' }, 'Nothing sent yet.')
      : '',

    state.status === 'ready' && state.delivery.length > 0
      ? element(
          'ul',
          { class: 'plain outbox' },
          state.delivery.map((one) => {
            const reading = readDeliveryStatus(one.status, one.attempt_count)
            return element(
              'li',
              { class: reading.is_attention ? 'delivery attention' : 'delivery' },
              [
                element('strong', {}, reading.headline),
                // The MASK. The pack refuses to send the real recipient and the
                // screen must not imply it has one.
                element('span', { class: 'muted' }, ` ${one.recipient_mask} · ${one.delivery_kind}`),
                reading.detail
                  ? element('p', { class: 'muted small-text' }, reading.detail)
                  : '',
              ],
            )
          }),
        )
      : '',

    element('button', { class: 'small', onclick: handler.onBack }, 'Back'),
  ]
}

/** view/commerce — what the counter sold. */
export function renderCounter(
  element: Element,
  input: { display_name: string; state: CounterState },
  handler: CounterHandler,
): unknown[] {
  const { state } = input
  const tally = tallyCounter(state.order, state.delivery)

  return [
    element('h2', {}, input.display_name),
    state.failure ? renderFailure(element, state.failure) : '',
    state.status === 'loading' ? element('p', { class: 'muted' }, 'reading the counter…') : '',

    state.status === 'ready'
      ? element('div', { class: 'summary' }, [
          element('strong', {}, formatMoney(tally.taken_amount)),
          element('span', { class: 'muted' }, ` taken across ${tally.order_count} order`),
        ])
      : '',

    state.status === 'ready' && state.order.length === 0
      ? element('p', { class: 'muted' }, 'No order yet.')
      : '',

    state.status === 'ready' && state.order.length > 0
      ? element(
          'ul',
          { class: 'plain order-list' },
          state.order.map((one) =>
            element(
              'li',
              { class: one.status === 'cancelled' ? 'order cancelled' : 'order' },
              [
                element('strong', {}, one.order_code),
                element('span', { class: 'muted' }, ` ${one.status} · ${one.channel} · `),
                element('strong', {}, formatOrderTotal(one)),
              ],
            ),
          ),
        )
      : '',

    element('button', { class: 'small', onclick: handler.onBack }, 'Back'),
  ]
}
