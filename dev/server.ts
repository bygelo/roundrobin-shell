// Serve the OS and the shell from one origin.
//
// One origin on purpose: it keeps CORS out of a phase-1 exercise that is about
// discovery, not about preflight. A real deployment serves the shell as static
// files from anywhere and points it at the OS with `base_url`, which is the
// whole reason the client takes one.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { createStore } from '@bygelo/roundrobin-kernel'
import { createDevApp } from './app.ts'
import { resolveComposition } from './composition.ts'

const database_url = process.env['DATABASE_URL']
if (!database_url) {
  console.error('DATABASE_URL is not set. Refusing to guess a database.')
  process.exit(1)
}

const composition_code = process.env['COMPOSITION'] ?? 'all'
const composition = composition_code === 'all' ? undefined : resolveComposition(composition_code)
if (composition_code !== 'all' && !composition) {
  console.error(`COMPOSITION must be fnb, court, or all — got "${composition_code}"`)
  process.exit(1)
}

const store = createStore(database_url)
const os_app = composition ? composition.createApp(store) : createDevApp(store)

const WEB_ROOT = join(import.meta.dirname, '..', 'web')

const CONTENT_TYPE: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}

const app = new Hono()

// The OS first, so a static file can never shadow an API route.
app.route('/', os_app)

app.get('/*', async (context) => {
  const path = new URL(context.req.url).pathname
  const name = path === '/' ? 'index.html' : path.slice(1)

  // Refuse traversal rather than sanitising it. This is a dev server, but a
  // dev server that serves /etc/passwd is still a dev server that serves
  // /etc/passwd.
  if (name.includes('..')) return context.text('not found', 404)

  const extension = name.slice(name.lastIndexOf('.'))
  try {
    const body = await readFile(join(WEB_ROOT, name), 'utf8')
    return context.body(body, 200, {
      'content-type': CONTENT_TYPE[extension] ?? 'application/octet-stream',
      // Discovery is the point; a cached shell defeats the demonstration.
      'cache-control': 'no-store',
    })
  } catch {
    return context.text('not found', 404)
  }
})

const port = Number(process.env['PORT'] ?? 8788)
serve({ fetch: app.fetch, port })
console.log(`roundrobin shell on http://localhost:${port}`)
console.log(`the OS it discovers is mounted at the same origin`)
console.log(`composition: ${composition ? composition.composition_code : 'all (nine pack harness)'}`)
