// The browser bootstrap.
//
// This file is deliberately thin, and it got that way on purpose. It used to
// hold the render code too, which meant the only way to check that the right
// button appears next to a lapsed hold was to open a browser and wait ten
// minutes. Every tree is now built by ../src/render.ts, which takes an
// `element` factory and returns nodes — so the code the page runs is the same
// code test/render.test.ts drives against a stub document.
//
// What is left here is the part that genuinely needs a browser: the document,
// session storage, the fetch origin, and the wiring between a click and a call.
// If something in here looks worth testing, it is in the wrong file.
//
// No framework yet, and that is a staging decision rather than a principle.
// Somewhere in the next seven pack views the hand-rolled element() stops paying
// for itself — the signal will be this file growing state that ../src does not
// own. Adopting one then changes nothing in ../src, because ../src never learns
// what is rendering it.

import { createClient, DiscoveryError } from '/dist/discovery.js'
import { createElement } from '/dist/dom.js'
import { deriveNavigation } from '/dist/navigation.js'
import { createTranslator } from '/dist/vocabulary.js'
import {
  renderBilling,
  renderBoard,
  renderDiscovery,
  renderNavigation,
  renderNotBuilt,
  renderSignIn,
} from '/dist/render.js'
import { renderConsole, renderMembership } from '/dist/render-gate.js'
import { renderScan } from '/dist/render-scan.js'
import { renderCounter, renderOutbox } from '/dist/render-counter.js'
import { renderDocument, renderForm } from '/dist/render-library.js'
import { createBillingApi } from '/dist/view/billing.js'
import { createGateApi } from '/dist/view/gate.js'
import { createCounterApi } from '/dist/view/counter.js'
import { createLibraryApi } from '/dist/view/library.js'
import { createScanApi } from '/dist/view/scan.js'
import { createBookingApi, groupByResource, todayRange } from '/dist/view/booking.js'
import { describeFailure } from '/dist/view/failure.js'

// What an app supplies. In a real deployment this is shell.config.json fetched
// at boot; inlined here so the dev harness has no build step at all.
const APP_CONFIG = {
  brand: { display_name: 'roundrobin shell' },
  locale: { time_zone: 'Asia/Manila' },
  navigation_order: ['booking', 'billing', 'membership', 'access'],
  label: {},
  vocabulary: {},
}

const client = createClient({ base_url: window.location.origin })
const element = createElement(document)
const translate = createTranslator(APP_CONFIG.vocabulary)
const root = document.getElementById('root')

const STORAGE_KEY = 'roundrobin.shell.session'

function render(node) {
  root.replaceChildren(node)
}

// The app bar is static markup in index.html; only the product name is a
// runtime value. Two text nodes, set once, no state — if this grows a third
// concern it belongs in ../src with a test.
document.getElementById('app-bar-product').textContent = APP_CONFIG.brand.display_name
document.getElementById('app-bar-avatar').textContent =
  APP_CONFIG.brand.display_name.trim().charAt(0).toUpperCase()

/**
 * Mark which nav item the content belongs to.
 *
 * A styling concern, and the reason it is worth the lines: the rail draws every
 * unselected item with no fill and no border at all, so without this the
 * operator has nothing at all telling them where they are. Class only — the
 * nav tree itself is still built in ../src/render.ts.
 */
