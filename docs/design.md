# The default look — Fluent, as the Microsoft account dashboard uses it

**Status:** built. `web/shell.css` implements this; `src/` was not touched. The values were then checked against Fluent 2's published tokens rather than against the screenshots alone, and four conflicts turned up — they are in *Where the reference and Fluent 2 disagree*, below, with what shipped in each case.

The reference is the **Microsoft account dashboard** (`account.microsoft.com`) — not Fluent in general, not Windows 11, not Azure portal. Those differ in ways that matter, and where they differ this document follows the account dashboard.

## Why this one

The shell renders whatever discovery says is on. That means the layout has to absorb an unknown number of unrelated sections without being redesigned per composition — F&B gets three, court gets six, and neither knows the other exists. The account dashboard solves exactly that problem: it is a **fixed frame plus a vertical stack of self-contained collapsible cards**, where a section can be added or removed with no effect on any other section. That is the same shape as `module[].is_enabled`.

The second reason is the honest empty state. `docs/frontend.md` promises *"the `chart` module is enabled and the shell has no view for it yet"* as a rendered sentence. This design system already has a place to put that — a plain white card with one muted line, no illustration, no call to action — because it uses that pattern for **No notifications**.

## The rule that produces the "clean"

**The chrome is achromatic. Grey ground, white cards, near-black text, one blue.** Colour enters only through product logos, illustrations, and status words. There is not a single coloured card header, tinted section background, or gradient in the whole dashboard except one hero banner.

Blue is spent on exactly three things: the app bar, links, and primary buttons. Nothing else is blue. If a fourth use appears, the design has drifted.

## Frame

```
┌──────────────────────────────────────────────────────────┐
│ ⠿  Product name                            ?      (avat) │  app bar, solid blue, 48px
├──────────────┬───────────────────────────────────────────┤
│ (avat) Name  │  Page title            ○ Action  ○ Action │  title row: actions sit RIGHT
│  email       │                                           │
│  Blue link   │  ┌─────────────────────────────────────┐  │
│              │  │ ▣ Section    description         ⌃ │  │  card, white on grey
│ ⌂ Account    │  ├─────────────────────────────────────┤  │
│ ⊙ Your info  │  │  content                            │  │
│▐▢ Selected   │  ├─────────────────────────────────────┤  │
│ ▤ Section    │  │ Related   link   link               │  │  footer strip, every card
│              │  └─────────────────────────────────────┘  │
└──────────────┴───────────────────────────────────────────┘
```

**App bar.** Solid blue, full-bleed, fixed, 48px. Left: a 3×3 dot waffle (app launcher), then the product name at 20px semibold white. Right: a `?` glyph, then a 32px circular avatar. Nothing else ever goes here. The bar does not scroll away and does not change colour per section.

**Ground.** `#F0F0F0` — a neutral warm grey, not white and not blue-tinted. Cards float on it. The rail sits on it transparently: **the navigation is not a panel**, has no border, no fill, and no divider against the content.

**Left rail.** ~280px. Identity block at top — 48px round avatar, name in semibold, email in muted, one blue link beneath. Then the nav list: 20px outline icon + label per row, ~44px tall, comfortable left padding.

The selected item is the only styled one: a **white pill card with a faint shadow, plus a 3px blue bar flush against the left edge**, label goes semibold, icon turns blue. Unselected items have no fill and no border at all. That single-selected-chip treatment is most of why the rail looks calm.

**Icons are outline-only, one weight, never filled** — except the selected nav icon, which stays outline but turns blue. Colour and fill are reserved for product logos.

**Content column.** Max ~1200px. Page title at 32px semibold, and — this is a signature move — the page's quick actions sit **to the right of the title on the same row**, not below it. Each is a 40px pale-blue circle holding a small blue glyph, with a two-line label beside it: bold title, muted subtitle. *"Microsoft 365 has expired / Resubscribe"*.

## Card

The unit the whole dashboard is made of.

- White, radius **4px** (small — this is not a rounded-card design), a barely-there ambient shadow, **no border**.
- **Header row:** a 24px product icon (the only place colour appears), bold title, muted one-line description under it, and a chevron at far right. Cards are **collapsible accordions**, and the collapse state is real UI, not decoration.
- **Body:** either a *hero* — headline, one sentence, one button, flat illustration at the right — or a list of rows.
- **Footer:** a separated strip on a slightly greyer fill containing the muted word `Related` followed by two to four blue text links. Nearly every card ends this way. It is where "go deeper" lives, so the body never has to carry secondary links.
- Cards stack with ~16–24px of air between them and never sit side by side at full width. Three-across only for equal-weight promotional tiles.

