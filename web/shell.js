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
import { createBillingApi } from '/dist/view/billing.js'
import { createBookingApi, groupByResource, todayRange } from '/dist/view/booking.js'
import { describeFailure } from '/dist/view/failure.js'

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
const element = createElement(document)
const translate = createTranslator(APP_CONFIG.vocabulary)
const root = document.getElementById('root')

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

  function select(item) {
    if (item.module_code === 'booking') return showBoard(detail, item)
    if (item.module_code === 'billing') return showBilling(detail, item, navigation)

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