function markSelected(chosen) {
  for (const one of root.querySelectorAll('.nav-item')) {
    one.classList.toggle('selected', one === chosen)
  }
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

function showSignIn(message) {
  render(renderSignIn(element, { brand: APP_CONFIG.brand.display_name, message }, { onSubmit }))

  async function onSubmit(event) {
    event.preventDefault()
    const data = new FormData(event.target)
    try {
      saveSession(
        await client.signIn({
          organization_code: data.get('organization_code'),
          actor_code: data.get('actor_code'),
          secret: data.get('secret'),
        }),
      )
      await start()
    } catch (error) {
      // The server's own message. It deliberately does not say WHICH of the
      // three was wrong — see the sign-in route in the OS.
      showSignIn(error instanceof DiscoveryError ? error.message : String(error))
    }
  }
}

// ---------------------------------------------------------------------------
// the shell
// ---------------------------------------------------------------------------

function showShell(navigation) {
  const detail = element('section', { class: 'detail' }, renderDiscovery(element, navigation))

  const nav = renderNavigation(
    element,
    { brand: APP_CONFIG.brand.display_name, navigation },
    { onSelect: select, onSignOut: signOut },
  )

  render(element('div', { class: 'layout' }, [nav, detail]))

  // Delegated rather than per-button, so ../src/render.ts never has to learn
  // that a selected state exists. Sign out is not a place, so it never marks.
  nav.addEventListener('click', (event) => {
    const clicked = event.target.closest?.('.nav-item')
    if (clicked && !clicked.classList.contains('quiet')) markSelected(clicked)
  })

  function select(item) {
    if (item.module_code === 'booking') return showBoard(detail, item)
    if (item.module_code === 'billing') return showBilling(detail, item, navigation)
    if (item.module_code === 'membership') return showMembership(detail, item)
    if (item.module_code === 'access') return showConsole(detail, item, navigation)
    if (item.module_code === 'form') return showLibrary(detail, item, 'form')
    if (item.module_code === 'document') return showLibrary(detail, item, 'document')
    if (item.module_code === 'notification') return showCounter(detail, item, 'notification')
    if (item.module_code === 'commerce') return showCounter(detail, item, 'commerce')
    if (item.module_code === 'scan') return showScan(detail, item, navigation)

    detail.replaceChildren(
      ...renderNotBuilt(
        element,
        {
          display_name: item.display_name,
          noun: translate.one(item.module_code),
          route_prefix: item.route_prefix,
        },
        { onBack: start },
      ),
    )
  }
}

function signOut() {
  clearSession()
  showSignIn()
}

// ---------------------------------------------------------------------------
// view/booking — state and wiring only; every tree comes from ../src/render.ts
// ---------------------------------------------------------------------------

function showBoard(detail, item) {
  const api = createBookingApi(client)
  const range = todayRange(new Date())

  let state = {
    status: 'loading',
    column: [],
    held: null,
    failure: undefined,
    zone: APP_CONFIG.locale.time_zone,
    day: range.starts_at.toISOString(),
    now: new Date(),
  }

  draw()
  void load()

  function draw() {
    // `now` is stamped at draw time so a hold countdown is right when it is
    // painted rather than when the board was first opened.
    detail.replaceChildren(
      ...renderBoard(
        element,
        { display_name: item.display_name, state: { ...state, now: new Date() } },
        { onHold, onConfirm, onCancel, onBack: start },
      ),
    )
  }

  async function load() {
    try {
      const slot = await api.listAvailable(loadSession(), range)
      state = { ...state, status: 'ready', column: groupByResource(slot) }
    } catch (error) {
      state = { ...state, status: 'ready', failure: describeFailure(error) }
    }
    draw()
  }

  // Every write funnels through here, so exactly one place decides what a
  // refusal looks like. A 409 means the board is out of date, not that
  // something broke — so it says so AND reloads, rather than leaving stale
  // slots on screen under a red banner.
  async function attempt(work) {
    try {
      await work()
      state = { ...state, failure: undefined }
      await load()
    } catch (error) {
      const failure = describeFailure(error)
      if (failure.is_signed_out) {
        clearSession()
        return showSignIn(failure.detail)
      }
      state = { ...state, failure }
      if (failure.is_retryable) await load()
      else draw()
    }
  }

  function onHold(slot) {
    return attempt(async () => {
      state = {
        ...state,
        held: await api.hold(loadSession(), {
          session_id: slot.session_id,
          resource_id: slot.resource_id,
        }),
      }
    })
  }

  function onConfirm(booking) {
    return attempt(async () => {
      state = { ...state, held: await api.confirm(loadSession(), booking.booking_code) }
    })
  }

  function onCancel(booking) {
    return attempt(async () => {
      await api.cancel(loadSession(), booking.booking_code)
      state = { ...state, held: null }
    })
  }
}


// ---------------------------------------------------------------------------
// view/billing — state and wiring only; every tree comes from ../src/render.ts
// ---------------------------------------------------------------------------

function showBilling(detail, item, navigation) {
  const api = createBillingApi(client)

  let state = {
    status: 'loading',
    invoice: [],
    proof: [],
    failure: undefined,
    // From the session the server reported, not from a local guess — a clerk
    // who may only read gets no review buttons at all.
    held_capability: navigation.held_capability,
    now: new Date(),
  }

  draw()
  void load()

  function draw() {
    detail.replaceChildren(
      ...renderBilling(
        element,
        { display_name: item.display_name, state: { ...state, now: new Date() } },
        { onApprove, onReject, onOpenInvoice, onBack: start },
      ),
    )
  }

  async function load() {
    const session = loadSession()
    try {
      // Two reads, one screen. Both were added to the OS for this view — the
      // pack could accept a proof and approve one by id, but could not say
      // which were waiting.
      const [invoice, proof] = await Promise.all([api.listInvoice(session), api.listProof(session)])
      state = { ...state, status: 'ready', invoice, proof }
    } catch (error) {
      state = { ...state, status: 'ready', failure: describeFailure(error) }
    }
    draw()
  }

  async function attempt(work) {
    try {
      await work()
      state = { ...state, failure: undefined }
      await load()
    } catch (error) {
      const failure = describeFailure(error)
      if (failure.is_signed_out) {
        clearSession()
        return showSignIn(failure.detail)
      }
      state = { ...state, failure }
      if (failure.is_retryable) await load()
      else draw()
    }
  }

  function onApprove(proof) {
    return attempt(() => api.approveProof(loadSession(), proof.payment_proof_id))
  }

  function onReject(proof) {
    return attempt(() => api.rejectProof(loadSession(), proof.payment_proof_id))
  }

  function onOpenInvoice(invoice) {
    return attempt(async () => {
      const found = await api.findInvoice(loadSession(), invoice.invoice_code)
      // Deliberately minimal for now: the line detail panel is its own item.
      // Saying what was read beats a button that appears to do nothing.
      window.alert(
        `${found.invoice.invoice_code} — ${found.line.length} line, balance ${found.invoice.balance_amount}`,
      )
    })
  }
}


// ---------------------------------------------------------------------------
// view/membership — may this person come in
// ---------------------------------------------------------------------------

function showMembership(detail, item) {
  const api = createGateApi(client)
  let state = {
    status: 'loading',
    membership: [],
    pass: [],
    credential: [],
    failure: undefined,
    now: new Date(),
  }

  draw()
  void load()

  function draw() {
    detail.replaceChildren(
      ...renderMembership(
        element,
        { display_name: item.display_name, state: { ...state, now: new Date() } },
        { onBack: start },
      ),
    )
  }

  async function load() {
    const session = loadSession()
    try {
      // Three reads, one screen. None of them existed before this checkpoint.
      const [membership, pass, credential] = await Promise.all([
        api.listMembership(session),
        api.listPass(session),
        api.listCredential(session),
      ])
      state = { ...state, status: 'ready', membership, pass, credential }
    } catch (error) {
      state = { ...state, status: 'ready', failure: describeFailure(error) }
    }
    draw()
  }
}

// ---------------------------------------------------------------------------
// view/access — the door console
// ---------------------------------------------------------------------------

function showConsole(detail, item, navigation) {
  const api = createGateApi(client)

  let state = {
    status: 'loading',
    point: [],
    selected_access_point_id: null,
    scan: [],
    last: null,
    failure: undefined,
    held_capability: navigation.held_capability,
    zone: APP_CONFIG.locale.time_zone,
  }

  draw()
  void load()

  function draw() {
    detail.replaceChildren(
      ...renderConsole(
        element,
        { display_name: item.display_name, state },
        { onSelectPoint, onScan, onBack: start },
      ),
    )
  }

  async function load() {
    const session = loadSession()
    try {
      const point = await api.listAccessPoint(session)
      // Default to the first door rather than making a guard pick before they
      // can see anything. One gate is the common case.
      const selected_access_point_id =
        state.selected_access_point_id ?? point[0]?.access_point_id ?? null
      const filter = selected_access_point_id ? { access_point_id: selected_access_point_id } : {}
      const scan = await api.listScanEvent(session, filter)
      state = { ...state, status: 'ready', point, selected_access_point_id, scan }
    } catch (error) {
      state = { ...state, status: 'ready', failure: describeFailure(error) }
    }
    draw()
  }

  function onSelectPoint(point) {
    state = { ...state, selected_access_point_id: point.access_point_id, last: null }
    draw()
    void load()
  }

  // A DENIAL IS NOT A FAILURE. authorizeAccess answers 200 with
  // outcome: 'denied', and treating that as an error would put a red box where
  // a guard needs a readable instruction. Only a genuine HTTP failure — a
  // revoked session, a 403 for a watcher — goes through describeFailure.
  function onScan(presented) {
    if (!presented || !state.selected_access_point_id) return
    return (async () => {
      try {
        const last = await api.scan(loadSession(), {
          access_point_id: state.selected_access_point_id,
          presented,
        })
        state = { ...state, last, failure: undefined }
        await load()
      } catch (error) {
        const failure = describeFailure(error)
        if (failure.is_signed_out) {
          clearSession()
          return showSignIn(failure.detail)
        }
        state = { ...state, failure }
        draw()
      }
    })()
  }
}

// ---------------------------------------------------------------------------
// view/form and view/document — what was written down
// ---------------------------------------------------------------------------

function showLibrary(detail, item, which) {
  const api = createLibraryApi(client)
  const draw_view = which === 'form' ? renderForm : renderDocument

  let state = {
    status: 'loading',
    template: [],
    instance: [],
    document: [],
    failure: undefined,
    now: new Date(),
  }

  draw()
  void load()

  function draw() {
    detail.replaceChildren(
      ...draw_view(
        element,
        { display_name: item.display_name, state: { ...state, now: new Date() } },
        { onOpenTemplate, onBack: start },
      ),
    )
  }

  async function load() {
    const session = loadSession()
    try {
      // Only what this screen shows. The form view does not fetch the shelf,
      // and the shelf does not fetch forms — two modules, two round trips.
      if (which === 'form') {
        const [template, instance] = await Promise.all([
          api.listTemplate(session),
          api.listInstance(session),
        ])
        state = { ...state, status: 'ready', template, instance }
      } else {
        state = { ...state, status: 'ready', document: await api.listDocument(session) }
      }
    } catch (error) {
      const failure = describeFailure(error)
      if (failure.is_signed_out) {
        clearSession()
        return showSignIn(failure.detail)
      }
      state = { ...state, status: 'ready', failure }
    }
    draw()
  }

  function onOpenTemplate(template) {
    // The template detail panel is its own item. Saying what was read beats a
    // button that appears to do nothing.
    window.alert(`${template.title} — ${template.kind}, ${template.status}`)
  }
}

// ---------------------------------------------------------------------------
// view/notification and view/commerce — what a counter has open
// ---------------------------------------------------------------------------

function showCounter(detail, item, which) {
  const api = createCounterApi(client)
  const draw_view = which === 'notification' ? renderOutbox : renderCounter

  let state = {
    status: 'loading',
    delivery: [],
    order: [],
    failure: undefined,
    zone: APP_CONFIG.locale.time_zone,
  }

  draw()
  void load()

  function draw() {
    detail.replaceChildren(
      ...draw_view(element, { display_name: item.display_name, state }, { onBack: start }),
    )
  }

  async function load() {
    const session = loadSession()
    try {
      // The outbox needs the order list too, because its attention count and
      // the counter total come from one tally — but only the screen being drawn
      // pays for what it does not show.
      if (which === 'notification') {
        state = { ...state, status: 'ready', delivery: await api.listDelivery(session) }
      } else {
        state = { ...state, status: 'ready', order: await api.listOrder(session) }
      }
    } catch (error) {
      const failure = describeFailure(error)
      if (failure.is_signed_out) {
        clearSession()
        return showSignIn(failure.detail)
      }
      state = { ...state, status: 'ready', failure }
    }
    draw()
  }
}

// ---------------------------------------------------------------------------
// view/scan — what is printed, and what happened when someone scanned it
// ---------------------------------------------------------------------------

function showScan(detail, item, navigation) {
  const api = createScanApi(client)

  let state = {
    status: 'loading',
    target: [],
    code: [],
    resolution: [],
    failure: undefined,
    held_capability: navigation.held_capability,
    now: new Date(),
  }

  draw()
  void load()

  function draw() {
    detail.replaceChildren(
      ...renderScan(
        element,
        { display_name: item.display_name, state },
        { onRevoke, onBack: start },
      ),
    )
  }

  async function load() {
    const session = loadSession()
    try {
      // Three reads, and the code list is useless without the target list —
      // a row saying "unknown target" is what a partial load looks like.
      const [target, code, resolution] = await Promise.all([
        api.listTarget(session),
        api.listCode(session),
        api.listResolution(session, { limit_count: 50 }),
      ])
      state = { ...state, status: 'ready', target, code, resolution, now: new Date() }
    } catch (error) {
      const failure = describeFailure(error)
      if (failure.is_signed_out) {
        clearSession()
        return showSignIn(failure.detail)
      }
      state = { ...state, status: 'ready', failure }
    }
    draw()
  }

  async function onRevoke(code) {
    const session = loadSession()
    try {
      await api.revokeCode(session, code.scan_code_id)
      // Re-read rather than patching the row in place. Revoking writes a
      // resolution the log should show, and a local edit would leave the two
      // halves of this screen disagreeing.
      state = { ...state, status: 'loading', failure: undefined }
      draw()
      return void load()
    } catch (error) {
      const failure = describeFailure(error)
      if (failure.is_signed_out) {
        clearSession()
        return showSignIn(failure.detail)
      }
      state = { ...state, failure }
    }
    draw()
  }
}
// ---------------------------------------------------------------------------

async function start() {
  const session = loadSession()
  if (!session) return showSignIn()

  try {
    const capability = await client.fetchCapability(session)
    showShell(
      deriveNavigation(capability, {
        navigation_order: APP_CONFIG.navigation_order,
        label: APP_CONFIG.label,
      }),
    )
  } catch (error) {
    const failure = describeFailure(error)
    // An expired token is the ordinary case, not an error state.
    if (failure.is_signed_out) {
      clearSession()
      return showSignIn(failure.detail)
    }
    render(element('p', { class: 'error' }, `${failure.headline} — ${failure.detail}`))
  }
}

await start()