## Row

Inside a card, the list primitive:

```
 ⊙  Browsing and search                            Activities: 11   ›
    Show me more relevant suggestions by using my history
```

Outline icon, bold label with muted sublabel stacked under it, right-aligned value in **bold**, then a lone chevron. Separated by 1px hairlines that run the full card width. No zebra striping, no cell borders, no table look.

## Type

The typeface is load-bearing — a large part of "it looks like Microsoft" is the face, and swapping it for Inter loses most of the effect. Fluent 2 web's `fontFamilyBase`, used verbatim:

```
'Segoe UI', 'Segoe UI Web (West European)', -apple-system,
BlinkMacSystemFont, Roboto, 'Helvetica Neue', sans-serif
```

The named ramp from `global/typographyStyles.ts`, and what each is used for here:

| Style | Size / line | Weight | Used for |
|---|---|---|---|
| `title1` | 32 / 40 | 600 | page title, the statement figure |
| `title3` | 24 / 32 | 600 | page title at narrow width |
| `subtitle1` | 20 / 28 | 600 | app-bar product name, the gate verdict |
| `subtitle2` | 16 / 22 | 600 | card title, rail identity |
| `body1Strong` | 14 / 20 | 600 | row label, button, field label |
| `body1` | 14 / 20 | 400 | body, nav item |
| `caption1` | 12 / 16 | 400 | sublabel, the overdue marker |

Titles are **semibold, never 700**. Nothing on the page is black-weight. Note there is no 14px-at-16 style — 16px is `body2`/`subtitle2`, and Fluent's `subtitle1` line-height is **28**, not the 26 the design site publishes; the shipping token wins.

## Status is a word, not a chip

Unusual and worth copying deliberately: order status renders as **coloured bold text with no background and no badge** — `Payment failed` in dark red, `Completed` in dark green, sitting bare in the row. There are no status pills anywhere in this dashboard.

`.pill` was an amber-filled chip; it is now bold coloured text. The class name survives because `test/render.test.ts` asserts on it — a rename would be churn in the tested layer to serve a styling change, which is the wrong way round.

## Alert

A full-width strip **inside** the card it concerns, never floating: 1px border, a very pale tint of the same hue, a glyph at left, one sentence, and — where an action exists — one inline blue link.

| | Border / glyph | Fill |
|---|---|---|
| Warning | amber, `⚠` triangle | pale peach |
| Error | red, `✕` in a filled circle | pale pink |

The refusal sentences `docs/frontend.md` cares about — the oversell refusal, the booking 409 — render here. `.notice` and `.error-box` already exist in the stylesheet with the right instinct (*"a contested slot is news, not a failure"*) and need only the tint and the glyph.

## Button

Medium is the only size used: **`5px 12px` padding, `96px` min-width, `4px` radius, `body1Strong` (14/20/600), 1px border.** Height is not declared — it falls out of padding + line-height + border, at 32px.

| | Fill | Border | Text |
|---|---|---|---|
| Primary | `#0f6cbd` → hover `#115ea3` → pressed `#0c3b5e` | transparent | `#ffffff` |
| Secondary | `#ffffff` → hover `#f5f5f5` | `#d1d1d1` → hover `#c7c7c7` | `#242424` |
| Tertiary | transparent | transparent | `#115ea3` |
| Destructive | `#ffffff` → hover `#fdf3f4` | `#d1d1d1` → hover `#eeacb2` | `#b10e1c` |
| Disabled | `#f0f0f0` | `#f0f0f0` | `#bdbdbd` |

Buttons are near-rectangular. Never pills. Destructive is cranberry and never brand — *Update payment* on an expiring subscription is a red button, and that is the one place the brand rule yields.

In this codebase `.small` is the class name for the **secondary appearance**, not for a smaller size — it keeps medium metrics and changes only fill and stroke. A screen with six primary buttons has no primary button.

## Dialog and form

White sheet ~640px wide on a dimmed scrim, small radius, a real drop shadow. Title at 24 semibold left, `✕` at right.

Fields stack full width, label above, **required marked with a red asterisk after the label**. Text inputs use a **grey fill with a bottom border that darkens to blue on focus** — the Fluent underline input, not a fully outlined box. Selects carry a chevron and are otherwise unstyled.

