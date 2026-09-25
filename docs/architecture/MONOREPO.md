# Bookmops monorepo

How the codebase is laid out, why, and the order it is being built in.

Decided with Prem on 2026-09-25. This document is the plan of record: when the
code and this page disagree, one of them is wrong and gets fixed.

---

## What we ship

| Product | Who uses it | Lives in | Builds |
|---|---|---|---|
| **Bookmops web** | Everyone: marketing site, online booking, customer portal, admin console, cleaner portal, platform console | `apps/web` | Vercel |
| **Bookmops Pro** | Cleaners (`EMPLOYEE`, `FIELD_LEAD`), managers (`OPS_MANAGER`), admins (`OWNER`, `ADMIN`) | `apps/staff` | iOS + Android, bundle `com.bookmops.pro` |
| **Bookmops** | Customers (`CLIENT`) | `apps/customer` | iOS + Android, bundle `com.bookmops.app` |

That is four store listings from two mobile codebases. Expo builds each codebase
for both platforms.

One listing per app serves every company. The company is resolved from the
user's email at sign-in. Per-company white-label apps are not an option under
Apple Guideline 4.2.2.

Bookmops Pro is one app for three roles, and the role decides the screens.
Admins and managers get a focused mobile subset: today's jobs, assign and
reassign, approve time, chat, alerts. The full console (settings, finances,
reports) stays on the web.

---

## Layout

```
apps/
  web/                 Next.js 16 — the existing product, moved here unchanged
  staff/               Expo — Bookmops Pro
  customer/            Expo — Bookmops
packages/
  core/                domain logic: pricing, pay, job rules, validation, types
  api/                 the versioned HTTP contract (v1) and its typed client
  ui-native/           React Native components and the Pier design tokens
  db/                  Prisma schema, migrations, and client — server only
  typescript-config/   shared tsconfig bases (library, nextjs, react-native)
  eslint-config/       shared ESLint flat configs (base, next, expo)
docs/                  documentation for the whole repo
```

Every package is named `@bookmops/<folder>`. The root package is `bookmops`.

### Who may depend on whom

```
apps/web ──────┬──> packages/api ──> packages/core
               ├──> packages/core
               └──> packages/db ───> packages/core (types only)

apps/staff ────┬──> packages/api ──> packages/core
apps/customer ─┼──> packages/core
               └──> packages/ui-native ──> packages/core
```

These rules are what keep the split worth having:

- **`core` is pure TypeScript.** It must not use Node built-ins, React, Next,
  Prisma, or `fetch`, and must not read environment variables. Pricing, pay,
  and validation run the same way in a browser, on a phone with no signal, and
  on the server. That is why they live here.
- **`db` never reaches a phone.** It imports `server-only`. The mobile apps get
  data only through `api`.
- **`api` is versioned.** An app that passed store review keeps calling `v1`
  after the server moves on. Breaking changes go into `v2`, and `v1` keeps
  running until installs have updated. We can't roll back a build that's
  already on someone's phone, so this rule isn't negotiable.
- **Apps never import from each other.** Anything two apps share is a package.

---

## Tooling decisions

| Decision | Choice | Why |
|---|---|---|
| Package manager | **npm workspaces** (kept) | Expo supports it officially, and its hoisted layout is the one Metro handles most easily. Switching to pnpm would mean a new lockfile and a different Vercel install for no gain at this size. We can revisit if install time starts to hurt. |
| Task runner | **Turborepo**, added in phase 2 | It only pays off once there are several packages to order and cache. Plain `npm -w` is enough for phase 1. |
| Internal packages | **Just-in-time TypeScript**: `exports` points at `src/*.ts` | No build step and no `dist/` to go stale. Next compiles them via `transpilePackages`, and Metro reads them directly. |
| Mobile | **Expo SDK 57** (React Native 0.86.3), expo-router, EAS Build per app | Current stable SDK. `eas.json` lives in each app. |
| React | **One version repo-wide: 19.2.3**, pinned with root `overrides` | Expo SDK 57 pins it. Two React copies in one workspace cause invalid-hook errors in anything shared. Web moves up from 19.1.0 as its own change, before the first Expo app lands. |
| Prisma | **6.x, unchanged** | Migrations run against production. Upgrading the ORM is its own project, not part of a folder move. |
| Node | 22.13 or newer | Required by Expo SDK 57. |

