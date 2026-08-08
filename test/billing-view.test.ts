// The billing view's pure half, and its rendering.
//
// The money assertions are the ones that matter. The OS goes to real trouble to
// keep currency exact — numeric(14,2) on PostgreSQL, INTEGER centavo on SQLite,
// a scale the kernel states so no pack guesses — and a client can undo all of
// it in one line by adding two strings as floats. So the summary sums in
// centavo and this file proves it.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from '../src/dom.ts'
import { renderBilling, type BillingState } from '../src/render.ts'
import {
  formatMoney,
  fromCentavo,
  isOutstanding,
  isOverdue,
  proofActionFor,
  summarize,
  toCentavo,
  type Invoice,
  type PaymentProof,
} from '../src/view/billing.ts'
import { buttonLabel, byClass, stubDocument, textOf } from './stub-dom.ts'

const element = createElement(stubDocument())
const NOW = new Date('2027-04-01T00:00:00.000Z')

function invoice(over: Partial<Invoice> = {}): Invoice {
  return {
    invoice_id: 'i',
    invoice_code: 'inv_001',
    party_id: 'p',
    status: 'open',
    currency_code: 'PHP',
    total_amount: '500.00',
    paid_amount: '0.00',
    balance_amount: '500.00',
    issued_at: '2027-03-01T00:00:00.000Z',
    due_at: '2027-05-01T00:00:00.000Z',
    ...over,
  }
}

function proof(over: Partial<PaymentProof> = {}): PaymentProof {
  return {
    payment_proof_id: 'pp',
    status: 'pending',
    amount: '500.00',
    party_id: 'p',
    invoice_id: null,
    payment_id: null,
    ...over,
  }
}

function state(over: Partial<BillingState> = {}): BillingState {
  return {
    status: 'ready',
    invoice: [invoice()],
    proof: [proof()],
    held_capability: ['billing.read', 'billing.manage'],
    now: NOW,
    ...over,
  }
}

const NOOP = { onApprove: () => {}, onReject: () => {}, onOpenInvoice: () => {}, onBack: () => {} }

describe('money crossing the boundary', () => {
  it('converts to centavo and back without touching a float', () => {
    assert.equal(toCentavo('500.00'), 50000)
    assert.equal(toCentavo('0.05'), 5)
    assert.equal(toCentavo('1234.56'), 123456)
    assert.equal(fromCentavo(50000), '500.00')
    assert.equal(fromCentavo(5), '0.05')
  })

  it('handles a whole-peso string with no decimal point', () => {
    assert.equal(toCentavo('500'), 50000, "the API sends '500.00', but a hand-written value may not")
  })

  it('round-trips a negative amount', () => {
    assert.equal(toCentavo('-12.34'), -1234)
    assert.equal(fromCentavo(-1234), '-12.34')
  })

  // THE money test. 0.1 + 0.2 !== 0.3, and a statement one centavo off from
  // the ledger it summarises is a support call that costs more than this file.
  it('sums a statement exactly, where floats would drift', () => {
    const balance = ['0.10', '0.20']

    // The drift is real and this pins it: 0.1 + 0.2 is 0.30000000000000004, so
    // the naive sum renders a statement that does not match the ledger it
    // claims to summarise. Asserted first, so this test fails loudly if a
    // future JS engine ever makes the contrast vacuous rather than quietly
    // proving nothing.
    const naive = balance.reduce((total, one) => total + Number(one), 0)
    assert.notEqual(String(naive), '0.30', 'the float route really is wrong here')

    const summary = summarize(
      balance.map((balance_amount) => invoice({ balance_amount })),
      NOW,
    )
    assert.equal(summary.outstanding_amount, '0.30')
  })

  it('sums a larger statement exactly', () => {
    const summary = summarize(
      [
        invoice({ balance_amount: '0.10' }),
        invoice({ balance_amount: '0.20' }),
        invoice({ balance_amount: '1234.56' }),
      ],
      NOW,
    )
    assert.equal(summary.outstanding_amount, '1234.86')
  })

  it('counts only what is still owed', () => {
    const summary = summarize(
      [
        invoice({ status: 'paid', balance_amount: '0.00' }),
        invoice({ status: 'open', balance_amount: '300.00' }),
        invoice({ status: 'draft', balance_amount: '100.00' }),
      ],
      NOW,
    )
    assert.equal(summary.open_count, 1, 'paid is settled and draft was never issued')
    assert.equal(summary.outstanding_amount, '300.00')
  })

  it('formats with a symbol and thousands grouping, without recomputing the value', () => {
    assert.equal(formatMoney('1234567.89'), '₱1,234,567.89')
    assert.equal(formatMoney('500.00'), '₱500.00')
    assert.equal(formatMoney('500.00', 'USD'), '500.00', 'no symbol invented for a currency we do not know')
  })
})

