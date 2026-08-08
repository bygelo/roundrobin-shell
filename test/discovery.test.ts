// The transport layer, against a stub fetch.
//
// Nothing here needs a real OS — what is under test is how the client behaves
// when the server says something unhelpful, which is exactly the case a live
// server will not reproduce on demand.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DiscoveryError, createClient } from '../src/discovery.ts'

function stub(handler: (url: string, init?: RequestInit) => Response): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)) as typeof globalThis.fetch
}

const SESSION = { token: 'tok', organization_id: 'org' }

describe('the OS client', () => {
  it('posts a credential to the sign-in route and returns the session', async () => {
    let seen_url = ''
    let seen_body = ''
    const client = createClient({
      base_url: 'http://os.local',
      fetch: stub((url, init) => {
        seen_url = url
        seen_body = String(init?.body)
        return new Response(JSON.stringify(SESSION), { status: 200 })
      }),
    })

    const session = await client.signIn({
      organization_code: 'venue',
      actor_code: 'operator',
      secret: 'correct-horse',
    })

    assert.equal(seen_url, 'http://os.local/api/v1/session')
    assert.match(seen_body, /"actor_code":"operator"/)
    assert.equal(session.token, 'tok')
  })

  it('does not double the slash when the base URL has a trailing one', async () => {
    let seen_url = ''
    const client = createClient({
      base_url: 'http://os.local/',
      fetch: stub((url) => {
        seen_url = url
        return new Response(JSON.stringify({ module: [], capability: [] }), { status: 200 })
      }),
    })
    await client.fetchCapability(SESSION)
    assert.equal(seen_url, 'http://os.local/api/v1/capability')
  })

  it('sends the bearer token on an authenticated read', async () => {
    let authorization = ''
    const client = createClient({
      base_url: 'http://os.local',
      fetch: stub((_url, init) => {
        authorization = String((init?.headers as Record<string, string>)?.['authorization'])
        return new Response(JSON.stringify({ module: [], capability: [] }), { status: 200 })
      }),
    })
    await client.fetchCapability(SESSION)
    assert.equal(authorization, 'Bearer tok')
  })

  it("surfaces the server's own message, not a generic one", async () => {
    const client = createClient({
      base_url: 'http://os.local',
      fetch: stub(() =>
        new Response(JSON.stringify({ error: 'organization_code, actor_code, or secret is incorrect' }), {
          status: 401,
        }),
      ),
    })

    await assert.rejects(
      client.signIn({ organization_code: 'venue', actor_code: 'nope', secret: 'nope' }),
      (error: unknown) => {
        assert.ok(error instanceof DiscoveryError)
        assert.equal(error.http_status, 401)
        assert.match(error.message, /is incorrect/)
        return true
      },
    )
  })

  // A proxy returning an HTML 502 is an ordinary thing to hit. Swallowing the
  // real status behind "Unexpected token <" costs an afternoon every time.
  it('does not turn a non-JSON error body into a parse error', async () => {
    const client = createClient({
      base_url: 'http://os.local',
      fetch: stub(() => new Response('<html>502 Bad Gateway</html>', { status: 502 })),
    })

    await assert.rejects(client.fetchCapability(SESSION), (error: unknown) => {
      assert.ok(error instanceof DiscoveryError)
      assert.equal(error.http_status, 502, 'the status survives')
      return true
    })
  })

  // A dead server and a refused request are different problems with different
  // fixes, so they must not read the same.
  it('says the OS is unreachable when the fetch itself fails', async () => {
    const client = createClient({
      base_url: 'http://os.local',
      fetch: (() => Promise.reject(new Error('ECONNREFUSED'))) as typeof globalThis.fetch,
    })

    await assert.rejects(client.fetchCapability(SESSION), (error: unknown) => {
      assert.ok(error instanceof DiscoveryError)
      assert.equal(error.http_status, 0, 'no HTTP status, because there was no HTTP response')
      assert.match(error.message, /cannot reach the OS at http:\/\/os\.local/)
      return true
    })
  })
})
