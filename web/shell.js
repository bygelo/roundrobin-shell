// The browser layer.
//
// Deliberately no framework yet, and that is a staging decision rather than a
// principle. Everything worth arguing about — which packs render, which
// actions a session may take, how long a hold has left, what a refusal should
// say — lives in ../src, is pure, and is tested headlessly. What remains here
// is turning that into DOM.
//
// One pack view is drawn (booking). Seven to go. Somewhere in there the
// hand-rolled `element()` in ../src/dom.ts stops paying for itself and a framework starts
// earning its keep — the signal will be this file growing state that ../src
// does not own. Adopting one then changes nothing in ../src, because ../src
// never learns what is rendering it.

import { createClient, DiscoveryError } from '/dist/discovery.js'
import { deriveNavigation } from '/dist/navigation.js'
import { createTranslator } from '/dist/vocabulary.js'
import {
  actionFor,
  createBookingApi,
  formatDay,
  formatRange,
  groupByResource,
  holdMinuteRemaining,
  todayRange,
} from '/dist/view/booking.js'
import { describeFailure } from '/dist/view/failure.js'
// The one DOM primitive, extracted to ../src so it can be tested against a stub
// document. It is where a conditional child or a mapped array goes wrong.
import { createElement } from '/dist/dom.js'

// What an app supplies. In a real deployment this is shell.config.json fetched
// at boot; inlined here so the dev harness has no build step at all.
const APP_CONFIG = {
  brand: { display_name: 'roundrobbin shell' },
  locale: { time_zone: 'Asia/Manila' },
  navigation_order: ['booking', 'billing', 'membership', 'access'],
  label: {},
  vocabulary: {},
}

const client = createClient({ base_url: window.location.origin })
const translate = createTranslator(APP_CONFIG.vocabulary)
const root = document.getElementById('root')
const element = createElement(document)

const STORAGE_KEY = 'roundrobbin.shell.session'

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
    if (item.module_code === 'booking') return renderBooking(detail, item)

    // The remaining seven land in later phases. Saying so is more useful than
    // a blank panel that looks like a bug.
    detail.replaceChildren(
      element('h2', {}, item.display_name),
      element('p', { class: 'muted' }, [
        `Screens for ${translate.one(item.module_code)} are not built yet. `,
        `This module answers on ${item.route_prefix.join(', ') || 'no route'}.`,
      ]),
      element('button', { class: 'small', onclick: () => start() }, 'Back'),
    )
  }
}

// ---------------------------------------------------------------------------
// view/booking — the first pack view
// ---------------------------------------------------------------------------

function renderBooking(detail, item) {
  const zone = APP_CONFIG.locale.time_zone
  const api = createBookingApi(client)
  const range = todayRange(new Date())
  let held = null

  draw({ status: 'loading' })
  void load()

  async function load() {
    try {
      const slot = await api.listAvailable(loadSession(), range)
      draw({ status: 'ready', column: groupByResource(slot) })
    } catch (error) {
      draw({ status: 'failed', failure: describeFailure(error) })
    }
  }

  // Every write funnels through here so that exactly one place decides what a
  // refusal looks like. A 409 is the double-booking guarantee working, and the
  // board is simply out of date — so the honest response is to say so and
  // reload, not to show a red error and leave stale slots on screen.
  async function attempt(work) {
    try {
      await work()
      await load()
    } catch (error) {
      const failure = describeFailure(error)
      if (failure.is_signed_out) {
        clearSession()
        return renderSignIn(failure.detail)
      }
      draw({ status: 'ready', failure, column: currentColumn })
      if (failure.is_retryable) await load()
    }
  }

  let currentColumn = []

  function draw(state) {
    if (state.column) currentColumn = state.column
    const now = new Date()

    detail.replaceChildren(
      element('h2', {}, item.display_name),
      element('p', { class: 'muted small-text' }, formatDay(range.starts_at.toISOString(), zone)),

      state.failure ? failureBanner(state.failure) : '',

      state.status === 'loading' ? element('p', { class: 'muted' }, 'reading availability…') : '',

      held ? holdCard(held, now) : '',

      state.status !== 'loading' && currentColumn.length === 0
        ? element('p', { class: 'muted' }, 'Nothing bookable in this window.')
        : '',

      ...currentColumn.map((column) =>
        element('div', { class: 'column' }, [
          element('h3', {}, column.display_name),
          element(
            'div',
            { class: 'action' },
            column.slot.map((one) =>
              element(
                'button',
                {
                  class: 'small',
                  onclick: () =>
                    attempt(async () => {
                      held = await api.hold(loadSession(), {
                        session_id: one.session_id,
                        resource_id: one.resource_id,
                      })
                    }),
                },
                `${formatRange(one.starts_at, one.ends_at, zone)} · ₱${one.price_amount}`,
              ),
            ),
          ),
        ]),
      ),

      element('button', { class: 'small', onclick: () => start() }, 'Back'),
    )
  }

  function holdCard(booking, now) {
    const remaining = holdMinuteRemaining(booking, now)
    const available = actionFor(booking, now)

    return element('div', { class: 'hold' }, [
      element('strong', {}, `${booking.status} · ${booking.booking_code}`),
      element(
        'span',
        { class: 'muted' },
        remaining === null
          ? booking.status === 'confirmed'
            ? ' confirmed'
            : ' this hold has lapsed'
          : ` ${remaining} minute left to confirm`,
      ),
      element(
        'div',
        { class: 'action' },
        available.map((action) =>
          element(
            'button',
            {
              class: 'small',
              onclick: () =>
                attempt(async () => {
                  if (action === 'confirm') {
                    held = await api.confirm(loadSession(), booking.booking_code)
                  } else {
                    await api.cancel(loadSession(), booking.booking_code)
                    held = null
                  }
                }),
            },
            action === 'confirm' ? 'Confirm' : 'Cancel',
          ),
        ),
      ),
    ])
  }

  // A refusal reads as a sentence. The class is chosen by is_retryable rather
  // than by status: a contested slot is not an error state, it is news.
  function failureBanner(failure) {
    return element('div', { class: failure.is_retryable ? 'notice' : 'error-box' }, [
      element('strong', {}, failure.headline),
      element('p', { class: 'small-text' }, failure.detail),
    ])
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