Actions sit bottom-right, **primary first**: `Save` `Cancel`, `Submit` `Cancel`. Primary is to the left of secondary, which is the reverse of the macOS convention — follow the reference.

## Smaller patterns worth taking

- **Tabs** are text-only with a short blue underline under the active one. No boxes, no fills.
- **Meter**: a full-width thin rounded track, then a legend below of coloured dots with a right-aligned value per line. The headline number renders large and light (`< 0.1GB` at ~40px) with the denominator small beside it.
- **Empty state**: a plain white card with one muted line. *No notifications.* No illustration, no button.
- **Illustrations** are flat, no outlines, five colours at most (cornflower blue, mustard, grey, one skin tone), and only ever decorative at the right end of a hero. They never carry information.
- **Feedback** is a persistent blue pill anchored bottom-right above everything.
- **Footer** is one hairline row: a globe glyph and language, a few muted links, copyright right-aligned.

## Responsive

Three widths, and the middle one is the interesting one.

- **Wide** — rail and content side by side as drawn above.
- **Medium** — the rail collapses to **icons only**, still on the transparent ground, and the selected item keeps its white pill and blue bar. Labels are gone; icons are not.
- **Narrow** — the rail becomes a horizontal scrolling strip above the content, and the selected indicator moves from Fluent's Nav treatment to its **Tab** treatment: 3px tall, inset 12px from each end, circular. The app bar is unchanged at every width: waffle, title, help, avatar.

  *This is not what this document originally specified.* It said a hamburger slides the same nav over as a sheet. Nothing in `web/` owns an overlay, and adding one would put state in the layer that is explicitly not allowed to hold any — so the strip is what shipped, and this paragraph now describes the build rather than the intention. A sheet is still the better answer the day a framework arrives.

Cards go full-bleed and their internal two-column layouts stack. The hero illustration drops out before the headline does.

## Where the reference and Fluent 2 disagree

The screenshots are the Microsoft **account dashboard**, which is a Microsoft property but not a Fluent 2 reference implementation — it predates the current tokens in places. Checking the build against the published spec turned up four real conflicts. In each, the layout follows the dashboard and the *values* follow Fluent 2, because the layout is what was actually admired and the tokens are what can be checked.

| | The dashboard does | Fluent 2 says | Shipped |
|---|---|---|---|
| **Brand blue** | a lighter bar, around `#2564cf` | `colorBrandBackground` `#0f6cbd` | **Fluent.** The dashboard's blue is not in the `brandWeb` ramp at all. |
| **Text input** | grey fill, bottom border only | `outline` appearance: white fill, full 1px border **plus** a heavier `StrokeAccessible` bottom | **Fluent.** White with the heavy bottom edge. |
| **Selected nav** | a white pill with a full-height bar down the left | Nav's indicator is a 4×20 circular bar — the "french fry" — centred, with the label going to `body1Strong` | **Both.** The pill is kept, the bar is the french fry. Looking again at the reference, its bar *is* short and centred — the full-height rule was my misreading, not the dashboard's. |
| **Status** | a bare coloured word, no chip | `MessageBar` for banners; `Badge` for chips | **The dashboard**, for inline status. Banners follow `MessageBar`. |

One Fluent rule the dashboard breaks and this build breaks with it: *"avoid using brand colors on large surfaces."* A solid brand app bar is a large brand surface. It is the single exception, it is the thing that makes the frame recognisable, and nothing else on the page is permitted to join it.

Two Fluent rules that are **not** optional and are now honoured:

- **The focus ring.** Fluent draws focus as a 2px ring and components set `outline-style: none` only because they redraw it. The first draft of this stylesheet cleared `outline` on inputs and drew nothing back — a real accessibility defect, now a 2px `#000` `:focus-visible` ring.
- **Reduced motion.** Every animated Fluent component wraps its transition in a `prefers-reduced-motion` guard. The spec treats this as mandatory.

Also worth knowing, since it looks like a bug and is one: Fluent's `Input` source assigns a cubic-bezier to `transition-delay`. Do not copy it.

## Two decisions this reference forces

**No dark mode.** The account dashboard has none, and this system leans on a grey ground under white cards — a palette that does not invert cleanly, because in the dark the card must become *lighter* than the ground while the shadow that separates them stops working. The old stylesheet shipped a `prefers-color-scheme: dark` block that swapped seven variables; it has been deleted. Fluent publishes `webDarkTheme` as a separately designed palette, and that — not an inversion — is what dark mode would mean here. Absent beats half-done.

