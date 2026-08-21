// The two compositions K36 names, as runnable apps.
//
// A composition is kernel + the packs that buyer needs, and nothing else.
// `dev/app.ts` is the wide harness — all nine packs — so the shell has
// something to discover. These two are the actual products: F&B has no
// booking, court has no form. Standing both up from this same build, with
// no file edited between them, is the claim.
//
//   fnb:    kernel → commerce → billing → notification
//   court:  kernel → booking → billing → membership → commerce → notification
//
// See docs/use-case.md and docs/frontend.md in the OS repo.

import {
  createApp as createKernelApp,
  type KernelApp,
  type ModuleDeclaration,
  type Store,
} from '@bygelo/roundrobin-kernel'
import { BILLING_MODULE, billingRoute } from '@bygelo/roundrobin-billing'
import { BOOKING_MODULE, bookingRoute } from '@bygelo/roundrobin-booking'
import { COMMERCE_MODULE, commerceRoute } from '@bygelo/roundrobin-commerce'
import { MEMBERSHIP_MODULE, membershipRoute } from '@bygelo/roundrobin-membership'
import { NOTIFICATION_MODULE, notificationRoute } from '@bygelo/roundrobin-notification'

export type Composition = {
  composition_code: string
  declaration: ModuleDeclaration[]
  createApp: (store: Store) => KernelApp
}

export const FNB_COMPOSITION: Composition = {
  composition_code: 'fnb',
  declaration: [COMMERCE_MODULE, BILLING_MODULE, NOTIFICATION_MODULE],
  createApp: (store) =>
    createKernelApp({ store, declaration: FNB_COMPOSITION.declaration }, [
      commerceRoute,
      billingRoute,
      notificationRoute,
    ]),
}

export const COURT_COMPOSITION: Composition = {
  composition_code: 'court',
  declaration: [
    BOOKING_MODULE,
    BILLING_MODULE,
    MEMBERSHIP_MODULE,
    COMMERCE_MODULE,
    NOTIFICATION_MODULE,
  ],
  createApp: (store) =>
    createKernelApp({ store, declaration: COURT_COMPOSITION.declaration }, [
      bookingRoute,
      billingRoute,
      membershipRoute,
      commerceRoute,
      notificationRoute,
    ]),
}

export const NAMED_COMPOSITION = {
  fnb: FNB_COMPOSITION,
  court: COURT_COMPOSITION,
} as const

export type CompositionCode = keyof typeof NAMED_COMPOSITION

export function resolveComposition(code: string): Composition | undefined {
  if (code === 'fnb' || code === 'court') return NAMED_COMPOSITION[code]
  return undefined
}
