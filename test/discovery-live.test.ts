// The phase-1 exit condition, executed.
//
//   "Signing in against a seeded tenant renders nav from /api/v1/capability,
//    and toggling a module in the DB changes the nav on reload with no deploy."
//
// Every layer here is real: a real PostgreSQL, the real kernel app with all
// nine packs mounted, the real sign-in route, the real client, and the real
// derivation. The only thing not real is the socket — the OS app's own
// `request` is injected as the client's `fetch`, which exercises routing and
// middleware without binding a port. A port would add flakiness and test
// nothing this does not.
//
// Skipped without DATABASE_URL, matching the OS convention. It must run in CI.

import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import {
  createActor,
  createStore,
  disableModule,
  enableModule,
  registerModule,
  withOwner,
  withTenant,
  type Store,
  type Uuid,
} from '@bygelo/roundrobbin-kernel'
import { DECLARATION, createDevApp } from '../dev/app.ts'
import { createClient } from '../src/discovery.ts'
import { deriveNavigation } from '../src/navigation.ts'

const DATABASE_URL = process.env['DATABASE_URL']

describe('the shell against a real OS', { skip: !DATABASE_URL }, () => {
  let store: Store
  let organization_id: Uuid
  let organization_code: string
  let client: ReturnType<typeof createClient>

  const ACTOR_CODE = 'operator'
  const SECRET = 'correct-horse'

  before(async () => {
    store = createStore(DATABASE_URL!)
    organization_code = `shell-live-${Date.now()}`

    await withOwner(store, 'module catalog', (owner) => registerModule(owner, DECLARATION))

    organization_id = await withOwner(store, 'create tenant', async (owner) => {
      const [row] = await owner.query<{ organization_id: Uuid }[]>`
        INSERT INTO organization (organization_code, display_name)
        VALUES (${organization_code}, 'Shell Live') RETURNING organization_id`
      return row!.organization_id
    })

    await withTenant(store, organization_id, async (tenant) => {
      for (const one of DECLARATION) await enableModule(tenant, one.module_code, DECLARATION)

      const [role] = await tenant.query<{ role_id: Uuid }[]>`
        INSERT INTO role (organization_id, role_code, display_name, is_system)
        VALUES (${organization_id}, 'owner', 'Owner', true) RETURNING role_id`
      await tenant.query`
        INSERT INTO role_capability (organization_id, role_id, capability_code)
        SELECT ${organization_id}, ${role!.role_id}, capability_code FROM capability`

      await createActor(tenant, {
        actor_code: ACTOR_CODE,
        display_name: 'Front Desk',
        secret: SECRET,
        role_code: 'owner',
      })
    })

    // The app's own request handler, standing in for the network.
    const app = createDevApp(store)
    client = createClient({
      base_url: 'http://local',
      fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
        app.request(String(input), init)) as typeof globalThis.fetch,
    })
  })

  after(async () => {
    await withOwner(store, 'create tenant', async (owner) => {
      await owner.query`DELETE FROM organization WHERE organization_id = ${organization_id}`
    })
    await store.end()
  })

  const signIn = () => client.signIn({ organization_code, actor_code: ACTOR_CODE, secret: SECRET })

  it('signs in over HTTP and gets a usable session', async () => {
    const session = await signIn()
    assert.equal(session.organization_id, organization_id)
    assert.ok(session.token.length > 20)
  })

  it('renders navigation from what the server reports', async () => {
    const session = await signIn()
    const navigation = deriveNavigation(await client.fetchCapability(session))

    assert.equal(navigation.organization_id, organization_id)
    assert.deepEqual(
      navigation.item.map((one) => one.module_code).sort(),
      ['access', 'billing', 'booking', 'commerce', 'document', 'form', 'membership', 'notification'],
      'all eight installed packs draw, because this operator holds every capability',
    )
    assert.deepEqual(navigation.undrawn_module_code, [], 'every enabled module has a view')
  })

  // THE test. Nothing is rebuilt, nothing is redeployed, and the same shell
  // code produces a different interface because the server answered
  // differently.
  it('drops a module from the nav when the tenant disables it, with no deploy', async () => {
    const before_disable = deriveNavigation(await client.fetchCapability(await signIn()))
    assert.ok(before_disable.item.some((one) => one.module_code === 'billing'))

    await withTenant(store, organization_id, (tenant) =>
      disableModule(tenant, 'billing', DECLARATION),
    )

    const after_disable = deriveNavigation(await client.fetchCapability(await signIn()))
    assert.ok(
      !after_disable.item.some((one) => one.module_code === 'billing'),
      'billing is gone from the navigation',
    )

    // And the API agrees with the nav, which is the property that makes hiding
    // it honest rather than cosmetic: the route is not merely unlisted, it is
    // not there. 404 and not 403, so nothing leaks about what the tenant runs.
    const session = await signIn()
    await assert.rejects(client.get(session, '/api/v1/invoice'), (error: unknown) => {
      assert.equal((error as { http_status: number }).http_status, 404)
      return true
    })

    await withTenant(store, organization_id, (tenant) =>
      enableModule(tenant, 'billing', DECLARATION),
    )

    const after_enable = deriveNavigation(await client.fetchCapability(await signIn()))
    assert.ok(
      after_enable.item.some((one) => one.module_code === 'billing'),
      'and it comes back',
    )
  })

  // A capability revoked at the role level must remove the nav entry too —
  // discovery reports what THIS session may do, not what the tenant installed.
  it('hides a module this session lost the capability for', async () => {
    await withTenant(store, organization_id, async (tenant) => {
      await tenant.query`
        DELETE FROM role_capability
        WHERE organization_id = ${organization_id}
          AND capability_code LIKE 'form.%'`
    })

    const navigation = deriveNavigation(await client.fetchCapability(await signIn()))
    assert.ok(
      !navigation.item.some((one) => one.module_code === 'form'),
      'form is installed and enabled, but this operator can no longer read it',
    )
    assert.deepEqual(
      navigation.undrawn_module_code,
      [],
      'and it is not reported as undrawn — the shell has a view, the session lacks the right',
    )
  })

  it('refuses a wrong credential without saying which part was wrong', async () => {
    await assert.rejects(
      client.signIn({ organization_code, actor_code: ACTOR_CODE, secret: 'wrong' }),
      (error: unknown) => {
        assert.equal((error as { http_status: number }).http_status, 401)
        return true
      },
    )
  })
})
