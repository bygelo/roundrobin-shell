// The node trees the browser layer draws.
//
// Extracted out of web/shell.js for one reason: **nobody had ever watched the
// page render.** The logic underneath was covered and the primitive above it
// was covered, but the assembly between them — which button appears next to a
// lapsed hold, whether a refusal reads as news or as an error, whether an
// action a session lacks is really absent rather than merely styled — was not
// tested at all. That is exactly the layer where a missing button hides,
// because a missing button produces no error and nobody reports what they never
// saw.
//
// So these functions take an `element` factory and return a tree. They touch no
// global document, no client, and no storage; every side effect is a callback
// the caller supplies. A test builds the same trees against a stub document.
//
// Nothing here fetches. A view renders the state it is handed, which means a
// test can put the shell into a state — a lapsed hold, a contested slot, a
// session that may read but not write — that would be tedious to provoke
// against a live server and impossible to hold still.

import type { NodeLike } from './dom.ts'
import type { Navigation, NavigationItem } from './navigation.ts'
import type { Booking, BoardColumn, Slot } from './view/booking.ts'
import type { Failure } from './view/failure.ts'
import { actionFor, formatDay, formatRange, holdMinuteRemaining } from './view/booking.ts'

/** The `element` helper from dom.ts, once bound to a document. */
export type Element = (tag: string, attribute?: Record<string, string | ((event: unknown) => void)>, child?: unknown) => NodeLike

// ---------------------------------------------------------------------------
// sign in
// ---------------------------------------------------------------------------

export type SignInHandler = {
  onSubmit: (event: unknown) => void
}

export function renderSignIn(
  element: Element,
  input: { brand: string; message?: string | undefined },
  handler: SignInHandler,
): NodeLike {
  const field = (name: string, label: string, value: string, type = 'text'): NodeLike =>
    element('label', {}, [
      element('span', {}, label),
      element('input', { name, type, value, autocomplete: 'off' }),
    ])

  return element('form', { class: 'card', onsubmit: handler.onSubmit }, [
    element('h1', {}, input.brand),
    element('p', { class: 'muted' }, 'Sign in to see what this tenant has enabled.'),
    field('organization_code', 'Organization', 'shell-dev'),
    field('actor_code', 'Actor', 'operator'),
    field('secret', 'Secret', '', 'password'),
    element('button', { type: 'submit' }, 'Sign in'),
    // The server deliberately does not say WHICH of the three was wrong, and
    // this must not embellish it into something that does.
    input.message ? element('p', { class: 'error' }, input.message) : '',
  ])
}

// ---------------------------------------------------------------------------
// navigation
// ---------------------------------------------------------------------------

export type NavigationHandler = {
  onSelect: (item: NavigationItem) => void
  onSignOut: () => void
}

export function renderNavigation(
  element: Element,
  input: { brand: string; navigation: Navigation },
  handler: NavigationHandler,
): NodeLike {
  return element('nav', {}, [
    element('div', { class: 'brand' }, input.brand),
    ...input.navigation.item.map((item) =>
      element('button', { class: 'nav-item', onclick: () => handler.onSelect(item) }, [
        item.display_name,
        item.is_upgrade_pending ? element('span', { class: 'pill' }, 'migration pending') : '',
      ]),
    ),
    element('button', { class: 'nav-item quiet', onclick: handler.onSignOut }, 'Sign out'),
  ])
}

export function renderDiscovery(element: Element, navigation: Navigation): unknown[] {
  return [
    element('h2', {}, 'Discovery'),
    element('p', { class: 'muted' }, [
      `${navigation.item.length} module enabled for this session. `,
      'Turn one off in the database and reload — nothing here is deployed.',
    ]),
    element(
      'ul',
      { class: 'plain' },
      navigation.item.map((one) =>
        element('li', {}, [
          element('strong', {}, one.display_name),
          element('span', { class: 'muted' }, ` — ${one.route_prefix.join(', ') || 'no route'}`),
          one.action.length
            ? element(
                'div',
                { class: 'action' },
                one.action.map((action) => element('button', { class: 'small' }, action.display_name)),
              )
            : element('p', { class: 'muted small-text' }, 'read only for this session'),
        ]),
      ),
    ),
    // Surfaced rather than dropped. "Enabled but undrawn" and "disabled" want
    // very different responses from whoever is looking.
    navigation.undrawn_module_code.length
      ? element('p', { class: 'warn' }, [
          'Enabled, but this shell has no screens for: ',
          navigation.undrawn_module_code.join(', '),
        ])
      : '',
    element('p', { class: 'muted small-text' }, `tenant ${navigation.organization_id}`),
  ]
}

