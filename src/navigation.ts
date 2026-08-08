// What the shell shows, derived from what the server says is on.
//
// THE WHOLE IDEA OF THIS REPO IS IN THIS FILE, and it is deliberately pure: no
// fetch, no DOM, no framework. Given one capability payload it returns the
// navigation. That makes the claim testable without a browser, a database, or a
// running server — which matters, because the claim is the product.
//
// The split it encodes:
//
//   the shell HARDCODES how to render a pack   (view/<pack>/, phase 2)
//   DISCOVERY decides which packs render        (this file)
//
// Rejected alternative, recorded because it is the tempting one: have each pack
// publish a field-level description of its entities and generate screens from
// it. That is a second schema language that has to stay in step with the first,
// and its failure mode is silent — a form rendering the wrong field looks
// exactly like one rendering the right field until somebody submits it. See
// docs/frontend.md in the OS repo.

/** One module as GET /api/v1/capability reports it. */
export type ModuleState = {
  module_code: string
  is_enabled: boolean
  schema_version: number
  is_upgrade_pending: boolean
  /** Empty for a disabled module — the server reports none, matching the 404. */
  route_prefix: string[]
}

/** The whole payload of GET /api/v1/capability. */
export type Capability = {
  organization_id: string
  module: ModuleState[]
  /** What THIS session may do, not what the tenant could theoretically do. */
  capability: string[]
}

/** A pack the shell knows how to draw. */
export type PackView = {
  module_code: string
  /** Fallback label. An app's vocabulary overrides it — see vocabulary.ts. */
  display_name: string
  /** Without this capability the pack is not worth a nav entry. */
  read_capability: string
  /**
   * Actions the pack's screens offer, each gated on a capability.
   *
   * Hiding a button is a COURTESY, never a control. The server refuses
   * independently — every pack route calls the kernel's authorize() — so a
   * shell bug can at worst show a button that then 403s, and can never grant
   * anything.
   */
  action: { action_code: string; display_name: string; capability: string }[]
}

/**
 * Every pack this shell can draw.
 *
 * Nine entries, a bounded and slow-moving set. Adding a tenth is a deliberate
 * act by a person who has read the pack — which is the point.
 *
 * Phase 1 ships this registry and the navigation it produces. The screens
 * behind it land pack by pack in the order docs/frontend.md sets out, which is
 * the sell-first order and not the alphabet.
 */
export const PACK_VIEW: PackView[] = [
  {
    module_code: 'booking',
    display_name: 'Booking',
    read_capability: 'booking.read',
    action: [
      { action_code: 'booking.hold', display_name: 'Book a slot', capability: 'booking.write' },
      { action_code: 'booking.configure', display_name: 'Configure', capability: 'booking.manage' },
    ],
  },
  {
    module_code: 'billing',
    display_name: 'Billing',
    read_capability: 'billing.read',
    action: [
      { action_code: 'billing.invoice', display_name: 'Raise an invoice', capability: 'billing.write' },
      { action_code: 'billing.proof', display_name: 'Review proof of payment', capability: 'billing.manage' },
    ],
  },
  {
    module_code: 'membership',
    display_name: 'Membership',
    read_capability: 'membership.read',
    action: [
      { action_code: 'membership.issue', display_name: 'Issue a pass', capability: 'membership.write' },
    ],
  },
  {
    module_code: 'access',
    display_name: 'Access',
    read_capability: 'access.read',
    action: [{ action_code: 'access.scan', display_name: 'Open gate console', capability: 'access.write' }],
  },
  {
    module_code: 'form',
    display_name: 'Form',
    read_capability: 'form.read',
    action: [{ action_code: 'form.build', display_name: 'Build a template', capability: 'form.manage' }],
  },
  {
    module_code: 'document',
    display_name: 'Document',
    read_capability: 'document.read',
    action: [{ action_code: 'document.upload', display_name: 'Upload', capability: 'document.write' }],
  },
  {
    module_code: 'notification',
    display_name: 'Notification',
    read_capability: 'notification.read',
    action: [
      { action_code: 'notification.send', display_name: 'Send', capability: 'notification.write' },
    ],
  },
  {
    module_code: 'commerce',
    display_name: 'Commerce',
    read_capability: 'commerce.read',
    action: [{ action_code: 'commerce.order', display_name: 'Take an order', capability: 'commerce.write' }],
  },
]

