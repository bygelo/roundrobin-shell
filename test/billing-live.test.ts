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
import {
  createActor,
  createStore,
  enableModule,
  registerModule,
  withOwner,
  withTenant,
  type Store,
  type Uuid,
} from '@bygelo/roundrobbin-kernel'
import { addLine, createInvoice, openInvoice, submitProof } from '@bygelo/roundrobbin-billing'
import { DECLARATION, createDevApp } from '../dev/app.ts'
import { createClient, type Session } from '../src/discovery.ts'
import { createBillingApi, summarize } from '../src/view/billing.ts'
import { describeFailure } from '../src/view/failure.ts'

const DATABASE_URL = process.env['DATABASE_URL']

describe('billing, through the shell, against a real OS', { skip: !DATABASE_URL }, () => {
  let store: Store
  let organization_id: Uuid
  let organization_code: string
  let party_id: Uuid
  let session: Session
  let clerk_session: Session
  let api: ReturnType<typeof createBillingApi>

  before(async () => {
    store = createStore(DATABASE_URL!)
    organization_code = `shell-billing-${Date.now()}`

    await withOwner(store, 'module catalog', (owner) => registerModule(owner, DECLARATION))

    organization_id = await withOwner(store, 'create tenant', async (owner) => {
      const [row] = await owner.query<{ organization_id: Uuid }[]>`
        INSERT INTO organization (organization_code, display_name)
        VALUES (${organization_code}, 'Shell Billing') RETURNING organization_id`
      return row!.organization_id
    })

    await withTenant(store, organization_id, async (tenant) => {
      for (const one of DECLARATION) await enableModule(tenant, one.module_code, DECLARATION)

      const [owner_role] = await tenant.query<{ role_id: Uuid }[]>`
        INSERT INTO role (organization_id, role_code, display_name, is_system)
        VALUES (${organization_id}, 'owner', 'Owner', true) RETURNING role_id`
      await tenant.query`
        INSERT INTO role_capability (organization_id, role_id, capability_code)
        SELECT ${organization_id}, ${owner_role!.role_id}, capability_code FROM capability`

      // A second actor who may LOOK at the ledger and not clear it. The point
      // of the whole capability story, and worth a real row rather than a
      // hand-made capability list.
      const [clerk_role] = await tenant.query<{ role_id: Uuid }[]>`
        INSERT INTO role (organization_id, role_code, display_name, is_system)
        VALUES (${organization_id}, 'clerk', 'Clerk', false) RETURNING role_id`
      await tenant.query`
        INSERT INTO role_capability (organization_id, role_id, capability_code)
        VALUES (${organization_id}, ${clerk_role!.role_id}, 'billing.read')`

      await createActor(tenant, {
        actor_code: 'treasurer',
        display_name: 'Treasurer',
        secret: 'correct-horse',
        role_code: 'owner',
      })
      await createActor(tenant, {
        actor_code: 'clerk',
        display_name: 'Clerk',
        secret: 'correct-horse',
        role_code: 'clerk',
      })

      const [party] = await tenant.query<{ party_id: Uuid }[]>`
        INSERT INTO party (organization_id, display_name)
        VALUES (${organization_id}, 'Unit 12A') RETURNING party_id`
      party_id = party!.party_id

      const invoice = await createInvoice(tenant, { party_id })
      await addLine(tenant, {
        invoice_id: invoice.invoice_id,
        description: 'monthly dues',
        unit_amount: 500,
      })
      await openInvoice(tenant, invoice.invoice_id)

      await submitProof(tenant, {
        party_id,
        invoice_id: invoice.invoice_id,
        amount: 500,
        evidence_note: 'GCash screenshot, ref 0012345',
      })
    })

    const app = createDevApp(store)
    const client = createClient({
      base_url: 'http://local',
      fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
        app.request(String(input), init)) as typeof globalThis.fetch,
    })
    api = createBillingApi(client)
    session = await client.signIn({
      organization_code,
      actor_code: 'treasurer',
      secret: 'correct-horse',
    })
    clerk_session = await client.signIn({
      organization_code,
      actor_code: 'clerk',
      secret: 'correct-horse',
    })
  })

  after(async () => {
    await withOwner(store, 'create tenant', async (owner) => {
      await owner.query`DELETE FROM organization WHERE organization_id = ${organization_id}`
    })
    await store.end()
  })

  it('reads the ledger and summarises it exactly', async () => {
    const invoice = await api.listInvoice(session)
    assert.equal(invoice.length, 1)

    const summary = summarize(invoice, new Date())
    assert.equal(summary.outstanding_amount, '500.00')
    assert.equal(summary.open_count, 1)
  })

  // THE test for this checkpoint. The queue, worked end to end.
  it('shows a waiting proof, approves it, and the debt is settled', async () => {
    const waiting = await api.listProof(session)
    assert.equal(waiting.length, 1, 'the screenshot is in the queue')
    assert.equal(waiting[0]?.amount, '500.00')
    assert.equal(waiting[0]?.status, 'pending')

    await api.approveProof(session, waiting[0]!.payment_proof_id, 'matched the GCash reference')

    const after_approve = await api.listProof(session)
    assert.deepEqual(after_approve, [], 'the queue empties')

    const invoice = await api.listInvoice(session)
    assert.equal(invoice[0]?.balance_amount, '0.00', 'approving a proof settles a real debt')
    assert.equal(invoice[0]?.status, 'paid')

    const balance = await api.partyBalance(session, party_id)
    assert.equal(balance.open_balance_amount, '0.00')
  })

  // The capability story, against a real role rather than a hand-made list.
  it('lets a clerk see the queue and refuses to let them clear it', async () => {
    await withTenant(store, organization_id, async (tenant) => {
      const invoice = await createInvoice(tenant, { party_id })
      await addLine(tenant, { invoice_id: invoice.invoice_id, description: 'dues', unit_amount: 250 })
      await openInvoice(tenant, invoice.invoice_id)
      await submitProof(tenant, { party_id, amount: 250, evidence_note: 'second screenshot' })
    })

    const queue = await api.listProof(clerk_session)
    assert.equal(queue.length, 1, 'a clerk may look')

    let failure: ReturnType<typeof describeFailure> | undefined
    try {
      await api.approveProof(clerk_session, queue[0]!.payment_proof_id)
      assert.fail('a clerk must not be able to approve')
    } catch (error) {
      failure = describeFailure(error)
    }

    assert.ok(failure)
    assert.equal(failure.is_retryable, false)
    assert.match(failure.headline, /do not have permission/)

    // And the refusal is the SERVER's, not the shell's. Hiding the button is a
    // courtesy; this is the control.
    const still_waiting = await api.listProof(session)
    assert.equal(still_waiting.length, 1, 'nothing was approved')
  })

  it('reads one invoice with its line', async () => {
    const invoice = await api.listInvoice(session)
    const found = await api.findInvoice(session, invoice[0]!.invoice_code)

    assert.equal(found.invoice.invoice_code, invoice[0]?.invoice_code)
    assert.ok(found.line.length >= 1)
    assert.equal(found.line[0]?.line_amount.includes('.'), true, 'money keeps its API shape')
  })

  it('filters the ledger by party', async () => {
    const other = await withTenant(store, organization_id, async (tenant) => {
      const [row] = await tenant.query<{ party_id: Uuid }[]>`
        INSERT INTO party (organization_id, display_name)
        VALUES (${organization_id}, 'Unit 99Z') RETURNING party_id`
      return row!.party_id
    })

    const none = await api.listInvoice(session, { party_id: other })
    assert.deepEqual(none, [], 'a party with no invoice has an empty ledger, not everyone else’s')
  })
})
