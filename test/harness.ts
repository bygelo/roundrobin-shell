// Standing up a real tenant, once.
//
// Three live tests had each grown their own ~80-line copy of this: register the
// catalog, create an organization, enable every module, build an owner role,
// grant it every capability, create an actor, wire a client, sign in, and tear
// it all down after. Identical every time, and the /fanout product-barrier
// caught the consequence — harness line outgrowing product line 2.3 to 1, with
// most of the harness being this paragraph written three times.
//
// Extracted before the remaining six pack views multiplied it by six.
//
// Deliberately NOT a mock. Everything here is the real thing: a real
// PostgreSQL, the real kernel app with every pack mounted, the real sign-in
// route, the real client. The only substitution is the socket — the OS app's
// own `request` stands in for the network, which exercises routing and
// middleware without binding a port.

import {
  createActor,
  createStore,
  enableModule,
  registerModule,
  withOwner,
  withTenant,
  type Store,
  type TenantContext,
  type Uuid,
} from '@bygelo/roundrobbin-kernel'
import { DECLARATION, createDevApp } from '../dev/app.ts'
import { createClient, type Session, type ShellClient } from '../src/discovery.ts'

export type Role = {
  role_code: string
  display_name: string
  /** Omit for every capability the catalog knows. Name them to make a clerk. */
  capability_code?: string[]
}

export type Actor = {
  actor_code: string
  role_code: string
  secret?: string
}

export const DEFAULT_SECRET = 'correct-horse'

export type Tenant = {
  store: Store
  organization_id: Uuid
  organization_code: string
  client: ShellClient
  /** Signed-in session per actor_code. */
  session: Record<string, Session>
  /** Run work inside the tenant — for seeding a pack's own fixtures. */
  inside: <T>(work: (tenant: TenantContext) => Promise<T>) => Promise<T>
  /** Drop the tenant and close the pool. Always call it in `after`. */
  teardown: () => Promise<void>
}

/**
 * A tenant with every module on, and whichever actors the caller asks for.
 *
 * `organization_code` is stamped with a caller-supplied prefix rather than a
 * random one, so a leaked row is traceable to the suite that made it.
 */
export async function standUpTenant(input: {
  database_url: string
  prefix: string
  role?: Role[]
  actor?: Actor[]
}): Promise<Tenant> {
  const store = createStore(input.database_url)
  const organization_code = `${input.prefix}-${Date.now()}`

  const role = input.role ?? [{ role_code: 'owner', display_name: 'Owner' }]
  const actor = input.actor ?? [{ actor_code: 'operator', role_code: 'owner' }]

  await withOwner(store, 'module catalog', (owner) => registerModule(owner, DECLARATION))

  const organization_id = await withOwner(store, 'create tenant', async (owner) => {
    const [row] = await owner.query<{ organization_id: Uuid }[]>`
      INSERT INTO organization (organization_code, display_name)
      VALUES (${organization_code}, ${input.prefix}) RETURNING organization_id`
    return row!.organization_id
  })

  await withTenant(store, organization_id, async (tenant) => {
    for (const one of DECLARATION) await enableModule(tenant, one.module_code, DECLARATION)

    for (const one of role) {
      const [made] = await tenant.query<{ role_id: Uuid }[]>`
        INSERT INTO role (organization_id, role_code, display_name, is_system)
        VALUES (${organization_id}, ${one.role_code}, ${one.display_name}, ${one.role_code === 'owner'})
        RETURNING role_id`

      if (one.capability_code) {
        // A named list makes a restricted actor — a clerk who may look and not
        // touch. Worth a real role row rather than a hand-made capability array,
        // because the point is that the SERVER refuses.
        for (const capability_code of one.capability_code) {
          await tenant.query`
            INSERT INTO role_capability (organization_id, role_id, capability_code)
            VALUES (${organization_id}, ${made!.role_id}, ${capability_code})`
        }
        continue
      }

      await tenant.query`
        INSERT INTO role_capability (organization_id, role_id, capability_code)
        SELECT ${organization_id}, ${made!.role_id}, capability_code FROM capability`
    }

    for (const one of actor) {
      await createActor(tenant, {
        actor_code: one.actor_code,
        display_name: one.actor_code,
        secret: one.secret ?? DEFAULT_SECRET,
        role_code: one.role_code,
      })
    }
  })

  const app = createDevApp(store)
  const client = createClient({
    base_url: 'http://local',
    fetch: ((request: RequestInfo | URL, init?: RequestInit) =>
      app.request(String(request), init)) as typeof globalThis.fetch,
  })

  const session: Record<string, Session> = {}
  for (const one of actor) {
    session[one.actor_code] = await client.signIn({
      organization_code,
      actor_code: one.actor_code,
      secret: one.secret ?? DEFAULT_SECRET,
    })
  }

  return {
    store,
    organization_id,
    organization_code,
    client,
    session,
    inside: (work) => withTenant(store, organization_id, work),
    teardown: async () => {
      await withOwner(store, 'create tenant', async (owner) => {
        await owner.query`DELETE FROM organization WHERE organization_id = ${organization_id}`
      })
      await store.end()
    },
  }
}

/** Add a party. Nearly every pack needs one to point at. */
export async function seedParty(tenant: Tenant, display_name: string): Promise<Uuid> {
  return tenant.inside(async (inside) => {
    const [row] = await inside.query<{ party_id: Uuid }[]>`
      INSERT INTO party (organization_id, display_name)
      VALUES (${tenant.organization_id}, ${display_name}) RETURNING party_id`
    return row!.party_id
  })
}
