// The membership and access views.
//
// One file for two packs, deliberately. docs/frontend.md pairs them — *"together
// they are the gate story"* — and they share the one thing that matters here:
// what a guard reads off a door. Membership answers *may this person come in*;
// access answers *did they, and what happened*. Splitting them into two modules
// would mean two copies of the same allow/deny vocabulary.
//
// Both packs shipped with ZERO read routes, so neither screen could be started
// until six reads went into the OS. Those went in as a finding rather than being
// faked with a fixture here.
//
// The pure half is small and load-bearing: the deny-reason vocabulary. A gate
// that says `trip_limit` to a guard has told them nothing they can act on.

import type { ShellClient, Session } from '../discovery.ts'

export type MembershipPlan = {
  membership_plan_id: string
  plan_code: string
  display_name: string
  requires_good_standing: boolean
}

export type Membership = {
  membership_id: string
  membership_code: string
  party_id: string
  membership_plan_id: string
  status: string
  starts_at: string
  ends_at: string | null
}

export type Pass = {
  pass_id: string
  pass_code: string
  party_id: string | null
  status: string
  valid_from: string
  valid_until: string
  use_limit: number | null
  use_count: number
}

/** Never carries a token or its hash — the OS projection omits it. */
export type Credential = {
  credential_id: string
  party_id: string
  credential_kind: string
  is_active: boolean
  external_ref: string | null
  display_label: string | null
}

export type AccessPoint = {
  access_point_id: string
  access_point_code: string
  display_name: string
  adapter_code: string
  is_active: boolean
}

export type ScanEvent = {
  scan_event_id: string
  access_point_id: string
  outcome: string
  deny_reason_code: string | null
  party_id: string | null
  pass_id: string | null
  credential_id: string | null
  visit_id: string | null
  adapter_code: string | null
  occurred_at: string
}

export type ScanResult = {
  outcome: string
  deny_reason_code: string | null
  party_id: string | null
  pass_id: string | null
  credential_id: string | null
  visit_id: string | null
  barrier: { is_opened: boolean; note: string } | null
  is_replay?: boolean
}

export type GateApi = {
  listPlan: (session: Session) => Promise<MembershipPlan[]>
  listMembership: (session: Session, filter?: { party_id?: string; status?: string }) => Promise<Membership[]>
  listPass: (session: Session, filter?: { party_id?: string }) => Promise<Pass[]>
  listCredential: (session: Session, filter?: { party_id?: string }) => Promise<Credential[]>
  listAccessPoint: (session: Session) => Promise<AccessPoint[]>
  listScanEvent: (session: Session, filter?: { access_point_id?: string; outcome?: string }) => Promise<ScanEvent[]>
  scan: (
    session: Session,
    input: { access_point_id: string; presented: string; require_membership?: boolean },
  ) => Promise<ScanResult>
}

export function createGateApi(client: ShellClient): GateApi {
  return {
    listPlan: async (session) =>
      (await client.get<{ membership_plan: MembershipPlan[] }>(session, '/api/v1/membership/plan'))
        .membership_plan,

    listMembership: async (session, filter) =>
      (
        await client.get<{ membership: Membership[] }>(session, '/api/v1/membership', {
          party_id: filter?.party_id,
          status: filter?.status,
        })
      ).membership,

    listPass: async (session, filter) =>
      (
        await client.get<{ pass: Pass[] }>(session, '/api/v1/membership/pass', {
          party_id: filter?.party_id,
        })
      ).pass,

    listCredential: async (session, filter) =>
      (
        await client.get<{ credential: Credential[] }>(session, '/api/v1/membership/credential', {
          party_id: filter?.party_id,
        })
      ).credential,

    listAccessPoint: async (session) =>
      (await client.get<{ access_point: AccessPoint[] }>(session, '/api/v1/access/point'))
        .access_point,

    listScanEvent: async (session, filter) =>
      (
        await client.get<{ scan_event: ScanEvent[] }>(session, '/api/v1/access/scan', {
          access_point_id: filter?.access_point_id,
          outcome: filter?.outcome,
        })
      ).scan_event,

    scan: async (session, input) => {
      // The route names the envelope `result`, not `scan`. A view should not
      // have to know which word each pack chose.
      //
      // NOTE, and it is a finding rather than an omission here: the pack's
      // authorizeAccess accepts a `client_scan_id` so a scanner retrying on bad
      // wifi does not consume a second trip, and the ROUTE does not pass it
      // through. The idempotency exists and is unreachable over HTTP — the same
      // shape of gap as the six missing reads. Not fixed from this repo.
      const body = await client.post<{ result: ScanResult }>(session, '/api/v1/access/scan', input)
      return body.result
    },
  }
}

