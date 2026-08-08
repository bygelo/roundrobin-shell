// A roundrobbin app that installs everything.
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
} from '@bygelo/roundrobbin-kernel'
import { ACCESS_MODULE, accessRoute } from '@bygelo/roundrobbin-access'
import { BILLING_MODULE, billingRoute } from '@bygelo/roundrobbin-billing'
import { BOOKING_MODULE, bookingRoute } from '@bygelo/roundrobbin-booking'
import { COMMERCE_MODULE, commerceRoute } from '@bygelo/roundrobbin-commerce'
import { DOCUMENT_MODULE, documentRoute } from '@bygelo/roundrobbin-document'
import { FORM_MODULE, formRoute } from '@bygelo/roundrobbin-form'
import { MEMBERSHIP_MODULE, membershipRoute } from '@bygelo/roundrobbin-membership'
import { NOTIFICATION_MODULE, notificationRoute } from '@bygelo/roundrobbin-notification'

export const DECLARATION: ModuleDeclaration[] = [
  BOOKING_MODULE,
  BILLING_MODULE,
  MEMBERSHIP_MODULE,
  ACCESS_MODULE,
  FORM_MODULE,
  DOCUMENT_MODULE,
  NOTIFICATION_MODULE,
  COMMERCE_MODULE,
]

const ROUTE = [
  bookingRoute,
  billingRoute,
  membershipRoute,
  accessRoute,
  formRoute,
  documentRoute,
  notificationRoute,
  commerceRoute,
]

export function createDevApp(store: Store): KernelApp {
  return createApp({ store, declaration: DECLARATION }, ROUTE)
}