**Brand accent is not the app bar.** `shell.config.json` carries `brand.accent` — the clinic sets `#6d3f8f`. Painting the app bar with it turns a purple product into a purple wash and loses the neutrality that makes this design absorb any composition. The accent belongs on the primary button, the link colour, the selected nav bar, and the app bar; it does **not** get a second, third, or fourth use, and the rest of the interface stays achromatic regardless of what the tenant picked. That constraint is the design system — a tenant choosing an accent should change four things and nothing else.

## Tokens

Not eyeballed off the screenshots. Every value below is resolved from `@fluentui/tokens` `webLightTheme` with the `brandWeb` ramp, and the live stylesheet was checked against the computed values in a browser.

| | Value | Fluent token |
|---|---|---|
| ground | `#f0f0f0` | `colorNeutralBackground4` ¹ |
| card | `#ffffff` | `colorNeutralBackground1` |
| card hover / row hover | `#f5f5f5` | `colorNeutralBackground1Hover` |
| divider | `#e0e0e0` | `colorNeutralStroke2` |
| control border | `#d1d1d1` | `colorNeutralStroke1` |
| input bottom border | `#616161` | `colorNeutralStrokeAccessible` |
| text | `#242424` | `colorNeutralForeground1` |
| muted text | `#616161` | `colorNeutralForeground3` |
| brand | `#0f6cbd` | `colorBrandBackground` (brand **80**) |
| brand hover / pressed | `#115ea3` / `#0c3b5e` | brand 70 / **40** ² |
| link | `#115ea3` | `colorBrandForegroundLink` (brand 70) |
| danger | `#b10e1c` on `#fdf3f4`, stroke `#eeacb2` | Status**Danger** — cranberry ³ |
| warning | `#bc4b09` on `#fff9f5`, stroke `#fdcfb4` | StatusWarning — orange ⁴ |
| success | `#0e700e` on `#f1faf1`, stroke `#9fd89f` | StatusSuccess — green |
| focus ring | `2px #000000` | `colorStrokeFocus2` |
| radius | `4px` (dialog `8px`) | `borderRadiusMedium` / `XLarge` |
| card shadow | `0 0 2px rgb(0 0 0/.12), 0 2px 4px rgb(0 0 0/.14)` | `shadow4` ⁵ |
| spacing | 2 · 4 · 8 · 10 · 12 · 16 · 20 · 24 · 32 | `spacing*` ramp |
| motion | 100ms / 200ms, `cubic-bezier(.33,0,.67,1)` | `durationFaster` / `Normal`, `curveEasyEase` |

¹ Fluent publishes **no page-canvas token** — `FluentProvider` paints white. A grey ground is an app choice; `#f0f0f0` is a real neutral from the ramp rather than an invention.
² Pressed jumps to shade **40**, not 60. Easy to get wrong.
³ Fluent's `danger` is **cranberry** (`#c50f1f`), not red (`#d13438`). Red is the family `Badge` uses. They are different.
⁴ Warning foreground is an explicit shade20 override, not the generic rule.
⁵ `Card` uses `shadow4` — hover `shadow8`, dialog `shadow64`. Fluent's own `Card` padding is 12px; the full-width dashboard card here uses 20/24, which is the reference's density and a deliberate departure.

**A trap for anyone editing this.** The hex comments inside fluentui's `alias/lightColor.ts` are stale — they show the legacy Office ramp (`#0078d4`, `#106ebe`). The file is a function over `BrandVariants`, and `webLightTheme` passes `brandWeb`. If `#0078d4` ever appears in the stylesheet, it came from those comments and is wrong.

## Where this lands in the code

Nothing in `src/` changes. `src/` returns node trees and never learns what renders them, which is the property that makes this a styling job rather than a rewrite.

| | |
|---|---|
| `web/shell.css` | Rewritten against this document. It is the only file that has to change to adopt the look. |
| `web/index.html` | Gains the app-bar and rail scaffolding if the frame is static; otherwise nothing. |
| `src/render.ts` | Class names only, and only where a pattern above has no existing class — the alert glyph, the card footer strip, the selected nav chip. |
| `shell.config.json` | `brand.accent` gains the four-use rule stated above. |

The reference screenshots this was read from are the Microsoft account dashboard as of August 2026, captured across Account, Your info, Subscriptions, Devices, Privacy, Order history, Payment options, and Address book, at three widths.
