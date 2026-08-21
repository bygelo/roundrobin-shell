// The only place the shell talks to a roundrobin OS.
//
// HTTP, exactly like any other consumer. No database handle, no kernel import,
// no privileged path. If the shell ever needs something the API cannot express,
// that is a finding against the API — most likely K22, the public API — and not
// a reason to reach past it.
//
// Everything here is transport. The decisions live in navigation.ts, which is
// pure, so the interesting behaviour stays testable without a server.

import type { Capability } from './navigation.ts'

export class DiscoveryError extends Error {
  readonly http_status: number
  constructor(message: string, http_status: number) {
    super(message)
    this.name = 'DiscoveryError'
    this.http_status = http_status
  }
}

export type Session = {
  token: string
  organization_id: string
}

export type Credential = {
  /** The tenant. A shell serving one tenant can pin this in config. */
  organization_code: string
  /** Not an email. The kernel identifies an operator by a code within a tenant. */
  actor_code: string
  secret: string
  scope_id?: string
}

export type ClientOption = {
  /** Base URL of the OS. No trailing slash. */
  base_url: string
  /** Injected in tests, and in a browser it is just globalThis.fetch. */
  fetch?: typeof globalThis.fetch
}

export type ShellClient = {
  signIn: (credential: Credential) => Promise<Session>
  fetchCapability: (session: Session) => Promise<Capability>
  get: <T>(session: Session, path: string, query?: Record<string, string | undefined>) => Promise<T>
  post: <T>(session: Session, path: string, body?: unknown) => Promise<T>
}

export function createClient(option: ClientOption): ShellClient {
  const call = option.fetch ?? globalThis.fetch
  const base = option.base_url.replace(/\/+$/, '')

  async function request<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response
    try {
      response = await call(`${base}${path}`, init)
    } catch (cause) {
      // A dead server and a refused request are different problems with
      // different fixes, so they get different messages rather than one
      // "something went wrong".
      throw new DiscoveryError(`cannot reach the OS at ${base}: ${String(cause)}`, 0)
    }

    const text = await response.text()
    const body = text ? safeJson(text) : undefined

    if (!response.ok) {
      const message =
        (body as { error?: string } | undefined)?.error ?? `${response.status} ${response.statusText}`
      throw new DiscoveryError(message, response.status)
    }
    return body as T
  }

  return {
    signIn: (credential) =>
      request<Session>('/api/v1/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(credential),
      }),

    fetchCapability: (session) =>
      request<Capability>('/api/v1/capability', {
        headers: { authorization: `Bearer ${session.token}` },
      }),

    get: (session, path, query) =>
      request(`${path}${searchOf(query)}`, {
        headers: { authorization: `Bearer ${session.token}` },
      }),

    post: (session, path, body) =>
      request(path, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${session.token}`,
          'content-type': 'application/json',
        },
        // A route with nothing to send still needs a body, because the pack
        // routes call context.req.json() unconditionally and an empty body
        // throws there rather than here.
        body: JSON.stringify(body ?? {}),
      }),
  }
}

/**
 * Build a query string, dropping anything undefined.
 *
 * Serialising `undefined` yields the literal string "undefined", which the
 * booking pack then parses as a date and turns into Invalid Date — a filter
 * nobody asked for, applied silently.
 */
function searchOf(query?: Record<string, string | undefined>): string {
  if (!query) return ''
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) search.set(key, value)
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

/**
 * A non-JSON error body must not become a JSON parse error.
 *
 * A proxy returning an HTML 502 is a normal thing to hit, and swallowing the
 * real status behind "Unexpected token <" wastes an afternoon.
 */
function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return { error: text.slice(0, 200) }
  }
}
