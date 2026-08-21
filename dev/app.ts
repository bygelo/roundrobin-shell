// A roundrobin app that installs everything.
//
// DEV HARNESS, not a product. Its only job is to give the shell something real
// to discover, so the phase-1 claim can be run rather than only asserted:
// disable a module in the database, reload, watch the navigation change with
// nothing deployed.
//
// It is also, incidentally, the widest composition anyone has stood up — all
// nine packs on one kernel — which is a cheap check that the module registry's
// route-collision and dependency rules hold at full width. They are checked at
// declaration time, so a clash fails here at boot rather than in a request.
//
// A real app would install the packs its buyer needs and no more. See
// docs/use-case.md in the OS repo: every buyer is a named composition, and
// "all of them" is not one of the compositions.

import {
  createApp,
  type KernelApp,
  type ModuleDeclaration,
  type Store,
} from '@bygelo/roundrobin-kernel'
import { ACCESS_MODULE, accessRoute } from '@bygelo/roundrobin-access'
import { BILLING_MODULE, billingRoute } from '@bygelo/roundrobin-billing'
import { BOOKING_MODULE, bookingRoute } from '@bygelo/roundrobin-booking'
import { COMMERCE_MODULE, commerceRoute } from '@bygelo/roundrobin-commerce'
import { DOCUMENT_MODULE, documentRoute } from '@bygelo/roundrobin-document'
import { FORM_MODULE, formRoute } from '@bygelo/roundrobin-form'
import { MEMBERSHIP_MODULE, membershipRoute } from '@bygelo/roundrobin-membership'
import { NOTIFICATION_MODULE, notificationRoute } from '@bygelo/roundrobin-notification'
// scan takes the store because two of its route are public — outside /api/*, so
// neither the bearer middleware nor module gating runs, and it checks enablement
// itself. Hence a factory here where the other pack export a contributor.
import { SCAN_MODULE, createScanRoute } from '@bygelo/roundrobin-scan'

export const DECLARATION: ModuleDeclaration[] = [
  BOOKING_MODULE,
  BILLING_MODULE,
  MEMBERSHIP_MODULE,
  // K60 folded the door log onto scan, so access now depends on it. The registry
  // is dependency-checked at declaration time and refuses by name — leave scan
  // out and the seed dies with `module "access" depends on "scan", which is not
  // declared`, which is the registry doing exactly its job.
  SCAN_MODULE,
  ACCESS_MODULE,
  FORM_MODULE,
  DOCUMENT_MODULE,
  NOTIFICATION_MODULE,
  COMMERCE_MODULE,
]

export function createDevApp(store: Store): KernelApp {
  const route = [
    bookingRoute,
    billingRoute,
    membershipRoute,
    createScanRoute(store),
    accessRoute,
    formRoute,
    documentRoute,
    notificationRoute,
    commerceRoute,
  ]
  return createApp({ store, declaration: DECLARATION }, route)
}
