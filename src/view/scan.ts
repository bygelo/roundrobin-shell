// The scan view.
//
// Ninth and last, and it exists because of a finding rather than a plan. K60
// gave `access` a dependency on `scan`, so every composition that installs a
// gate now also installs scan — and the shell reported it as undrawn on a real
// tenant while its own gate stayed green, because every pure test builds its
// own capability payload and none of them had ever met a live composition. Two
// live tests were red about it for exactly as long as nobody ran them.
//
// What the pack is: a printed code resolves to an action. Three tables —
// `scan_target` (WHAT happens), `scan_code` (a printed thing pointing at one),
// `scan_resolution` (an append-only log of every resolution, refusals
// included). See docs/scan.md in the OS repo.
//
// The pure half is the outcome vocabulary, and it carries one distinction the
// pack is emphatic about: **a cancelled code must not read as a forgery.**
// `revoked` and `unknown_code` are different sentences because the person
// holding the printout is a different person in each case, and whoever reads
// the log has to be able to tell them apart. The gate's deny vocabulary exists
// for the same reason and this is deliberately its sibling.

import type { ShellClient, Session } from '../discovery.ts'

/** What resolving a code does. One row per action, many codes per target. */
export type ScanTarget = {
  scan_target_id: string
  scan_target_code: string
  kind: 'link' | 'media' | 'command' | 'record' | 'pass'
  display_name: string
  destination_url: string | null
  command_code: string | null
  /**
   * When set, the target refuses on the anonymous `/scan/:token` path.
   *
   * This is the property that keeps "the token is the credential" safe for a
   * table tent and unavailable to anything that opens a door, so the screen
   * shows it rather than leaving it to be inferred.
   */
  required_capability: string | null
  is_active: boolean
}

/** A printed code. Forty table tents are forty of these against one target. */
export type ScanCode = {
  scan_code_id: string
  scan_target_id: string
  token: string
  label: string | null
  subject_id: string | null
  valid_from: string
  valid_until: string | null
  use_limit: number | null
  use_count: number
  is_active: boolean
  revoked_at: string | null
}

export type ScanResolutionOutcome =
  | 'resolved'
  | 'unknown_code'
  | 'revoked'
  | 'not_yet_valid'
  | 'expired'
  | 'use_limit_reached'
  | 'forbidden'

export type ScanResolution = {
  scan_resolution_id: string
  outcome: ScanResolutionOutcome
  /** A repeat under the same `client_scan_id`. It consumed nothing. */
  is_replay?: boolean
  scan_code_id: string | null
  label: string | null
  /** Uses left after this one; null when the code is unlimited. */
  use_remaining: number | null
  detail: string | null
  created_at: string
}

export type ScanApi = {
  listTarget: (session: Session) => Promise<ScanTarget[]>
  listCode: (session: Session, filter?: { scan_target_id?: string }) => Promise<ScanCode[]>
  listResolution: (session: Session, filter?: { limit_count?: number }) => Promise<ScanResolution[]>
  revokeCode: (session: Session, scan_code_id: string) => Promise<ScanCode>
}

export function createScanApi(client: ShellClient): ScanApi {
  return {
    listTarget: async (session) =>
      (await client.get<{ scan_target: ScanTarget[] }>(session, '/api/v1/scan/target')).scan_target,

    listCode: async (session, filter) =>
      (
        await client.get<{ scan_code: ScanCode[] }>(session, '/api/v1/scan/code', {
          scan_target_id: filter?.scan_target_id,
        })
      ).scan_code,

    listResolution: async (session, filter) =>
      (
        await client.get<{ scan_resolution: ScanResolution[] }>(session, '/api/v1/scan/resolution', {
          limit_count: filter?.limit_count === undefined ? undefined : String(filter.limit_count),
        })
      ).scan_resolution,

    revokeCode: async (session, scan_code_id) =>
      (
        await client.post<{ scan_code: ScanCode }>(
          session,
          `/api/v1/scan/code/${scan_code_id}/revoke`,
          {},
        )
      ).scan_code,
  }
}

// ---------------------------------------------------------------------------
// the pure part
// ---------------------------------------------------------------------------

export type OutcomeReading = {
  headline: string
  /** What it means for the person standing there, and what to do about it. */
  detail: string
  /** Whether this line is a refusal. Drives styling, never a permission. */
  is_refusal: boolean
}