export function renderNotBuilt(
  element: Element,
  input: { display_name: string; noun: string; route_prefix: string[] },
  handler: { onBack: () => void },
): unknown[] {
  return [
    element('h2', {}, input.display_name),
    element('p', { class: 'muted' }, [
      `Screens for ${input.noun} are not built yet. `,
      `This module answers on ${input.route_prefix.join(', ') || 'no route'}.`,
    ]),
    element('button', { class: 'small', onclick: handler.onBack }, 'Back'),
  ]
}

// ---------------------------------------------------------------------------
// a refusal
// ---------------------------------------------------------------------------

/**
 * A refusal, as a banner.
 *
 * The class is chosen by `is_retryable` rather than by status, and that is the
 * design decision this function exists to hold: a contested slot is not an
 * error state, it is news. Painting it red teaches an operator that the system
 * is broken when what actually happened is that the system worked.
 */
export function renderFailure(element: Element, failure: Failure): NodeLike {
  return element('div', { class: failure.is_retryable ? 'notice' : 'error-box' }, [
    element('strong', {}, failure.headline),
    element('p', { class: 'small-text' }, failure.detail),
  ])
}

// ---------------------------------------------------------------------------
// view/booking
// ---------------------------------------------------------------------------

export type BoardState = {
  status: 'loading' | 'ready'
  column: BoardColumn[]
  held: Booking | null
  failure?: Failure | undefined
  zone: string
  day: string
  now: Date
}

export type BoardHandler = {
  onHold: (slot: Slot) => void
  onConfirm: (booking: Booking) => void
  onCancel: (booking: Booking) => void
  onBack: () => void
}

export function renderBoard(
  element: Element,
  input: { display_name: string; state: BoardState },
  handler: BoardHandler,
): unknown[] {
  const { state } = input

  return [
    element('h2', {}, input.display_name),
    element('p', { class: 'muted small-text' }, formatDay(state.day, state.zone)),

    state.failure ? renderFailure(element, state.failure) : '',
    state.status === 'loading' ? element('p', { class: 'muted' }, 'reading availability…') : '',
    state.held ? renderHold(element, state, handler) : '',

    state.status === 'ready' && state.column.length === 0
      ? element('p', { class: 'muted' }, 'Nothing bookable in this window.')
      : '',

    ...state.column.map((column) =>
      element('div', { class: 'column' }, [
        element('h3', {}, column.display_name),
        element(
          'div',
          { class: 'action' },
          column.slot.map((one) =>
            element(
              'button',
              { class: 'small slot', onclick: () => handler.onHold(one) },
              `${formatRange(one.starts_at, one.ends_at, state.zone)} · ₱${one.price_amount}`,
            ),
          ),
        ),
      ]),
    ),

    element('button', { class: 'small', onclick: handler.onBack }, 'Back'),
  ]
}

function renderHold(element: Element, state: BoardState, handler: BoardHandler): NodeLike {
  const booking = state.held!
  const remaining = holdMinuteRemaining(booking, state.now)

  // Derived from status, never tracked alongside it — so a board that re-reads
  // from the server cannot disagree with itself. A lapsed hold offers nothing,
  // because confirming one 400s and offering the button would be an invitation
  // to a refusal the shell could see coming.
  const available = actionFor(booking, state.now)

  return element('div', { class: 'hold' }, [
    element('strong', {}, `${booking.status} · ${booking.booking_code}`),
    element(
      'span',
      { class: 'muted' },
      remaining === null
        ? booking.status === 'confirmed'
          ? ' confirmed'
          : ' this hold has lapsed'
        : ` ${remaining} minute left to confirm`,
    ),
    element(
      'div',
      { class: 'action' },
      available.map((action) =>
        element(
          'button',
          {
            class: `small ${action}`,
            onclick: () => (action === 'confirm' ? handler.onConfirm(booking) : handler.onCancel(booking)),
          },
          action === 'confirm' ? 'Confirm' : 'Cancel',
        ),
      ),
    ),
  ])
}
