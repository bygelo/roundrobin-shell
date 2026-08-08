# roundrobbin shell

A discovery-driven operator UI for [roundrobbin OS](https://github.com/bygelo/roundrobbin). It renders what the server says is on.

Designed in [`docs/frontend.md`](https://github.com/bygelo/roundrobbin/blob/main/docs/frontend.md) in the OS repo. **Phase 1 only** — sign-in, discovery, and navigation. The pack screens land in phase 2.

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
| `web/` | A no-framework browser layer. See below. |
| `dev/` | A harness: one app with all nine packs, a seeder, and a static server. |

**No framework, and that is a phase-1 decision rather than a principle.** Everything worth arguing about lives in `src/`, is pure, and is tested headlessly. What remains in `web/` is turning that into DOM. Phase 2 draws nine pack views with forms, tables, and a calendar — that is where a framework earns its keep, and adopting one then changes nothing in `src/`, because `src/` never learns what is rendering it.

## Run it

Requires Node 24+, PostgreSQL 16+, and a checkout of the OS beside this one — `package.json` points at `../roundrobbin/package/*` so no registry token is needed for development.

```powershell
npm install
$env:DATABASE_URL = 'postgres://postgres@localhost:5432/roundrobbin_dev'

# apply the OS migrations first, from the OS checkout
cd ..\roundrobbin ; npm run db:migrate ; cd ..\roundrobbin-shell

npm run dev:seed      # one tenant, every module on, one operator
npm run dev           # http://localhost:8788
```

Sign in with `shell-dev` / `operator` / `correct-horse`.

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
$env:DATABASE_URL = 'postgres://postgres@localhost:5432/roundrobbin_dev'
npm run gate     # typecheck + build:web + test
```

`test/discovery-live.test.ts` is the phase-1 exit condition, executed: a real PostgreSQL, the real kernel app with all nine packs, the real sign-in route, the real client, and the real derivation. The OS app's own `request` stands in for the socket, which exercises routing and middleware without binding a port. It **skips without `DATABASE_URL`** and must run in CI.

Current: **22 test, 22 pass.**

## Honest state

- **Phase 1 only.** Selecting a pack says its screens land in phase 2. There is no calendar, no invoice list, no gate console yet.
- **The browser layer is verified by parse and by served content type, not by a rendering test.** The logic behind it is covered; the DOM assembly is not. A headless render check is worth adding before phase 2 adds nine views on top of it.
- **`dev/` installs all nine packs**, which no real buyer would. It exists so the shell has something wide to discover. Every real app is a named composition — see `docs/use-case.md` in the OS repo.
- **`shell.config.json` is inlined** in `web/shell.js` rather than fetched. It becomes a real file when a second app uses this.
- **The risk this repo carries:** pack knowledge now lives in two places. `contract/*.json` in the OS makes a drift a build failure rather than a surprise, and that is the mitigation — but it is a real ongoing cost, and it is why this is a separate repo with its own gate.
