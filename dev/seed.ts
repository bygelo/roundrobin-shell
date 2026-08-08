// Seed one tenant with every module on and one operator who can use them.
//
// Idempotent by tenant code, so running it twice is not an error and not a
// duplicate. That matters more than it sounds: the phase-1 exercise is to
// toggle modules and reload, and a seed that had to be run exactly once would
// make resetting harder than the thing being demonstrated.

import {
  createActor,
  createStore,
  enableModule,
  registerModule,
  withOwner,
  withTenant,
  type Uuid,
} from '@bygelo/roundrobbin-kernel'
import { DECLARATION } from './app.ts'

const database_url = process.env['DATABASE_URL']
if (!database_url) {
  console.error('DATABASE_URL is not set. Refusing to guess a database.')
  process.exit(1)
}

export const TENANT_CODE = process.env['SEED_ORGANIZATION_CODE'] ?? 'shell-dev'
export const ACTOR_CODE = 'operator'
export const ACTOR_SECRET = 'correct-horse'

const store = createStore(database_url)

// Registering the catalog on every boot is the intended usage: it is
// idempotent, so adding a module or bumping a schema version needs no separate
// step.
await withOwner(store, 'module catalog', (owner) => registerModule(owner, DECLARATION))

const organization_id = await withOwner(store, 'create tenant', async (owner) => {
  const [existing] = await owner.query<{ organization_id: Uuid }[]>`
    SELECT organization_id FROM organization WHERE organization_code = ${TENANT_CODE}`
  if (existing) return existing.organization_id

  const [row] = await owner.query<{ organization_id: Uuid }[]>`
    INSERT INTO organization (organization_code, display_name)
    VALUES (${TENANT_CODE}, 'Shell Dev Tenant') RETURNING organization_id`
  return row!.organization_id
})

await withTenant(store, organization_id, async (tenant) => {
  for (const one of DECLARATION) {
    // enableModule is dependency-checked and idempotent; a module already on
    // stays on.
    await enableModule(tenant, one.module_code, DECLARATION).catch((error: unknown) => {
      console.warn(`  could not enable ${one.module_code}: ${String(error)}`)
    })
  }

  const [role] = await tenant.query<{ role_id: Uuid }[]>`
    INSERT INTO role (organization_id, role_code, display_name, is_system)
    VALUES (${organization_id}, 'owner', 'Owner', true)
    ON CONFLICT (organization_id, role_code) DO UPDATE SET display_name = EXCLUDED.display_name
    RETURNING role_id`

  // Every capability the catalog knows about. A dev operator who cannot see
  // half the shell is testing the wrong thing.
  await tenant.query`
    INSERT INTO role_capability (organization_id, role_id, capability_code)
    SELECT ${organization_id}, ${role!.role_id}, capability_code FROM capability
    ON CONFLICT DO NOTHING`

  const [actor] = await tenant.query<{ actor_id: Uuid }[]>`
    SELECT actor_id FROM actor
    WHERE organization_id = ${organization_id} AND actor_code = ${ACTOR_CODE}`

  if (!actor) {
    await createActor(tenant, {
      actor_code: ACTOR_CODE,
      display_name: 'Front Desk',
      secret: ACTOR_SECRET,
      role_code: 'owner',
    })
  }
})

console.log(`seeded tenant "${TENANT_CODE}"`)
console.log(`  organization_code: ${TENANT_CODE}`)
console.log(`  actor_code:        ${ACTOR_CODE}`)
console.log(`  secret:            ${ACTOR_SECRET}`)
console.log('')
console.log('To watch discovery work, turn a module off and reload the shell:')
console.log(`  UPDATE organization_module SET is_enabled = false`)
console.log(`  WHERE organization_id = '${organization_id}'`)
console.log(`    AND module_id = (SELECT module_id FROM module WHERE module_code = 'billing');`)

await store.end()
