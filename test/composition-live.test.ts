// K36, executed: two compositions from one build, a real task in each.
//
//   F&B   — commerce + billing + notification — take a POS order
//   court — booking + billing + membership + commerce + notification — take a booking
//
// The same shell, the same PACK_VIEW, two different apps. Nothing in src/ is
// edited between the two describes. The only thing that changes is which
// packs the app installed, which is what a composition is.

import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { Uuid } from '@bygelo/roundrobin-kernel'
import { createCatalog, createVariant, setInventory } from '@bygelo/roundrobin-commerce'
import { COURT_COMPOSITION, FNB_COMPOSITION } from '../dev/composition.ts'
import { deriveNavigation } from '../src/navigation.ts'
import { createBookingApi } from '../src/view/booking.ts'
import { createCounterApi } from '../src/view/counter.ts'
import { seedParty, standUpTenant, type Tenant } from './harness.ts'

const DATABASE_URL = process.env['DATABASE_URL']

const FNB_NAV = ['billing', 'commerce', 'notification']
const COURT_NAV = ['billing', 'booking', 'commerce', 'membership', 'notification']

describe('two compositions from one build', { skip: !DATABASE_URL }, () => {
  describe('fnb', () => {
    let tenant: Tenant
    let party_id: Uuid
    let variant_id: Uuid

    before(async () => {
      tenant = await standUpTenant({
        database_url: DATABASE_URL!,
        prefix: 'shell-fnb',
        composition: FNB_COMPOSITION,
        role: [
          { role_code: 'owner', display_name: 'Owner' },
          {
            role_code: 'clerk',
            display_name: 'Clerk',
            capability_code: ['commerce.read', 'billing.read', 'notification.read'],
          },
        ],
        actor: [
          { actor_code: 'operator', role_code: 'owner' },
          { actor_code: 'clerk', role_code: 'clerk' },
        ],
      })
      party_id = await seedParty(tenant, 'Walk-in')

      const seeded = await tenant.inside(async (inside) => {
        const catalog = await createCatalog(inside, {
          name: 'House blend',
          catalog_code: 'house-blend',
          kind: 'good',
        })
        const variant = await createVariant(inside, {
          catalog_id: catalog.catalog_id,
          name: 'Hot 12oz',
          price_amount: 150,
        })
        await setInventory(inside, { variant_id: variant.variant_id, quantity_on_hand: 20 })
        return variant.variant_id
      })
      variant_id = seeded
    })

    after(() => tenant.teardown())

    const navigate = async (actor_code: string) =>
      deriveNavigation(await tenant.client.fetchCapability(tenant.session[actor_code]!))

    it('renders only the three F&B packs', async () => {
      const navigation = await navigate('operator')
      assert.deepEqual(navigation.item.map((one) => one.module_code).sort(), FNB_NAV)
      assert.deepEqual(navigation.undrawn_module_code, [])
    })

    it('does not expose booking — 404, not a greyed-out entry', async () => {
      const navigation = await navigate('operator')
      assert.equal(
        navigation.item.some((one) => one.module_code === 'booking'),
        false,
      )
      await assert.rejects(
        tenant.client.get(tenant.session['operator']!, '/api/v1/booking'),
        (error: unknown) => {
          assert.equal((error as { http_status: number }).http_status, 404)
          return true
        },
      )
    })

    it('takes a POS order and the counter lists the same total', async () => {
      const api = createCounterApi(tenant.client)
      const placed = await api.placeOrder(tenant.session['operator']!, {
        idempotency_key: `fnb-${tenant.organization_code}`,
        channel: 'pos',
        buyer_party_id: party_id,
        line: [{ variant_id, quantity: 2 }],
      })

      assert.equal(placed.order.status, 'placed')
      assert.equal(placed.order.channel, 'pos')
      assert.equal(placed.order.total_amount, '300.00')
      assert.equal(placed.line.length, 1)
      assert.equal(placed.line[0]?.quantity, 2)

      const listed = await api.listOrder(tenant.session['operator']!)
      const found = listed.find((one) => one.sales_order_id === placed.order.sales_order_id)
      assert.ok(found, 'the order the counter just took must appear on the counter')
      assert.equal(found.total_amount, placed.order.total_amount)
    })

    it('hides Take an order from a clerk who cannot write, and the server refuses', async () => {
      const navigation = await navigate('clerk')
      const commerce = navigation.item.find((one) => one.module_code === 'commerce')
      assert.ok(commerce, 'the clerk can still see the counter')
      assert.equal(
        commerce.action.some((one) => one.action_code === 'commerce.order'),
        false,
      )

      const api = createCounterApi(tenant.client)
      await assert.rejects(
        api.placeOrder(tenant.session['clerk']!, {
          idempotency_key: `fnb-clerk-${tenant.organization_code}`,
          channel: 'pos',
          line: [{ variant_id, quantity: 1 }],
        }),
        (error: unknown) => {
          assert.equal((error as { http_status: number }).http_status, 403)
          return true
        },
      )
    })
  })

  describe('court', () => {
    let tenant: Tenant

    const STARTS_AT = '2027-04-01T02:00:00.000Z'
    const ENDS_AT = '2027-04-01T03:00:00.000Z'
    const RANGE = {
      starts_at: new Date('2027-04-01T00:00:00.000Z'),
      ends_at: new Date('2027-04-02T00:00:00.000Z'),
    }

    before(async () => {
      tenant = await standUpTenant({
        database_url: DATABASE_URL!,
        prefix: 'shell-court',
        composition: COURT_COMPOSITION,
      })
      await seedParty(tenant, 'A Player')

      await tenant.inside(async (inside) => {
        const [site] = await inside.query<{ site_id: Uuid }[]>`
          INSERT INTO site (organization_id, site_code, display_name, time_zone)
          VALUES (${tenant.organization_id}, 'main', 'Main Venue', 'Asia/Manila')
          RETURNING site_id`

        const [resource] = await inside.query<{ resource_id: Uuid }[]>`
          INSERT INTO resource (organization_id, site_id, resource_code, display_name)
          VALUES (${tenant.organization_id}, ${site!.site_id}, 'court-1', 'Court 1')
          RETURNING resource_id`

        const [booking_session] = await inside.query<{ session_id: Uuid }[]>`
          INSERT INTO session (organization_id, site_id, session_code, starts_at, ends_at,
                               capacity_count, price_amount, is_published)
          VALUES (${tenant.organization_id}, ${site!.site_id}, 'evening',
                  ${STARTS_AT}, ${ENDS_AT}, 4, 500.00, true)
          RETURNING session_id`

        await inside.query`
          INSERT INTO session_resource (organization_id, session_id, resource_id)
          VALUES (${tenant.organization_id}, ${booking_session!.session_id}, ${resource!.resource_id})`
      })
    })

    after(() => tenant.teardown())

    const navigate = async () =>
      deriveNavigation(await tenant.client.fetchCapability(tenant.session['operator']!))

    it('renders the five court packs, including booking', async () => {
      const navigation = await navigate()
      assert.deepEqual(navigation.item.map((one) => one.module_code).sort(), COURT_NAV)
      assert.deepEqual(navigation.undrawn_module_code, [])
    })

    it('does not expose form — 404, matching the missing nav entry', async () => {
      const navigation = await navigate()
      assert.equal(
        navigation.item.some((one) => one.module_code === 'form'),
        false,
      )
      await assert.rejects(
        tenant.client.get(tenant.session['operator']!, '/api/v1/form/template'),
        (error: unknown) => {
          assert.equal((error as { http_status: number }).http_status, 404)
          return true
        },
      )
    })

    it('takes a booking — hold, then confirm', async () => {
      const api = createBookingApi(tenant.client)
      const session = tenant.session['operator']!
      const [slot] = await api.listAvailable(session, RANGE)
      assert.ok(slot, 'the court composition must have a bookable slot')

      const held = await api.hold(session, {
        session_id: slot.session_id,
        resource_id: slot.resource_id,
      })
      assert.equal(held.status, 'hold')

      const confirmed = await api.confirm(session, held.booking_code)
      assert.equal(confirmed.status, 'confirmed')
      assert.equal(confirmed.booking_code, held.booking_code)
    })
  })
})
