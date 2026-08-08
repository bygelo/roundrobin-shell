// The node trees for the gate story — view/membership and view/access.
//
// A second render module rather than more of render.ts, which had reached the
// length where finding anything means scrolling. Same contract exactly: take an
// `element` factory, return a tree, touch no global, take every side effect as a
// callback. So the same test approach reaches these.
//
// The decision this file carries is the deny vocabulary reaching the screen. A
// gate that prints `trip_limit` at somebody standing in a doorway has told the
// guard nothing they can act on — and unlike a 409 on a booking screen, the
// person reading it has to decide what to do in the next few seconds.

import type { NodeLike } from './dom.ts'
import type { Element } from './render.ts'
import { renderFailure } from './render.ts'
import type { Failure } from './view/failure.ts'
import type {
  AccessPoint,
  Credential,
  Membership,
  Pass,
  ScanEvent,
  ScanResult,
} from './view/gate.ts'
import { describeUse, isPassUsable, readDeny, tallyScan } from './view/gate.ts'

// ---------------------------------------------------------------------------
// view/membership — may this person come in
// ---------------------------------------------------------------------------

export type MembershipState = {
  status: 'loading' | 'ready'
  membership: Membership[]
  pass: Pass[]
  credential: Credential[]
  failure?: Failure | undefined
  now: Date
}

export function renderMembership(
  element: Element,
  input: { display_name: string; state: MembershipState },
  handler: { onBack: () => void },
): unknown[] {
  const { state } = input

  return [
    element('h2', {}, input.display_name),
    state.failure ? renderFailure(element, state.failure) : '',
    state.status === 'loading' ? element('p', { class: 'muted' }, 'reading entitlement…') : '',

    state.status === 'ready'
      ? element('div', { class: 'summary' }, [
          element('strong', {}, `${state.membership.length}`),
          element('span', { class: 'muted' }, ' membership · '),
          element('strong', {}, `${state.pass.filter((one) => isPassUsable(one, state.now)).length}`),
          element('span', { class: 'muted' }, ' pass usable now'),
        ])
      : '',

    state.status === 'ready'
      ? element('div', { class: 'pass-list' }, [
          element('h3', {}, 'Pass'),
          state.pass.length === 0
            ? element('p', { class: 'muted small-text' }, 'No pass issued.')
            : element(
                'ul',
                { class: 'plain' },
                state.pass.map((one) =>
                  element(
                    'li',
                    { class: isPassUsable(one, state.now) ? 'pass usable' : 'pass spent' },
                    [
                      element('strong', {}, one.pass_code),
                      element('span', { class: 'muted' }, ` ${one.status} · ${describeUse(one)}`),
                    ],
                  ),
                ),
              ),
        ])
      : '',

    state.status === 'ready'
      ? element('div', { class: 'credential-list' }, [
          element('h3', {}, 'Credential'),
          state.credential.length === 0
            ? element('p', { class: 'muted small-text' }, 'Nothing enrolled.')
            : element(
                'ul',
                { class: 'plain' },
                state.credential.map((one) =>
                  element('li', { class: 'credential' }, [
                    element('strong', {}, one.display_label ?? one.credential_kind),
                    element('span', { class: 'muted' }, ` ${one.credential_kind}`),
                    one.is_active ? '' : element('span', { class: 'pill' }, 'inactive'),
                  ]),
                ),
              ),
        ])
      : '',

    element('button', { class: 'small', onclick: handler.onBack }, 'Back'),
  ]
}

// ---------------------------------------------------------------------------
// view/access — did they get in, and what happened
// ---------------------------------------------------------------------------

export type ConsoleState = {
  status: 'loading' | 'ready'
  point: AccessPoint[]
  /** The gate this console is watching. */
  selected_access_point_id: string | null
  scan: ScanEvent[]
  /** The last scan this console performed, so its verdict stays on screen. */
  last: ScanResult | null
  failure?: Failure | undefined
  held_capability: string[]
  zone: string
}

export type ConsoleHandler = {
  onSelectPoint: (point: AccessPoint) => void
  onScan: (presented: string) => void
  onBack: () => void
}

