// Every name web/shell.js imports must exist in the built module it names.
//
// The browser is the only thing that runs shell.js, and it fails at RUNTIME on
// a bad import — a blank page and a console message nobody sees in CI. The
// failure this catches is mundane and easy: rename an export in src/, forget
// to rebuild or forget to update the import, and the page dies silently while
// every unit test stays green because they import from src/ directly.
//
// Deliberately a text check rather than a real import. Importing these modules
// needs a DOM, and the question here is not whether they run — it is whether
// the two sides of a module boundary agree on a list of names.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY = join(ROOT, 'web', 'shell.js')

const source = readFileSync(ENTRY, 'utf8')
const IMPORT = /import\s*\{([^}]+)\}\s*from\s*'([^']+)'/g
const EXPORT = /export\s+(?:async\s+)?(?:function|const|class|let|var)\s+([A-Za-z_$][\w$]*)/g

const problem = []
let checked = 0
let module_count = 0

for (const [, names, specifier] of source.matchAll(IMPORT)) {
  if (!specifier.startsWith('/dist/')) continue
  module_count += 1

  const built_path = join(ROOT, 'web', specifier)
  let built
  try {
    built = readFileSync(built_path, 'utf8')
  } catch {
    problem.push(`${specifier} — not built. Run: npm run build:web`)
    continue
  }

  const available = new Set([...built.matchAll(EXPORT)].map((one) => one[1]))

  for (const raw of names.split(',')) {
    const name = raw.trim().split(/\s+as\s+/)[0]
    if (!name) continue
    checked += 1
    if (!available.has(name)) {
      problem.push(
        `${specifier} does not export "${name}" — it has: ${[...available].sort().join(', ')}`,
      )
    }
  }
}

if (problem.length > 0) {
  console.error('\nweb/shell.js imports something that is not there:\n')
  for (const one of problem) console.error(`  ${one}`)
  console.error('')
  process.exit(1)
}

console.log(`web import ok — ${checked} name across ${module_count} module`)
