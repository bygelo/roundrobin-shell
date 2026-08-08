// The billing pack's view.
//
// Second of the nine, and second for the reason the design gives: money is what
// turns this from a demo into a product. The screen that matters most is not
// the invoice list — it is the **proof-of-payment review queue**, because in
// this market a treasurer receiving a GCash screenshot is the normal case, not
// the edge case.
//
// That queue could not be built when this file was started: the pack could
// accept a proof and approve one by id, but had no way to say which proofs were
// waiting. The feature existed and was unreachable. `GET /api/v1/payment/proof`
// was added to the OS first — a finding, handled there rather than worked
// around here.
//
// Same split as view/booking: everything that decides something is pure and
// below the fold; the calls are a thin wrapper; the DOM lives in ../render.ts.

import type { ShellClient, Session } from '../discovery.ts'

export type Invoice = {
  invoice_id: string
  invoice_code: string
  party_id: string
  status: string
  currency_code: string
  /** Always '500.00' — the same string on PostgreSQL and SQLite. */
  total_amount: string
  paid_amount: string
  balance_amount: string
  issued_at: string | null
  due_at: string | null
}

export type InvoiceLine = {
  invoice_line_id: string
  line_kind: string
  description: string
  quantity: string
  unit_amount: string
  line_amount: string
}

export type PaymentProof = {
  payment_proof_id: string
  status: string
  amount: string
  party_id: string
  invoice_id: string | null
  payment_id: string | null
}

export type PartyBalance = {
  party_id: string
  open_balance_amount: string
  open_invoice_count: number
}

export type BillingApi = {
  listInvoice: (session: Session, filter?: { party_id?: string; status?: string }) => Promise<Invoice[]>
  findInvoice: (session: Session, invoice_code: string) => Promise<{ invoice: Invoice; line: InvoiceLine[] }>
  listProof: (session: Session, status?: string) => Promise<PaymentProof[]>
  approveProof: (session: Session, payment_proof_id: string, review_note?: string) => Promise<void>
  rejectProof: (session: Session, payment_proof_id: string, review_note?: string) => Promise<void>
  partyBalance: (session: Session, party_id: string) => Promise<PartyBalance>
}

export function createBillingApi(client: ShellClient): BillingApi {
  return {
    listInvoice: async (session, filter) => {
      const body = await client.get<{ invoice: Invoice[] }>(session, '/api/v1/invoice', {
        party_id: filter?.party_id,
        status: filter?.status,
      })
      return body.invoice
    },

    findInvoice: (session, invoice_code) =>
      client.get(session, `/api/v1/invoice/${encodeURIComponent(invoice_code)}`),

    listProof: async (session, status) => {
      const body = await client.get<{ payment_proof: PaymentProof[] }>(
        session,
        '/api/v1/payment/proof',
        { status },
      )
      return body.payment_proof
    },

    approveProof: async (session, payment_proof_id, review_note) => {
      await client.post(
        session,
        `/api/v1/payment/proof/${encodeURIComponent(payment_proof_id)}/approve`,
        review_note ? { review_note } : {},
      )
    },

    rejectProof: async (session, payment_proof_id, review_note) => {
      await client.post(
        session,
        `/api/v1/payment/proof/${encodeURIComponent(payment_proof_id)}/reject`,
        review_note ? { review_note } : {},
      )
    },

    // The route wraps this one in { balance: … } while /invoice wraps in
    // { invoice: … } and /payment/proof in { payment_proof: … }. Unwrapped
    // here so a view never has to remember which envelope a pack chose.
    partyBalance: async (session, party_id) => {
      const body = await client.get<{ balance: PartyBalance }>(
        session,
        `/api/v1/billing/party/${encodeURIComponent(party_id)}/balance`,
      )
      return body.balance
    },
  }
}

// ---------------------------------------------------------------------------
// the pure part
// ---------------------------------------------------------------------------

/**
 * Money, for a person.
 *
 * The API hands over the string '500.00' on both stores, deliberately, so the
 * shell never does arithmetic on it and never sees a float. Grouping and the
 * symbol are presentation and belong here; the VALUE is not recomputed.
 */
export function formatMoney(amount: string, currency_code = 'PHP'): string {
  const symbol = currency_code === 'PHP' ? '₱' : ''
  const [whole = '0', fraction = '00'] = amount.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${symbol}${grouped}.${fraction}`
}

/** True when an invoice still owes something. Read, never recomputed. */
export function isOutstanding(invoice: Invoice): boolean {
  return invoice.status === 'open' || invoice.status === 'partial'
}

/**
 * Is this invoice past its due date?
 *
 * `now` is a parameter so a list of many invoices is judged against one instant
 * rather than drifting across the render, and so a test does not need to wait.
 * A draft is never overdue — it has not been issued to anybody.
 */
export function isOverdue(invoice: Invoice, now: Date): boolean {
  if (!isOutstanding(invoice) || !invoice.due_at) return false
  return new Date(invoice.due_at).getTime() < now.getTime()
}

export type InvoiceSummary = {
  open_count: number
  overdue_count: number
  /** Kept as a string, in major units, assembled from centavo integers. */
  outstanding_amount: string
}

/**
 * The one line at the top of a statement.
 *
 * Sums in CENTAVO and formats once at the end. Adding '500.00' + '300.50' as
 * floats is how a statement ends up a centavo off from the ledger it claims to
 * summarise — and this pack went to some trouble on the server to make that
 * impossible, which the client can undo in one line.
 */
export function summarize(invoice: Invoice[], now: Date): InvoiceSummary {
  let centavo = 0
  let open_count = 0
  let overdue_count = 0

  for (const one of invoice) {
    if (!isOutstanding(one)) continue
    open_count += 1
    if (isOverdue(one, now)) overdue_count += 1
    centavo += toCentavo(one.balance_amount)
  }

  return { open_count, overdue_count, outstanding_amount: fromCentavo(centavo) }
}

/** '500.00' -> 50000. Exact, because it never becomes a float. */
export function toCentavo(amount: string): number {
  const [whole = '0', fraction = '0'] = amount.split('.')
  const sign = whole.startsWith('-') ? -1 : 1
  const major = Math.abs(Number(whole))
  const minor = Number(fraction.padEnd(2, '0').slice(0, 2))
  return sign * (major * 100 + minor)
}

/** 50000 -> '500.00'. */
export function fromCentavo(centavo: number): string {
  const sign = centavo < 0 ? '-' : ''
  const absolute = Math.abs(centavo)
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}

/**
 * What a reviewer may do with a proof.
 *
 * Derived from status, so a queue re-read from the server cannot disagree with
 * itself, and gated on capability, so a clerk who may only look sees no
 * buttons at all — absent, not disabled. The server refuses independently;
 * this is a courtesy, never a control.
 */
export function proofActionFor(
  proof: PaymentProof,
  held_capability: string[],
): ('approve' | 'reject')[] {
  if (proof.status !== 'pending') return []
  return held_capability.includes('billing.manage') ? ['approve', 'reject'] : []
}