export function renderConsole(
  element: Element,
  input: { display_name: string; state: ConsoleState },
  handler: ConsoleHandler,
): unknown[] {
  const { state } = input
  const tally = tallyScan(state.scan)

  // Presenting a code is a WRITE. A guard who may only watch the feed gets no
  // input at all — absent, not disabled.
  const may_scan = state.held_capability.includes('access.write')

  return [
    element('h2', {}, input.display_name),
    state.failure ? renderFailure(element, state.failure) : '',
    state.status === 'loading' ? element('p', { class: 'muted' }, 'reading the gate…') : '',

    // Which door. A feed cannot be read without knowing that.
    state.status === 'ready'
      ? element('div', { class: 'gate-picker' }, [
          state.point.length === 0
            ? element('p', { class: 'muted' }, 'No access point configured.')
            : element(
                'div',
                { class: 'action' },
                state.point.map((one) =>
                  element(
                    'button',
                    {
                      class:
                        one.access_point_id === state.selected_access_point_id
                          ? 'small gate chosen'
                          : 'small gate',
                      onclick: () => handler.onSelectPoint(one),
                    },
                    [
                      one.display_name,
                      one.is_active ? '' : element('span', { class: 'pill' }, 'off'),
                    ],
                  ),
                ),
              ),
        ])
      : '',

    // The verdict. This is what a guard is actually looking at.
    state.last ? renderVerdict(element, state.last) : '',

    state.status === 'ready' && may_scan && state.selected_access_point_id
      ? element('form', { class: 'scan-form', onsubmit: onSubmit }, [
          element('input', { name: 'presented', type: 'text', autocomplete: 'off' }),
          element('button', { type: 'submit', class: 'small present' }, 'Present'),
        ])
      : '',

    state.status === 'ready'
      ? element('div', { class: 'feed' }, [
          element('h3', {}, 'Recent'),
          element('p', { class: 'muted small-text' }, [
            `${tally.allowed_count} allowed · `,
            element(
              'span',
              { class: tally.denied_count > 0 ? 'warn' : 'muted' },
              `${tally.denied_count} denied`,
            ),
          ]),
          state.scan.length === 0
            ? element('p', { class: 'muted small-text' }, 'Nothing yet.')
            : element(
                'ul',
                { class: 'plain' },
                state.scan.map((one) =>
                  element(
                    'li',
                    { class: one.outcome === 'allowed' ? 'scan allowed' : 'scan denied' },
                    [
                      element(
                        'strong',
                        {},
                        one.outcome === 'allowed'
                          ? 'allowed'
                          : readDeny(one.deny_reason_code).headline,
                      ),
                      element(
                        'span',
                        { class: 'muted small-text' },
                        ` ${new Date(one.occurred_at).toLocaleTimeString('en-PH', { timeZone: state.zone })}`,
                      ),
                    ],
                  ),
                ),
              ),
        ])
      : '',

    element('button', { class: 'small', onclick: handler.onBack }, 'Back'),
  ]

  function onSubmit(event: unknown) {
    const submitted = event as { preventDefault?: () => void; target?: unknown }
    submitted.preventDefault?.()
    handler.onScan(readPresented(submitted.target))
  }
}

/**
 * The scan verdict, as a guard reads it.
 *
 * A deny shows the sentence and the next move, never the pack's
 * `deny_reason_code`.
 */
function renderVerdict(element: Element, last: ScanResult): NodeLike {
  if (last.outcome === 'allowed') {
    return element('div', { class: 'verdict allowed' }, [
      element('strong', {}, 'Let them in'),
      last.barrier?.is_opened ? element('span', { class: 'muted' }, ' barrier opened') : '',
      // A replay is not a second entry. Saying so stops a guard counting one
      // person twice when a phone retried on bad wifi.
      last.is_replay ? element('span', { class: 'pill' }, 'repeat scan') : '',
    ])
  }

  const reading = readDeny(last.deny_reason_code)
  return element('div', { class: 'verdict denied' }, [
    element('strong', {}, reading.headline),
    element('p', { class: 'small-text' }, reading.detail),
    reading.is_resolvable ? element('span', { class: 'pill' }, 'a supervisor can clear this') : '',
  ])
}

/** Pull the typed code out of the form, without assuming a real DOM. */
function readPresented(target: unknown): string {
  const form = target as { elements?: { presented?: { value?: string } } } | null
  return form?.elements?.presented?.value ?? ''
}
