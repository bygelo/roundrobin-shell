// Fail loudly — and say how to fix it — when the suite cannot reach a migrated
// database.
//
// WHY THIS EXISTS: the live tests (test/*-live.test.ts) skip when DATABASE_URL
// is unset, and node --test reports a skipped suite as nothing at all — the
// summary read "172 pass, 0 skipped" while 25 live tests were nowhere in the
// count. That is how `scan` shipped undrawn on every real tenant behind a
// green gate: the two tests that would have said so were never run. A gate
// that silently skips its only real-composition tests manufactures confidence,
// which is worse than no gate (K67).
//
// So the default paths — npm test, npm run test:live, and therefore npm run
// gate — call this first and refuse to run without a database. A contributor
// without PostgreSQL still gets a fast signal from the unit tier:
// npm run test:unit.

import postgres from 'postgres'

function die(message, hint) {
  console.error(`\n  preflight: ${message}\n  fix: ${hint}\n`)
  process.exit(1)
}

const database_url = process.env['DATABASE_URL']
if (!database_url) {
  die(
    'DATABASE_URL is not set, and the live suite skips without it',
    "set DATABASE_URL to a migrated PostgreSQL (see README → Run it), or run the DB-free tier: npm run test:unit",
  )
}

// Never echo the URL itself: it carries a password. Host and database are
// enough to aim the fix.
let where
try {
  const parsed = new URL(database_url)
  where = `${parsed.hostname}:${parsed.port || 5432}${parsed.pathname}`
} catch {
  die(
    'DATABASE_URL is not a parseable URL',
    'the shape is postgres://user:password@host:port/database',
  )
}

const sql = postgres(database_url, { max: 1, connect_timeout: 5, onnotice: () => {} })

try {
  await sql`SELECT 1`
} catch (error) {
  // A refused connection arrives with an empty message and the reason in
  // `code` (ECONNREFUSED); a bad auth has a real message. Show whichever talks.
  const detail = error.message || error.code || String(error)
  die(
    `cannot reach PostgreSQL at ${where} — ${detail}`,
    'start the database (docker start blueos-db), check the port, then retry',
  )
}

try {
  const [row] = await sql`SELECT count(*)::int AS migration_count FROM schema_migration`
  if (!row || row.migration_count === 0) {
    die(
      `${where} is reachable but no migration has been applied`,
      "apply the OS migrations first: cd ../roundrobbin && npm run db:migrate (with this DATABASE_URL)",
    )
  }
} catch {
  die(
    `${where} is reachable but has no schema_migration table — migrations never ran`,
    "apply the OS migrations first: cd ../roundrobbin && npm run db:migrate (with this DATABASE_URL)",
  )
} finally {
  await sql.end()
}

console.log(`preflight ok — migrated database at ${where}`)
