// Turning a refusal into something a person can act on.
//
// This file exists because of one line in the phase-2 exit condition: **the 409
// on a contested slot must render as a human sentence, not a stack trace.**
//
// That is not a cosmetic requirement. A 409 from the booking pack is the system
// working exactly as designed — PostgreSQL refused an overlapping row, or on
// SQLite the guarded insert did — and the person at the desk needs to know that
// the slot is gone and that trying again is reasonable. "Error: 409" tells them
// neither, and "Something went wrong" actively misleads, because nothing did.
//
// So each status gets a headline, a detail, and — the part that decides what
// the UI offers — whether retrying could plausibly succeed.
//
// Pure, so every case is testable without provoking a real conflict.

import { DiscoveryError } from '../discovery.ts'

export type Failure = {
  /** One short line. Goes where a person looks first. */
  headline: string
  /** What to do about it, when there is something to do. */
  detail: string
  /** Whether offering "try again" is honest. */
  is_retryable: boolean
  /** The session is gone and the shell should return to sign-in. */
  is_signed_out: boolean
}

/**
 * Map a failed call to what the operator should read.
 *
 * The server's own message is preferred wherever it was written for a person —
 * booking's conflict text ("that resource is already taken for this time.
 * Someone else booked it first.") is better than anything invented here, and
 * inventing a replacement would mean two copies of the same sentence drifting
 * apart. So the status decides the SHAPE and the server fills the DETAIL.
 */
export function describeFailure(error: unknown): Failure {
  if (!(error instanceof DiscoveryError)) {
    return {
      headline: 'Something failed unexpectedly',
      detail: String(error instanceof Error ? error.message : error),
      is_retryable: false,
      is_signed_out: false,
    }
  }

  switch (error.http_status) {
    // No HTTP response at all. Distinct from a server error, because the fix
    // is different and the operator can see for themselves whether it is true.
    case 0:
      return {
        headline: 'Cannot reach the system',
        detail: 'The connection failed. Check the network and try again.',
        is_retryable: true,
        is_signed_out: false,
      }

    case 401:
      return {
        headline: 'Your session has expired',
        detail: 'Sign in again to carry on.',
        is_retryable: false,
        is_signed_out: true,
      }

    case 403:
      return {
        headline: 'You do not have permission for that',
        detail: error.message,
        is_retryable: false,
        is_signed_out: false,
      }

    // 404 on a pack route usually means the module is disabled rather than
    // that a record is missing — that is the OS's deliberate choice, and the
    // wording has to cover both without guessing which.
    case 404:
      return {
        headline: 'That is not available',
        detail: 'It may have been removed, or this feature may be switched off for this organization.',
        is_retryable: false,
        is_signed_out: false,
      }

    // THE one. Not an error in any useful sense: the guarantee did its job.
    case 409:
      return {
        headline: 'Someone got there first',
        detail: error.message,
        is_retryable: true,
        is_signed_out: false,
      }

    case 400:
    case 422:
      return {
        headline: 'That request was not accepted',
        detail: error.message,
        is_retryable: false,
        is_signed_out: false,
      }

    default:
      if (error.http_status >= 500) {
        return {
          headline: 'The system had a problem',
          detail: 'This one is not your fault. Try again shortly.',
          is_retryable: true,
          is_signed_out: false,
        }
      }
      return {
        headline: 'That did not work',
        detail: error.message,
        is_retryable: false,
        is_signed_out: false,
      }
  }
}
