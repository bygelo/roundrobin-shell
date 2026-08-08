// The browser layer.
//
// Deliberately no framework, and that is a phase-1 decision rather than a
// principle. Everything worth arguing about — which packs render, which
// actions a session may take, what the app calls a resource — lives in ../src,
// is pure, and is tested headlessly. What remains here is turning that into
// DOM, and a framework would add a build pipeline to a repo whose only shipped
// logic today is one pure function.
//
// Phase 2 draws nine pack views with forms, tables, and a calendar. That is
// where a framework earns its keep, and adopting one then changes nothing in
// ../src, because ../src never learns what is rendering it.

import { createClient, DiscoveryError } from '/dist/discovery.js'
import { deriveNavigation } from '/dist/navigation.js'
import { createTranslator } from '/dist/vocabulary.js'

// What an app supplies. In a real deployment this is shell.config.json fetched
// at boot; inlined here so the dev harness has no build step at all.
const APP_CONFIG = {
  brand: { display_name: 'roundrobbin shell' },
  navigation_order: ['booking', 'billing', 'membership', 'access'],
  label: {},
  vocabulary: {},
}

const client = createClient({ base_url: window.location.origin })
const translate = createTranslator(APP_CONFIG.vocabulary)
const root = document.getElementById('root')

const STORAGE_KEY = 'roundrobbin.shell.session'

function element(tag, attribute = {}, child = []) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attribute)) {
    if (key === 'class') node.className = value
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value)
    else node.setAttribute(key, value)
  }
  for (const one of [].concat(child)) {
    node.append(typeof one === 'string' ? document.createTextNode(one) : one)
  }
  return node
}

function render(node) {
  root.replaceChildren(node)
}

function loadSession() {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

// sessionStorage, not localStorage: a bearer token should not outlive the tab.
function saveSession(session) {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

function clearSession() {
  window.sessionStorage.removeItem(STORAGE_KEY)
}

// ---------------------------------------------------------------------------
// sign in
// ---------------------------------------------------------------------------

function renderSignIn(message) {
  const form = element('form', { class: 'card', onsubmit: onSubmit }, [
    element('h1', {}, APP_CONFIG.brand.display_name),
    element('p', { class: 'muted' }, 'Sign in to see what this tenant has enabled.'),
    field('organization_code', 'Organization', 'shell-dev'),
    field('actor_code', 'Actor', 'operator'),
    field('secret', 'Secret', '', 'password'),
    element('button', { type: 'submit' }, 'Sign in'),
    message ? element('p', { class: 'error' }, message) : '',
  ])
  render(form)

  function field(name, label, value, type = 'text') {
    return element('label', {}, [
      element('span', {}, label),
      element('input', { name, type, value, autocomplete: 'off' }),
    ])
  }

  async function onSubmit(event) {
    event.preventDefault()
    const data = new FormData(event.target)
    try {
      const session = await client.signIn({
        organization_code: data.get('organization_code'),
        actor_code: data.get('actor_code'),
        secret: data.get('secret'),
      })
      saveSession(session)
      await start()
    } catch (error) {
      // The server's own message, not a generic one. It deliberately does not
      // say WHICH of the three was wrong — see the sign-in route in the OS.
      renderSignIn(error instanceof DiscoveryError ? error.message : String(error))
    }
  }
}

// ---------------------------------------------------------------------------
// the shell proper
// ---------------------------------------------------------------------------

function renderShell(navigation) {
  const nav = element('nav', {}, [
    element('div', { class: 'brand' }, APP_CONFIG.brand.display_name),
    ...navigation.item.map((item) =>
      element('button', { class: 'nav-item', onclick: () => select(item) }, [
        item.display_name,
        item.is_upgrade_pending ? element('span', { class: 'pill' }, 'migration pending') : '',
      ]),
    ),
    element('button', { class: 'nav-item quiet', onclick: signOut }, 'Sign out'),
  ])

  const detail = element('section', { class: 'detail' }, [
    element('h2', {}, 'Discovery'),
    element('p', { class: 'muted' }, [
      `${navigation.item.length} module enabled for this session. `,
      'Turn one off in the database and reload — nothing here is deployed.',
    ]),
    element(
      'ul',
      { class: 'plain' },
      navigation.item.map((one) =>
        element('li', {}, [
          element('strong', {}, one.display_name),
          element('span', { class: 'muted' }, ` — ${one.route_prefix.join(', ') || 'no route'}`),
          one.action.length
            ? element(
                'div',
                { class: 'action' },
                one.action.map((action) => element('button', { class: 'small' }, action.display_name)),
              )
            : element('p', { class: 'muted small-text' }, 'read only for this session'),
        ]),
      ),
    ),
    // Surfaced rather than dropped: a module with no view is a gap in this
    // repo, and reads very differently from a module that is off.
    navigation.undrawn_module_code.length
      ? element('p', { class: 'warn' }, [
          'Enabled, but this shell has no screens for: ',
          navigation.undrawn_module_code.join(', '),
        ])
      : '',
    element('p', { class: 'muted small-text' }, `tenant ${navigation.organization_id}`),
  ])

  render(element('div', { class: 'layout' }, [nav, detail]))

  function select(item) {
    // Phase 2 mounts view/<pack> here. Saying so is more useful than a blank
    // panel that looks like a bug.
    detail.replaceChildren(
      element('h2', {}, item.display_name),
      element('p', { class: 'muted' }, [
        `Screens for ${translate.one(item.module_code)} land in phase 2. `,
        `This module answers on ${item.route_prefix.join(', ') || 'no route'}.`,
      ]),
      element('button', { class: 'small', onclick: () => start() }, 'Back'),
    )
  }
}

function signOut() {
  clearSession()
  renderSignIn()
}

async function start() {
  const session = loadSession()
  if (!session) return renderSignIn()

  try {
    const capability = await client.fetchCapability(session)
    renderShell(
      deriveNavigation(capability, {
        navigation_order: APP_CONFIG.navigation_order,
        label: APP_CONFIG.label,
      }),
    )
  } catch (error) {
    // An expired or revoked token is the ordinary case, not an error state.
    if (error instanceof DiscoveryError && error.http_status === 401) {
      clearSession()
      return renderSignIn('That session has expired. Sign in again.')
    }
    render(element('p', { class: 'error' }, String(error)))
  }
}

await start()
