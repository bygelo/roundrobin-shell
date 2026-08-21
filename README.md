# roundrobin shell

A discovery-driven operator UI for [roundrobin OS](https://github.com/bygelo/roundrobin). It renders what the server says is on.

Designed in [`docs/frontend.md`](https://github.com/bygelo/roundrobin/blob/main/docs/frontend.md) in the OS repo. Sign-in, discovery, and navigation work. **All nine pack views are drawn.** F&B and court stand up from the same build (`COMPOSITION=fnb` / `COMPOSITION=court`).

**It is styled.** [`docs/design.md`](docs/design.md) reads the Microsoft account dashboard's layout and Fluent 2's published tokens, and `web/shell.css` implements it — every colour, radius, shadow and type value resolved from `@fluentui/tokens` `webLightTheme` rather than eyeballed, and checked against the computed values in a browser. Nothing in `src/` was touched to do it, which is the property that made it a styling job rather than a rewrite.

## The one idea

**The shell hardcodes how to render a pack. Discovery decides which packs render, and what this session may do inside them.**

```
                    discovered at runtime          hardcoded here
which modules exist    GET /api/v1/capability            —
which nav appears      module[].is_enabled               —
which buttons appear   capability[]                      —
what a calendar is             —                    view/booking/   (phase 2)
what a tenant calls a resource shell.config.json           —
```

A module earns a nav entry when three things are true, and all three come from the server rather than from a build:

1. the tenant has it enabled,
2. this session holds its read capability,
3. this shell has a view registered for it.

Failing (1) or (2) is **silence**, deliberately. The OS returns 404 rather than 403 for a disabled module so an outsider cannot learn which modules a tenant runs; a greyed-out "Billing" would hand back exactly what that 404 withholds. Failing (3) is **reported**, because it is a gap in this repo and not a fact about the tenant.

## Relationship to the OS

This repo is a **sibling**, not a port and not a pack. It talks HTTP like any other consumer, has no database handle and no kernel privilege, and if it disappeared tomorrow every pack would still work. The OS roadmap's refusal — *"A UI framework — apps own interface"* — stands unchanged.

**A pack change made because of the shell is a finding, not a feature.** It goes through the OS's own process before it goes into a pack. That already happened once: building the client turned up that the OS had no sign-in route at all — `signIn` was a library call taking a `TenantContext`, so every consumer to date had been a test running in-process and nothing outside the process could authenticate. `POST /api/v1/session` was added to the kernel, not worked around here.

## What is built

| | |
|---|---|
| `src/navigation.ts` | The whole idea, and pure. Capability payload → navigation. No fetch, no DOM. |
| `src/discovery.ts` | The only place this repo talks to an OS. Sign-in, capability, authenticated GET. |
| `src/vocabulary.ts` | Kernel noun → the app's word, so a clinic reads "chair" where the pack says "resource". |
| `src/view/booking.ts` | The booking view. Board grouping, hold countdown, what an operator may do. |
| `src/view/billing.ts` | The billing view. Exact centavo summing, overdue, who may clear the queue. |
| `src/view/gate.ts` | Membership and access. Pass usability, and the deny vocabulary a guard reads. |
| `src/render-gate.ts` | The gate story’s node trees, split out as `render.ts` grew. |
| `src/view/library.ts` | Form and document. Instance answerability, byte counts, version order. |
| `src/render-library.ts` | The library’s node trees. |
| `src/view/counter.ts` | Notification and commerce. Outbox status wording, exact counter totals. |
| `src/render-counter.ts` | The counter’s node trees. |
| `src/view/scan.ts` | The scan view. Code usability, and the outcome vocabulary — where a cancelled code must not read as a forgery, and a replay must not read as a second scan. |
| `src/render-scan.ts` | The scan screen’s node trees. |
| `src/view/failure.ts` | A refusal turned into a sentence a person can act on. |
| `src/render.ts` | Every node tree the page draws. Takes an `element` factory, returns nodes, touches no global. |
| `src/dom.ts` | The one DOM primitive the browser layer is built on, so it can be tested. |
| `web/` | A no-framework browser layer. See below. |
| `dev/composition.ts` | F&B and court as named apps. `COMPOSITION=fnb` / `court` / `all`. |
| `dev/` | A harness: one app with all nine packs by default, a seeder, and a static server. |

**No framework yet, and that is a staging decision rather than a principle.** Everything worth arguing about — including every node tree — lives in `src/`, is pure, and is tested headlessly. What remains in `web/` is the part that genuinely needs a browser: the document, session storage, the fetch origin, and the wiring between a click and a call. If something there looks worth testing, it is in the wrong file. Somewhere in the next seven views the hand-rolled `element()` stops paying for itself — the signal will be `web/shell.js` growing state that `src/` does not own. Adopting a framework then changes nothing in `src/`, because `src/` never learns what is rendering it.

## Run it

Requires Node 24+, PostgreSQL 16+, and a checkout of the OS beside this one — `package.json` points at `../roundrobin/package/*` so no registry token is needed for development.

**Kernel 0.14.0 or newer.** K83 made the store port an interface: `Store` is now the structural intersection of every driver — `{ kind, close }` — and `end()` is `PostgresStore` surface. This shell tears down through `close()`, so it will not typecheck against 0.13.x.

**Two roles, not one.** The kernel refuses to serve as a PostgreSQL superuser, because superusers are exempt from row-level security and every tenant policy would silently stop applying. Migrations and the seed are the exception — they are the migration runner, and they need the elevated role. So the two commands take different URLs, and using one URL for both fails at the first page load with that refusal, not at startup.

```powershell
npm install

# migration + seed run as the elevated role
$env:DATABASE_URL = 'postgres://postgres@localhost:5432/roundrobin_dev'
cd ..\roundrobin ; npm run db:migrate ; cd ..\roundrobin-shell
npm run dev:seed      # one tenant, every module on, one operator

# the server runs as an ordinary role, so RLS actually applies
# createuser shell_app  +  grant it the schema, once
$env:DATABASE_URL = 'postgres://shell_app@localhost:5432/roundrobin_dev'
npm run dev           # http://localhost:8788
```

Sign in with `shell-dev` / `operator` / `correct-horse`.

The same build, two compositions, no file edited between them:

```powershell
$env:COMPOSITION = 'fnb';   npm run dev:seed; npm run dev   # café — take an order
$env:COMPOSITION = 'court'; npm run dev:seed; npm run dev   # venue — take a booking
```

Sign in with `shell-fnb` / `operator` / `correct-horse` or `shell-court` / `operator` / `correct-horse`.

### Configuration

Every environment variable this repo reads. All four are read by `dev/` only — `src/` reads none, because it takes its origin from the caller and never learns where it is running.

| | | |
|---|---|---|
| `DATABASE_URL` | *required* | The OS's PostgreSQL. `dev/seed.ts` and `dev/server.ts` refuse to start without it rather than guessing a database, and `npm test` / `npm run gate` refuse to run without it — see *Verify*. |
| `PORT` | `8788` | Port `npm run dev` binds. |
| `SEED_ORGANIZATION_CODE` | `shell-dev` | Tenant code `npm run dev:seed` creates. Seeding is idempotent by this code, so a second run is neither an error nor a duplicate. Defaults to `shell-fnb` / `shell-court` when `COMPOSITION` is set. |
| `COMPOSITION` | `all` | Which app `dev:seed` and `dev` stand up. `all` is the nine-pack harness. `fnb` and `court` are the two compositions K36 names — same shell build, no file edited between them. |

### See discovery work

Turn a module off in the database and reload. Nothing is rebuilt and nothing is redeployed:

```sql
UPDATE organization_module SET is_enabled = false
WHERE organization_id = (SELECT organization_id FROM organization WHERE organization_code = 'shell-dev')
  AND module_id = (SELECT module_id FROM module WHERE module_code = 'billing');
```

The Billing entry disappears, and `/api/v1/invoice` starts returning 404 — the nav and the API agree, which is what makes hiding it honest rather than cosmetic.

## Verify

```powershell
$env:DATABASE_URL = 'postgres://postgres@localhost:5432/roundrobin_dev'
npm run gate     # typecheck + build:web + check:web + preflight:db + test
```

The gate **binds a database**. `script/preflight-db.mjs` runs before the suite and exits 1 with a `fix:` line when `DATABASE_URL` is unset, unreachable, or points at a database with no migration applied — so a green gate can never again hide a skipped live test. No PostgreSQL? `npm run test:unit` runs the DB-free tier (176 test) with no setup. `npm run test:live` runs only the live tier (32 test) against the database.

`test/discovery-live.test.ts` and `test/booking-live.test.ts` are the phase-1 and phase-2 exit conditions, executed: a real PostgreSQL, the real kernel app with all nine packs, the real sign-in route, the real client, and the real derivation. The OS app's own `request` stands in for the socket, which exercises routing and middleware without binding a port. They still skip without `DATABASE_URL` when invoked through `node --test` directly — but every npm path that includes them refuses to run without one, and they must run in CI.

The booking one contests a slot for real, because four layers have to behave for that sentence to reach a person: the pack raises a conflict, the database refuses the overlap, the kernel maps SQLSTATE to 409 rather than 500, and the client preserves both status and message. A unit test of the mapping alone would prove none of that.

Current: **208 test, 208 pass** with `DATABASE_URL` set — 176 unit + 32 live. Without it the gate is **red at preflight**, not green on 176.

Why the gate refuses rather than skips: a skipped suite is not merely indistinguishable from a pass, it is *uncounted* — the summary once read "172 pass, 0 skipped" while 25 live tests ran nowhere. That was [K67](https://github.com/bygelo/roundrobin/blob/main/ROADMAP.md): `scan` went undrawn on every real tenant while this gate stayed green, because the two live tests that said so were never run. A gate that silently skips its only real-composition tests manufactures confidence, which is worse than no gate.

## Honest state

- **All nine pack views are drawn**, each walked against a running server. Writes from a screen: booking holds/confirms/cancels, billing approves a proof, the gate console presents a code, and the counter now places a POS order. Creating an invoice, enrolling a credential, or building a form template still means calling the API directly.
- **Two compositions stand up from one build.** `COMPOSITION=fnb` installs commerce + billing + notification and takes a POS order; `COMPOSITION=court` installs booking + billing + membership + commerce + notification and takes a booking. No kernel, pack, or shell file is edited between them. Proven in `test/composition-live.test.ts`.
- **The OS could not back a list screen.** No pack exposed a collection read; every `GET` was a lookup by a code the caller had to already know. Eight reads have now been added to the OS for these views — two for billing, four for membership, two for access. **That gap is now closed** — all eight packs list (K38). Three of those projections are security boundaries rather than conveniences: `listCredential` omits `token_hash`, `listDocument` omits content, and `listDelivery` carries the recipient mask and never the recipient.
- **A guard never reads a machine code off a door.** `readDeny` maps every `deny_reason_code` the pack emits to a sentence and a next move — `trip_limit` becomes "No trips left — issue a new one if that is right". An unmapped code shows the raw value and says the shell has no wording for it, because inventing a reason a guard then acts on is worse than admitting the gap.
- **The rendering is now tested; a real browser still is not.** The trees moved out of `web/shell.js` into `src/render.ts`, so `test/render.test.ts` drives *the same code the page runs* against a stub document — a lapsed hold offering no Confirm button, a read-only session getting no action buttons at all, a 409 painted as news rather than as an error. `web/shell.js` is now bootstrap only: document, storage, fetch origin, and the wiring between a click and a call. What remains unverified is layout and CSS, and that is not free: `view/scan` shipped three section blocks that fell straight through a stylesheet selector and rendered bare on the ground, with every test green. Opening the page is still the only thing that catches it.
- **`npm run check:web` guards the module boundary.** Rename an export in `src/` and forget to rebuild, and the page dies at runtime with a blank screen while every unit test stays green. The check is red-green proven.
- **`dev/` defaults to all nine packs**, which no real buyer would. It exists so the shell has something wide to discover. `COMPOSITION=fnb` and `COMPOSITION=court` are the named compositions from `docs/use-case.md` in the OS repo.
- **`shell.config.json` is inlined** in `web/shell.js` rather than fetched. It becomes a real file when a second app uses this.
- **The risk this repo carries:** pack knowledge now lives in two places. `contract/*.json` in the OS makes a drift a build failure rather than a surprise, and that is the mitigation — but it is a real ongoing cost, and it is why this is a separate repo with its own gate.
