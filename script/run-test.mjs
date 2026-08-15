// One place that decides which test file runs, per tier.
//
//   node script/run-test.mjs          every test — the gate's tier
//   node script/run-test.mjs --unit   the DB-free tier: everything but the live suite
//   node script/run-test.mjs --live   only the live suite (test/*-live.test.ts)
//
// WHY A SCRIPT rather than a glob in package.json: node --test takes inclusion
// globs only, so "everything except *-live.test.ts" is not expressible as a
// pattern — and this repo runs on PowerShell too, where `ls | grep -v` is not
// an answer either.

import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const tier = process.argv[2] ?? 'all'
if (!['all', '--unit', '--live'].includes(tier)) {
  console.error(`usage: node script/run-test.mjs [--unit|--live] — got "${tier}"`)
  process.exit(2)
}

const TEST_DIR = join(import.meta.dirname, '..', 'test')
const is_live = (name) => name.endsWith('-live.test.ts')

const file = readdirSync(TEST_DIR)
  .filter((name) => name.endsWith('.test.ts'))
  .filter((name) => (tier === '--unit' ? !is_live(name) : tier === '--live' ? is_live(name) : true))
  .sort()
  .map((name) => join(TEST_DIR, name))

console.log(`${file.length} test file (${tier === 'all' ? 'unit + live' : tier.slice(2)} tier)`)

const child = spawnSync(process.execPath, ['--test', '--experimental-strip-types', ...file], {
  stdio: 'inherit',
})
process.exit(child.status ?? 1)