---

## Phases

Each phase ends in a working, verified state and can ship on its own.

### Phase 1 — Move the web app into `apps/web`  *(this branch)*

No behaviour change. The same routes, the same build, and the same test results.

- `src/`, `public/`, `prisma/`, `scripts/`, `_bt/`, and the Next, TypeScript,
  PostCSS, ESLint, and Vercel configs move into `apps/web/` with `git mv`, so
  history follows the files.
- The root becomes a workspace: `package.json` named `bookmops`, with
  `workspaces`, one lockfile, and scripts that delegate to `@bookmops/web`.
- Fixes for everything that assumed the repo root was the app root:
  - root-anchored `.gitignore` entries
  - the verify runner's hard-coded `node_modules/tsx` path
  - scripts that read `docs/`
  - explicit `turbopack.root` and `outputFileTracingRoot`, so the Prisma engine
    in the hoisted `node_modules` is still traced into the server bundles

**Done when all of these hold:**
- `tsc` is clean.
- `next build` succeeds with an identical route table.
- The Prisma engine is traced into the server bundles.
- `npm run verify` gives the same per-script tallies as before the move.

### Phase 2 — Shared foundations

- Turborepo.
- `@bookmops/typescript-config` and `@bookmops/eslint-config`.
- `packages/db`: Prisma moves out of `apps/web`.
- `packages/core`: pricing, pay, job rules, validation, and types move out of
  `apps/web/src/lib`, one domain at a time, each with its own verify run.
- React 19.2.3 across the repo.

### Phase 3 — API v1

- An org-scoped, versioned HTTP API in `apps/web`, with its contract and typed
  client in `packages/api`.
- Mobile sign-in (token-based; the web keeps its cookie session).
- Built tenant by tenant, with the same row-level-security guarantees as the
  web.
- This is the largest phase: about 294 files call server actions directly
  today, and a phone cannot.

### Phase 4 — Bookmops Pro (`apps/staff`)

- Cleaner screens first, from the design canvas: the 17 cleaner screens,
  offline clock-in, and push notifications.
- Then the manager and admin subset.

### Phase 5 — Bookmops (`apps/customer`)

- The 12 customer screens from the design canvas.

---

## Working in the repo

Run commands from the **repository root**. They delegate to the right workspace:

```bash
npm install          # one install for every app and package
npm run dev          # the web app on :3000
npm run build        # production build of the web app
npm run typecheck
npm run verify       # the code-only regression sweep
```

Commands that belong to one app run in that app's folder, or with
`-w @bookmops/web`. Every script in `apps/web/scripts/` assumes the working
directory is `apps/web`, because the verify scripts read `src/…` and `prisma/…`
relative to it.

### Environment files

`.env*` files belong to the app that reads them. The web app's live in
`apps/web/`, next to `next.config.ts`. They are git-ignored and were never
committed, so moving an existing checkout onto this layout needs one manual
step:

```bash
mv .env .env.local .env.development.local .env.production.local .env.e2e apps/web/
mv data apps/web/    # local CSV exports used by a couple of import scripts
```

### Older docs

Documents written before the move refer to paths like `src/lib/pricing.ts`.
Read those as `apps/web/src/lib/pricing.ts`. They are records of what was done
at the time, so they are not rewritten.

---

## Deploying after the move (Vercel)

Do these on the `cleano-software` project **at the same moment the branch
reaches `main`**. A build of the new layout under the old settings fails, and
production keeps serving the previous deployment until the next good one.

1. **Settings → Build and Deployment → Root Directory:** set it to `apps/web`.
2. **Include files outside the Root Directory in the Build Step:** turn it on.
   It's on by default for projects of this age, but check.
3. Leave Install and Build commands on their defaults. Vercel finds the root
   lockfile and installs the whole workspace.
4. Nothing to do for environment variables. They belong to the project, not
   to a folder.
5. `vercel.json` (the five crons) now lives in `apps/web/`, which is where
   Vercel reads it once Root Directory is set. After the first deploy, check
   **Settings → Cron Jobs** still lists all five.
