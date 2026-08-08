// The billing view against a real OS.
//
// The exit condition for this checkpoint: **a treasurer can work a proof
// queue.** Not "the module renders" — a GCash screenshot arrives, it appears in
// a queue, approving it settles a real debt, and the queue empties.
//
// That whole loop was impossible a commit ago. The pack could accept a proof
// and approve one by id, but nothing could ask which proofs were waiting, so
// the queue had no contents and the screen had nothing to draw. Two reads were
// added to the OS first — a finding, handled there rather than faked here with
// a fixture, which is the cheap way to turn this file green while shipping
// nothing.

import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { Uuid } from '@bygelo/roundrobbin-kernel'
import { addLine, createInvoice, openInvoice, submitProof } from '@bygelo/roundrobbin-billing'
import { createBillingApi, summarize } from '../src/view/billing.ts'
import { describeFailure } from '../src/view/failure.ts'
import { seedParty, standUpTenant, type Tenant } from './harness.ts'

const DATABASE_URL = process.env['DATABASE_URL']

describe('billing, through the shell, against a real OS', { skip: !DATABASE_URL }, () => {
  let tenant: Tenant
  let party_id: Uuid
  let api: ReturnType<typeof createBillingApi>

  before(async () => {
    tenant = await standUpTenant({
      database_url: DATABASE_URL!,
      prefix: 'shell-billing',
      role: [
        { role_code: 'owner', display_name: 'Owner' },
        // An actor who may LOOK at the ledger and not clear it. A real role row,
        // because the point of the test is that the SERVER refuses.
        { role_code: 'clerk', display_name: 'Clerk', capability_code: ['billing.read'] },
      ],
      actor: [
        { actor_code: 'treasurer', role_code: 'owner' },
        { actor_code: 'clerk', role_code: 'clerk' },
      ],
    })

    api = createBillingApi(tenant.client)
    party_id = await seedParty(tenant, 'Unit 12A')

    await tenant.inside(async (inside) => {
      const invoice = await createInvoice(inside, { party_id })
      await addLine(inside, {
        invoice_id: invoice.invoice_id,
        description: 'monthly dues',
        unit_amount: 500,
      })
      await openInvoice(inside, invoice.invoice_id)
      await submitProof(inside, {
        party_id,
        invoice_id: invoice.invoice_id,
        amount: 500,
        evidence_note: 'GCash screenshot, ref 0012345',
      })
    })
  })

  after(() => tenant.teardown())

  it('reads the ledger and summarises it exactly', async () => {
    const invoice = await api.listInvoice(tenant.session['treasurer']!)
    assert.equal(invoice.length, 1)

    const summary = summarize(invoice, new Date())
    assert.equal(summary.outstanding_amount, '500.00')
    assert.equal(summary.open_count, 1)
  })

  // THE test for this checkpoint. The queue, worked end to end.
  it('shows a waiting proof, approves it, and the debt is settled', async () => {
    const session = tenant.session['treasurer']!

    const waiting = await api.listProof(session)
    assert.equal(waiting.length, 1, 'the screenshot is in the queue')
    assert.equal(waiting[0]?.amount, '500.00')
    assert.equal(waiting[0]?.status, 'pending')

    await api.approveProof(session, waiting[0]!.payment_proof_id, 'matched the GCash reference')

    assert.deepEqual(await api.listProof(session), [], 'the queue empties')

    const invoice = await api.listInvoice(session)
    assert.equal(invoice[0]?.balance_amount, '0.00', 'approving a proof settles a real debt')
    assert.equal(invoice[0]?.status, 'paid')

    const balance = await api.partyBalance(session, party_id)
    assert.equal(balance.open_balance_amount, '0.00')
  })

  // The capability story, against a real role rather than a hand-made list.
  it('lets a clerk see the queue and refuses to let them clear it', async () => {
    await tenant.inside(async (inside) => {
      const invoice = await createInvoice(inside, { party_id })
      await addLine(inside, { invoice_id: invoice.invoice_id, description: 'dues', unit_amount: 250 })
      await openInvoice(inside, invoice.invoice_id)
      await submitProof(inside, { party_id, amount: 250, evidence_note: 'second screenshot' })
    })

    const clerk = tenant.session['clerk']!
    const queue = await api.listProof(clerk)
    assert.equal(queue.length, 1, 'a clerk may look')

    let failure: ReturnType<typeof describeFailure> | undefined
    try {
      await api.approveProof(clerk, queue[0]!.payment_proof_id)
      assert.fail('a clerk must not be able to approve')
    } catch (error) {
      failure = describeFailure(error)
    }

    assert.ok(failure)
    assert.equal(failure.is_retryable, false)
    assert.match(failure.headline, /do not have permission/)

    // And the refusal is the SERVER's, not the shell's. Hiding the button is a
    // courtesy; this is the control.
    const still_waiting = await api.listProof(tenant.session['treasurer']!)
    assert.equal(still_waiting.length, 1, 'nothing was approved')
  })

  it('reads one invoice with its line', async () => {
    const session = tenant.session['treasurer']!
    const invoice = await api.listInvoice(session)
    const found = await api.findInvoice(session, invoice[0]!.invoice_code)

    assert.equal(found.invoice.invoice_code, invoice[0]?.invoice_code)
    assert.ok(found.line.length >= 1)
    assert.equal(found.line[0]?.line_amount.includes('.'), true, 'money keeps its API shape')
  })

  it('filters the ledger by party', async () => {
    const other = await seedParty(tenant, 'Unit 99Z')
    const none = await api.listInvoice(tenant.session['treasurer']!, { party_id: other })
    assert.deepEqual(none, [], 'a party with no invoice has an empty ledger, not everyone else’s')
  })
})
