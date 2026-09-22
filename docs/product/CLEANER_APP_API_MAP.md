# Cleaner app: API surface map

Written 2026-09-21, against the code as it stands today.

Purpose: decide whether the mobile split is a two week job or a three month one, using counted facts rather than an estimate. Every number below came from the repository, and the command that produced it is shown so it can be re-run.

## Why we are splitting at all

Two reasons, neither solvable by pointing a webview at the live site.

**Release cadence.** The web deploys in minutes. An app release takes days in review and then sits on phones for weeks. If the app is a window onto our server, a server change breaks an app that is already installed, with no rollback. A versioned API is what stops that.

**Offline.** Cleaners work in basements, stairwells and underground parking. Clock-in has to work with no signal and sync afterwards. Server-rendered pages cannot.

## The headline: the surface is far smaller than it looked

The scary number was 271 files containing `"use server"`. That number is real and it is also misleading, because almost none of it belongs to the cleaner app.

```
$ grep -rl "use server" src/app | wc -l              # 271  (whole app)
$ grep -rlE '"use server"' src/app/cleaners | wc -l  #   6  (cleaner-owned)
```

The cleaner app owns **6** action files and borrows **33** more from `src/app/admin/actions`. That is roughly **50 distinct operations**, not 271. The other ~230 are admin console, customer and platform console, and none of them need to move for the cleaner app to ship.

## Most of the logic is already portable

```
$ ls src/lib/*.ts | wc -l                                    # 175
$ grep -lE '\b(db|platformDb)\.[a-z]+\.(findMany|findUnique|…)' src/lib/*.ts | wc -l   # 68
```

**107 of 175 lib files contain no database query at all.** They are pure functions: predicates, formatters, validators, time and money maths. They move into `packages/core` unchanged and are then shared by web and mobile with one definition.

A caution on counting. An earlier pass flagged 77 files as database-bound by grepping for Prisma imports. That was wrong: `cleaner-jobs.ts` imports `import type { Prisma }` and issues **zero** queries. Count actual `db.*.<operation>` calls, not imports, or you will overstate the work by about 15%.

Of the 29 modules the cleaner screens use, **20 are pure**. The genuinely database-bound ones are only: `auth`, `org-db`, `job-assignments` (11 queries), `phone-masking` (10), `strikes` (5), `cleaner-earnings` (2), `cleaner-pay-display` (1), `email`, `settings`.

## The surface, grouped by screen

### Jobs and clock — the core, and the offline-critical part
`clockIn` · `clockOut` · `jobBreak` · `getJobChecklist` · `updateChecklistItem` · `generateJobChecklist` · `getJobPhotos` · `uploadJobPhoto` · `deleteJobPhoto` · `markOnMyWay` · `updateOnMyWayLocation` · `reportJobIssue` · `respondToJobInvite` · `cancelShift`

### Available jobs
`getAvailableJobPreview` · `claimJob`

### Pay
`getPayBreakdown` · `requestWithdrawal` · `generateProviderInvoice` · `approveProviderInvoice`

### Kit and inventory
`checkoutInventory` · `getCheckoutHistory` · `getLocationProducts` · `getLocationStock` · `updateMyInventoryCount` · `updateMyItemCondition` · `addMyInventoryItem` · `createInventoryRequest` · `reportDamagedItem` · `checkEquipmentForJob`

### Chat
15 functions in `cleaners/group-chat/groupChat.ts`, covering channels, membership, messages and read state.

### Auth
`signOut`, plus session establishment.

Reads not in this list are server components querying `lib` directly. Those become GET endpoints built from the same `where` builders in `cleaner-jobs.ts`, which are pure and already exist: `upcomingJobsWhere`, `claimableJobsWhere`, `calendarJobsWhere` and the rest.

## What must work offline

Only eight operations genuinely need a write queue. Everything else can fail honestly and ask the cleaner to retry.

`clockIn` · `clockOut` · `jobBreak` · `updateChecklistItem` · `uploadJobPhoto` · `markOnMyWay` · `updateOnMyWayLocation` · `reportJobIssue`

Each needs a client-generated id so a replayed request cannot double-write, and a client timestamp that the server trusts over its own arrival time. A clock-out recorded at 12:00 and synced at 12:40 must pay the cleaner for 12:00.

`claimJob` must **not** be queued. Two cleaners offline claiming the same job would both think they had it. It stays online-only and fails cleanly.

## Versioning

The API is versioned from the first endpoint, not later. An app build from six weeks ago has to keep working when the server moves. Rules: never remove or retype a field in a released version, add only optional fields, and put the version in the path.

## Tenant safety, which is the real risk

This API becomes a new front door to org-scoped data. Today that scoping is enforced by `org-db` and Postgres RLS inside server actions that only run on our own server. Exposing them over HTTP means every endpoint must re-derive the organization **from the session**, never from anything the client sends.

Build it endpoint by endpoint, and test each one by asking for another workspace's job id and confirming a 404. This is the part to go slowly on. Everything else is mechanical.

## Revised estimate

The earlier figure was 3 to 5 weeks, given before any of this was counted. Against the real surface:

| | |
|---|---|
| Port pure logic to `packages/core` | 2 to 3 days (107 files, mostly moves) |
| ~50 endpoints over the existing actions | 1.5 to 2 weeks |
| Offline queue for the 8 operations | 4 to 5 days |
| Tenant-isolation tests per endpoint | 3 to 4 days |

**Roughly 2.5 to 3.5 weeks for the cleaner app**, ahead of the earlier guess, because the cleaner surface turned out to be about a fifth of what the raw `"use server"` count suggested.

The customer app is a separate and larger piece: it carries booking, payments and Stripe, and should not be started until the cleaner app has proved the pattern in production.

## What this does not cover

Push notification delivery (APNs and FCM), the `DeviceToken` table, and store submission. Those are in the mobile build plan, not here.
