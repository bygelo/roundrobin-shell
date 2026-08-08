// The phase-1 exit condition, executed.
//
//   "Signing in against a seeded tenant renders nav from /api/v1/capability,
//    and toggling a module in the DB changes the nav on reload with no deploy."
//
// Every layer here is real: a real PostgreSQL, the real kernel app with every
// pack mounted, the real sign-in route, the real client, and the real
// derivation. The only thing not real is the socket — see test/harness.ts.
//
// Skipped without DATABASE_URL, matching the OS convention. It must run in CI.

import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { disableModule, enableModule } from '@bygelo/roundrobbin-kernel'
import { DECLARATION } from '../dev/app.ts'
import { deriveNavigation } from '../src/navigation.ts'
import { standUpTenant, type Tenant } from './harness.ts'

const DATABASE_URL = process.env['DATABASE_URL']

describe('the shell against a real OS', { skip: !DATABASE_URL }, () => {
  let tenant: Tenant

  before(async () => {
    tenant = await standUpTenant({
      database_url: DATABASE_URL!,
      prefix: 'shell-live',
      actor: [{ actor_code: 'operator', role_code: 'owner' }],
    })
  })

  after(() => tenant.teardown())

  const navigate = async () =>
    deriveNavigation(await tenant.client.fetchCapability(tenant.session['operator']!))

  it('signs in over HTTP and gets a usable session', () => {
    const session = tenant.session['operator']!
    assert.equal(session.organization_id, tenant.organization_id)
    assert.ok(session.token.length > 20)
  })

  it('renders navigation from what the server reports', async () => {
    const navigation = await navigate()

    assert.equal(navigation.organization_id, tenant.organization_id)
    assert.deepEqual(
      navigation.item.map((one) => one.module_code).sort(),
      ['access', 'billing', 'booking', 'commerce', 'document', 'form', 'membership', 'notification'],
      'every installed pack draws, because this operator holds every capability',
    )
    assert.deepEqual(navigation.undrawn_module_code, [], 'every enabled module has a view')
  })

  // THE test. Nothing is rebuilt, nothing is redeployed, and the same shell
  // code produces a different interface because the server answered
  // differently.
  it('drops a module from the nav when the tenant disables it, with no deploy', async () => {
    const before_disable = await navigate()
    assert.ok(before_disable.item.some((one) => one.module_code === 'billing'))

    await tenant.inside((inside) => disableModule(inside, 'billing', DECLARATION))

    const after_disable = await navigate()
    assert.ok(
      !after_disable.item.some((one) => one.module_code === 'billing'),
      'billing is gone from the navigation',
    )

    // And the API agrees with the nav, which is the property that makes hiding
    // it honest rather than cosmetic: the route is not merely unlisted, it is
    // not there. 404 and not 403, so nothing leaks about what the tenant runs.
    await assert.rejects(
      tenant.client.get(tenant.session['operator']!, '/api/v1/invoice'),
      (error: unknown) => {
        assert.equal((error as { http_status: number }).http_status, 404)
        return true
      },
    )

    await tenant.inside((inside) => enableModule(inside, 'billing', DECLARATION))

    const after_enable = await navigate()
    assert.ok(after_enable.item.some((one) => one.module_code === 'billing'), 'and it comes back')
  })

  // A capability revoked at the role level must remove the nav entry too —
  // discovery reports what THIS session may do, not what the tenant installed.
  it('hides a module this session lost the capability for', async () => {
    await tenant.inside(async (inside) => {
      await inside.query`
        DELETE FROM role_capability
        WHERE organization_id = ${tenant.organization_id}
          AND capability_code LIKE 'form.%'`
    })

    const navigation = await navigate()
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
      tenant.client.signIn({
        organization_code: tenant.organization_code,
        actor_code: 'operator',
        secret: 'wrong',
      }),
      (error: unknown) => {
        assert.equal((error as { http_status: number }).http_status, 401)
        return true
      },
    )
  })
})