export type NavigationItem = {
  module_code: string
  display_name: string
  route_prefix: string[]
  /** Actions this session may actually take. Never used as a permission. */
  action: { action_code: string; display_name: string }[]
  /** The module is on, but its migrations are behind the code that serves it. */
  is_upgrade_pending: boolean
}

export type Navigation = {
  organization_id: string
  item: NavigationItem[]
  /**
   * Everything this session may do, carried through verbatim.
   *
   * The nav already filters by capability, but a VIEW needs the raw list — a
   * billing clerk who may read the proof queue and not clear it gets the screen
   * and not the buttons, and that is a decision inside the screen rather than
   * one about whether the screen exists.
   */
  held_capability: string[]
  /**
   * Modules the server reports that this shell has no screens for.
   *
   * Surfaced rather than dropped. A silent omission here would read as "that
   * pack is off" when the truth is "nobody has drawn it yet", and those two
   * want very different responses from whoever is looking.
   */
  undrawn_module_code: string[]
}

export type NavigationOption = {
  /** App-supplied order. Anything unlisted follows, in registry order. */
  navigation_order?: string[]
  /** App-supplied labels, so a clinic reads "Appointment" where the pack says "Booking". */
  label?: Record<string, string>
}

/**
 * Turn one capability payload into the navigation to draw.
 *
 * A module earns a nav entry when THREE things are true, and all three come
 * from the server rather than from a build:
 *
 *   1. the tenant has it enabled,
 *   2. this session holds its read capability,
 *   3. this shell has a view registered for it.
 *
 * Failing (1) or (2) is silence, deliberately: the server returns 404 rather
 * than 403 for a disabled module precisely so an outsider cannot learn which
 * modules a tenant runs, and a nav item that said "Billing (no access)" would
 * hand back exactly what that 404 withholds.
 *
 * Failing (3) is reported, because it is a gap in this repo and not a fact
 * about the tenant.
 */
export function deriveNavigation(
  capability: Capability,
  option: NavigationOption = {},
): Navigation {
  const held = new Set(capability.capability)
  const drawn = new Map(PACK_VIEW.map((one) => [one.module_code, one]))

  const item: NavigationItem[] = []
  const undrawn_module_code: string[] = []

  for (const state of capability.module) {
    if (!state.is_enabled) continue

    const view = drawn.get(state.module_code)
    if (!view) {
      undrawn_module_code.push(state.module_code)
      continue
    }
    if (!held.has(view.read_capability)) continue

    item.push({
      module_code: state.module_code,
      display_name: option.label?.[state.module_code] ?? view.display_name,
      route_prefix: state.route_prefix,
      action: view.action
        .filter((one) => held.has(one.capability))
        .map((one) => ({ action_code: one.action_code, display_name: one.display_name })),
      is_upgrade_pending: state.is_upgrade_pending,
    })
  }

  return {
    organization_id: capability.organization_id,
    item: sortItem(item, option.navigation_order),
    undrawn_module_code,
    held_capability: capability.capability,
  }
}

/**
 * App order first, then registry order for anything it did not mention.
 *
 * An app that lists three of eight packs gets those three at the top and is not
 * punished for the omission — the alternative is a config file that has to be
 * edited every time a pack is enabled.
 */
function sortItem(item: NavigationItem[], navigation_order?: string[]): NavigationItem[] {
  if (!navigation_order || navigation_order.length === 0) return item

  const rank = new Map(navigation_order.map((code, index) => [code, index]))
  const fallback = navigation_order.length

  return [...item].sort((left, right) => {
    const left_rank = rank.get(left.module_code) ?? fallback
    const right_rank = rank.get(right.module_code) ?? fallback
    return left_rank - right_rank
  })
}

/**
 * Whether a path belongs to a module this session can reach.
 *
 * Used to decide whether to attempt a request at all. It is a UX shortcut and
 * nothing more: the server owns the answer, and this only avoids showing a
 * spinner before a 404 that was always going to arrive.
 */
export function isReachable(navigation: Navigation, path: string): boolean {
  return navigation.item.some((one) => one.route_prefix.some((prefix) => path.startsWith(prefix)))
}
