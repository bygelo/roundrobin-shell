// The node trees for view/scan.
//
// Fifth render module, same contract as the other four: take an `element`
// factory, return a tree, touch no global, take every side effect as a
// callback.
//
// Three sections in the order an operator asks the questions in: what is a code
// supposed to do (target), what has been printed (code), and what actually
// happened when someone pointed a camera at one (the log). The log is last and
// longest because it is the only one that answers "why did it not work", which
// is the only reason anybody opens this screen in a hurry.

import type { Element } from './render.ts'
import { renderFailure } from './render.ts'
import type { Failure } from './view/failure.ts'
import type { ScanCode, ScanResolution, ScanTarget } from './view/scan.ts'
import {
  codeActionFor,
  describeCodeUse,
  isCodeUsable,
  readOutcome,
  tallyResolution,
  targetFor,
} from './view/scan.ts'

export type ScanState = {
  status: 'loading' | 'ready'
  target: ScanTarget[]
  code: ScanCode[]
  resolution: ScanResolution[]
  failure?: Failure | undefined
  /** From the session, so a reader who may not revoke sees no revoke button. */
  held_capability: string[]
  now: Date
}

export type ScanHandler = {
  onRevoke: (code: ScanCode) => void
  onBack: () => void
}

export function renderScan(
  element: Element,
  input: { display_name: string; state: ScanState },
  handler: ScanHandler,
): unknown[] {
  const { state } = input
  const tally = tallyResolution(state.resolution)

  return [
    element('h2', {}, input.display_name),

    state.failure ? renderFailure(element, state.failure) : '',
    state.status === 'loading' ? element('p', { class: 'muted' }, 'reading the scan log…') : '',

    state.status === 'ready'
      ? element('div', { class: 'summary' }, [
          element('strong', {}, `${tally.resolved_count}`),
          element('span', { class: 'muted' }, ' resolved · '),
          element(
            'span',
            { class: tally.refused_count > 0 ? 'warn' : 'muted' },
            `${tally.refused_count} refused`,
          ),
          // A replay is neither a new use nor a fault, so it is reported
          // quietly and only when there is one to report.
          tally.replay_count > 0
            ? element('span', { class: 'muted' }, ` · ${tally.replay_count} repeat`)
            : '',
        ])
      : '',

    state.status === 'ready' ? renderTarget(element, state) : '',
    state.status === 'ready' ? renderCode(element, state, handler) : '',
    state.status === 'ready' ? renderLog(element, state) : '',

    element('button', { class: 'small', onclick: handler.onBack }, 'Back'),
  ]
}

/** What happens when a code resolves. One row per action. */
function renderTarget(element: Element, state: ScanState): unknown {
  return element('div', { class: 'target-list' }, [
    element('h3', {}, 'What a code does'),

    state.target.length === 0
      ? element('p', { class: 'muted small-text' }, 'No target configured.')
      : element(
          'ul',
          { class: 'plain' },
          state.target.map((one) =>
            element('li', { class: one.is_active ? 'target' : 'target shut' }, [
              element('strong', {}, one.display_name),
              element('span', { class: 'muted' }, ` · ${one.kind}`),
              one.is_active ? '' : element('span', { class: 'muted' }, ' · inactive'),

              element(
                'p',
                { class: 'muted small-text' },
                one.destination_url ?? one.command_code ?? 'nothing to dispatch',
              ),

              // The security property, said out loud. A target with this set is
              // deliberately unreachable from the anonymous /scan/:token path,
              // and that is the whole reason a menu and a door can share one
              // mechanism.
              one.required_capability
                ? element('p', { class: 'small-text' }, [
                    element('span', { class: 'warn' }, 'Signed-in scanner only'),
                    element('span', { class: 'muted' }, ` — needs ${one.required_capability}`),
                  ])
                : '',
            ]),
          ),
        ),
  ])
}

/** What has been printed. Many per target. */
function renderCode(element: Element, state: ScanState, handler: ScanHandler): unknown {
  return element('div', { class: 'code-list' }, [
    element('h3', {}, 'What is printed'),

    state.code.length === 0
      ? element('p', { class: 'muted small-text' }, 'Nothing minted yet.')
      : element(
          'ul',
          { class: 'plain' },
          state.code.map((one) => {
            const usable = isCodeUsable(one, state.now)
            const target = targetFor(one, state.target)

            return element('li', { class: usable ? 'code' : 'code spent' }, [
              element('strong', {}, one.label ?? one.scan_code_id.slice(0, 8)),
              element(
                'span',
                { class: 'muted' },
                ` · ${target ? target.display_name : 'unknown target'} · ${describeCodeUse(one)}`,
              ),

              // Why it cannot be used, when it cannot. "Spent" and "cancelled"
              // and "not yet open" want different responses from an operator
              // holding a queue, so the row says which.
              usable ? '' : element('p', { class: 'muted small-text' }, whyUnusable(one, state.now)),

              element(
                'div',
                { class: 'action' },
                codeActionFor(one, state.held_capability).map(() =>
                  element(
                    'button',
                    { class: 'small revoke', onclick: () => handler.onRevoke(one) },
                    'Revoke',
                  ),
                ),
              ),
            ])
          }),
        ),
  ])
}

/**
 * Why a code is not usable, as a sentence.
 *
 * Ordered the way `resolveCode` orders its checks, so the screen and the server
 * never name different reasons for the same row.
 */
function whyUnusable(code: ScanCode, now: Date): string {
  if (code.revoked_at !== null || !code.is_active) return 'Cancelled.'
  if (code.use_limit !== null && code.use_count >= code.use_limit) {
    return 'Every use has been spent. Issue another rather than raising the limit.'
  }
  if (now.getTime() < new Date(code.valid_from).getTime()) return 'Its window has not opened yet.'
  return 'Its window has closed.'
}

/** The append-only truth, refusals included. */
function renderLog(element: Element, state: ScanState): unknown {
  return element('div', { class: 'resolution-log' }, [
    element('h3', {}, 'What happened'),

    state.resolution.length === 0
      ? element('p', { class: 'muted small-text' }, 'Nothing scanned yet.')
      : element(
          'ul',
          { class: 'plain' },
          state.resolution.map((one) => {
            const reading = readOutcome(one.outcome, one.is_replay)

            return element(
              'li',
              { class: reading.is_refusal ? 'resolution refused' : 'resolution' },
              [
                element('strong', { class: reading.is_refusal ? 'warn' : '' }, reading.headline),
                one.label ? element('span', { class: 'muted' }, ` · ${one.label}`) : '',
                one.use_remaining !== null
                  ? element('span', { class: 'muted' }, ` · ${one.use_remaining} left`)
                  : '',
                element('p', { class: 'muted small-text' }, reading.detail),
                // The pack's own note, when it left one. Shown under the
                // shell's sentence rather than instead of it — the pack writes
                // for a log reader, this screen writes for whoever is standing
                // at the door.
                one.detail ? element('p', { class: 'muted small-text' }, one.detail) : '',
              ],
            )
          }),
        ),
  ])
}