const OUTCOME_READING: Record<ScanResolutionOutcome, OutcomeReading> = {
  resolved: {
    headline: 'Resolved',
    detail: 'The code was valid and the action was handed to whoever dispatches it.',
    is_refusal: false,
  },

  // These two are the pair that must never collapse into one sentence.
  unknown_code: {
    headline: 'Not a code from here',
    detail:
      'No code with this token exists for this tenant. A mistyped entry and a forged printout look identical here, so this is not evidence of either on its own.',
    is_refusal: true,
  },
  revoked: {
    headline: 'Cancelled',
    detail:
      'This code was cancelled by someone here. The person holding it is not carrying a forgery — they are carrying something that stopped working.',
    is_refusal: true,
  },

  not_yet_valid: {
    headline: 'Too early',
    detail: 'This code is real and its window has not opened yet.',
    is_refusal: true,
  },
  expired: {
    headline: 'Expired',
    detail: 'This code is real and its window has closed.',
    is_refusal: true,
  },
  use_limit_reached: {
    headline: 'Already used up',
    detail: 'Every use on this code has been spent. Issue another rather than raising the limit.',
    is_refusal: true,
  },
  forbidden: {
    headline: 'Needs a signed-in scanner',
    detail:
      'This target declares a required capability, so it refuses on the public path. That is the rule working, not a fault — resolve it from a scanner that is signed in.',
    is_refusal: true,
  },
}

/**
 * What an outcome means to the person reading the log.
 *
 * A replay is reported as a replay rather than as a second scan. An operator
 * looking at two lines for one person needs to know the second consumed
 * nothing, because otherwise the obvious reading — "they got in twice" — is
 * wrong and someone acts on it.
 */
export function readOutcome(
  outcome: ScanResolutionOutcome,
  is_replay = false,
): OutcomeReading {
  const reading = OUTCOME_READING[outcome] ?? {
    // An unmapped outcome shows the raw value rather than inventing a sentence.
    // Guessing at wording someone then acts on is worse than admitting this
    // screen has not been taught the case.
    headline: 'Refused',
    detail: `The pack reported "${outcome}", which this screen has no wording for yet.`,
    is_refusal: true,
  }

  if (!is_replay) return reading
  return {
    ...reading,
    detail: `${reading.detail} This was a repeat of an earlier scan and consumed nothing.`,
  }
}

/**
 * Is this code usable right now?
 *
 * Derived from the row, never tracked beside it — the same rule the booking
 * board follows, so a list cannot disagree with itself after a refresh.
 */
export function isCodeUsable(code: ScanCode, now: Date): boolean {
  if (!code.is_active || code.revoked_at !== null) return false
  if (code.use_limit !== null && code.use_count >= code.use_limit) return false

  const at = now.getTime()
  if (at < new Date(code.valid_from).getTime()) return false
  // A null `valid_until` is an open-ended code, not an expired one.
  return code.valid_until === null || at <= new Date(code.valid_until).getTime()
}

/** "2 of 5 used", or "unlimited" when there is no cap. */
export function describeCodeUse(code: ScanCode): string {
  return code.use_limit === null
    ? `${code.use_count} used, no limit`
    : `${code.use_count} of ${code.use_limit} used`
}

/**
 * What this session may do to this code.
 *
 * Revoking a code that is already dead is offered anyway only when it would do
 * something: a spent code can still be revoked (it stops a limit being raised
 * later), but one already revoked cannot be revoked twice.
 */
export function codeActionFor(code: ScanCode, held_capability: string[]): 'revoke'[] {
  if (code.revoked_at !== null || !code.is_active) return []
  return held_capability.includes('scan.manage') ? ['revoke'] : []
}

export type ScanTally = {
  resolved_count: number
  refused_count: number
  /** Repeats, which are neither a new use nor a problem. */
  replay_count: number
}

/** What the log adds up to, for the line at the top of the screen. */
export function tallyResolution(resolution: ScanResolution[]): ScanTally {
  let resolved_count = 0
  let refused_count = 0
  let replay_count = 0

  for (const one of resolution) {
    if (one.is_replay) replay_count += 1
    if (readOutcome(one.outcome).is_refusal) refused_count += 1
    else resolved_count += 1
  }

  return { resolved_count, refused_count, replay_count }
}

/** The target a code points at, or null when the list did not include it. */
export function targetFor(code: ScanCode, target: ScanTarget[]): ScanTarget | null {
  return target.find((one) => one.scan_target_id === code.scan_target_id) ?? null
}