describe('what is overdue', () => {
  it('is past due and still owed', () => {
    assert.equal(isOverdue(invoice({ due_at: '2027-03-01T00:00:00.000Z' }), NOW), true)
    assert.equal(isOverdue(invoice({ due_at: '2027-05-01T00:00:00.000Z' }), NOW), false)
  })

  it('is never true for a draft, which was never issued to anybody', () => {
    assert.equal(
      isOverdue(invoice({ status: 'draft', due_at: '2020-01-01T00:00:00.000Z' }), NOW),
      false,
    )
  })

  it('is never true for a paid invoice', () => {
    assert.equal(
      isOverdue(invoice({ status: 'paid', due_at: '2020-01-01T00:00:00.000Z' }), NOW),
      false,
    )
    assert.equal(isOutstanding(invoice({ status: 'paid' })), false)
  })

  it('is false when no due date was set', () => {
    assert.equal(isOverdue(invoice({ due_at: null }), NOW), false)
  })
})

describe('who may clear the queue', () => {
  it('offers approve and reject to a manager', () => {
    assert.deepEqual(proofActionFor(proof(), ['billing.manage']), ['approve', 'reject'])
  })

  // Absent, not disabled. The server refuses independently; this is a courtesy.
  it('offers nothing to a clerk who may only read', () => {
    assert.deepEqual(proofActionFor(proof(), ['billing.read']), [])
  })

  it('offers nothing on a proof already reviewed', () => {
    assert.deepEqual(proofActionFor(proof({ status: 'approved' }), ['billing.manage']), [])
  })
})

describe('the billing screen renders', () => {
  it('leads with the outstanding total', () => {
    const tree = element('div', {}, renderBilling(element, { display_name: 'Billing', state: state() }, NOOP))
    assert.match(textOf(byClass(tree, 'summary')[0]), /₱500\.00/)
    assert.match(textOf(byClass(tree, 'summary')[0]), /1 invoice/)
  })

  it('flags an overdue invoice in the summary and on the row', () => {
    const overdue = invoice({ due_at: '2027-03-01T00:00:00.000Z' })
    const tree = element(
      'div',
      {},
      renderBilling(element, { display_name: 'Billing', state: state({ invoice: [overdue] }) }, NOOP),
    )
    assert.equal(byClass(tree, 'overdue').length, 2, 'the pill and the row')
  })

  it('draws the review queue with approve and reject for a manager', () => {
    const tree = element('div', {}, renderBilling(element, { display_name: 'Billing', state: state() }, NOOP))
    const queue = byClass(tree, 'queue')[0]!
    assert.deepEqual(buttonLabel(queue), ['Approve', 'Reject'])
  })

  // The capability check has to survive the render, not just the pure helper.
  it('draws no review button for a clerk who may only read', () => {
    const tree = element(
      'div',
      {},
      renderBilling(
        element,
        { display_name: 'Billing', state: state({ held_capability: ['billing.read'] }) },
        NOOP,
      ),
    )
    assert.deepEqual(buttonLabel(byClass(tree, 'queue')[0]), [])
  })

  it('says the queue is empty rather than drawing an empty list', () => {
    const tree = element(
      'div',
      {},
      renderBilling(element, { display_name: 'Billing', state: state({ proof: [] }) }, NOOP),
    )
    assert.match(textOf(byClass(tree, 'queue')[0]), /Nothing waiting for review/)
  })

  it('approves the proof the button belongs to', () => {
    const two = [proof({ payment_proof_id: 'pp-1' }), proof({ payment_proof_id: 'pp-2' })]
    let chosen = ''
    const tree = element(
      'div',
      {},
      renderBilling(
        element,
        { display_name: 'Billing', state: state({ proof: two }) },
        { ...NOOP, onApprove: (one) => (chosen = one.payment_proof_id) },
      ),
    )
    byClass(tree, 'approve')[1]!.listener['click']!({})
    assert.equal(chosen, 'pp-2')
  })

  it('does not claim the ledger is empty while it is still loading', () => {
    const tree = element(
      'div',
      {},
      renderBilling(
        element,
        { display_name: 'Billing', state: state({ status: 'loading', invoice: [], proof: [] }) },
        NOOP,
      ),
    )
    assert.doesNotMatch(textOf(tree), /No invoice yet/)
    assert.match(textOf(tree), /reading the ledger/)
  })

  it('says so when there is genuinely no invoice', () => {
    const tree = element(
      'div',
      {},
      renderBilling(element, { display_name: 'Billing', state: state({ invoice: [] }) }, NOOP),
    )
    assert.match(textOf(tree), /No invoice yet/)
  })
})