// ---------------------------------------------------------------------------
// the pure part — the deny vocabulary
// ---------------------------------------------------------------------------

/**
 * What a guard reads when the gate says no.
 *
 * The pack's `deny_reason_code` is a machine value — `trip_limit`,
 * `unknown_credential`, `bad_standing` — and showing it to somebody standing at
 * a door is the same mistake as showing them a 409. Worse, actually: a guard has
 * to decide what to DO in the next few seconds, and each of these reasons
 * implies a different next move.
 *
 * So each maps to a sentence and, where there is one, the action to take.
 */
export type DenyReading = {
  headline: string
  /** What the guard should do next, when there is something to do. */
  detail: string
  /** Whether a supervisor can resolve it on the spot. */
  is_resolvable: boolean
}

const DENY_READING: Record<string, DenyReading> = {
  unknown_credential: {
    headline: 'Not recognised',
    detail: 'This code is not registered. Enrol it, or check they are using the right one.',
    is_resolvable: true,
  },
  bad_standing: {
    headline: 'Account is past due',
    detail: 'Entry is blocked until the balance is settled. Billing can clear it.',
    is_resolvable: true,
  },
  trip_limit: {
    headline: 'No trips left',
    detail: 'This pass has been used its full number of times. Issue a new one if that is right.',
    is_resolvable: true,
  },
  expired: {
    headline: 'Expired',
    detail: 'The validity window has closed. A new pass is needed.',
    is_resolvable: true,
  },
  revoked: {
    headline: 'Revoked',
    detail: 'This was cancelled deliberately. Do not let them through without checking why.',
    is_resolvable: false,
  },
  not_entitled: {
    headline: 'No active membership',
    detail: 'This gate requires one. Check whether they should have it.',
    is_resolvable: true,
  },
  inactive_point: {
    headline: 'This gate is switched off',
    detail: 'Nothing to do with the person presenting. Turn the access point back on.',
    is_resolvable: true,
  },
}

export function readDeny(deny_reason_code: string | null): DenyReading {
  if (!deny_reason_code) {
    return { headline: 'Refused', detail: 'No reason was recorded.', is_resolvable: false }
  }
  return (
    DENY_READING[deny_reason_code] ?? {
      // An unmapped code shows the raw value rather than inventing a sentence.
      // Guessing at a reason a guard then acts on is worse than admitting the
      // shell has not been taught this one.
      headline: 'Refused',
      detail: `The gate reported "${deny_reason_code}", which this screen does not have wording for yet.`,
      is_resolvable: false,
    }
  )
}

/** Is a pass usable right now? Derived, so a list cannot disagree with itself. */
export function isPassUsable(pass: Pass, now: Date): boolean {
  if (pass.status !== 'active') return false
  if (pass.use_limit !== null && pass.use_count >= pass.use_limit) return false
  const at = now.getTime()
  return at >= new Date(pass.valid_from).getTime() && at <= new Date(pass.valid_until).getTime()
}

/** "2 of 5 used", or "unlimited" when there is no cap. */
export function describeUse(pass: Pass): string {
  return pass.use_limit === null ? 'unlimited' : `${pass.use_count} of ${pass.use_limit} used`
}

export type ScanTally = { allowed_count: number; denied_count: number }

/** What the feed adds up to, for the line at the top of the console. */
export function tallyScan(scan: ScanEvent[]): ScanTally {
  let allowed_count = 0
  let denied_count = 0
  for (const one of scan) {
    if (one.outcome === 'allowed') allowed_count += 1
    else denied_count += 1
  }
  return { allowed_count, denied_count }
}
