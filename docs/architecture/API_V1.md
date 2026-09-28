# API v1 — design

How Bookmops Pro and Bookmops (the mobile apps) talk to the server. This is
phase 3 of [MONOREPO.md](MONOREPO.md).

**Status: revision 2, reviewed.** The first draft was reviewed by the architect
and auth-hardening agents against the code. Their findings are folded in below,
and §11 lists what changed. Nothing is built yet. Items marked **Decision**
need Prem's answer before the part they govern is built.

---

## 1. What v1 must do

A phone can't call a Next.js server action. Everything the cleaner portal does
through actions today needs an HTTP endpoint the app can call. That endpoint has
to:

1. **Keep every tenant boundary the web app already has.** One company must
   never see another's data.
2. **Enforce the same rules as the web app,** through the same code, so the two
   paths can't drift.
3. **Keep working for installed builds.** A build that passed store review can
   live on a phone for months, and we can't roll it back. v1 only changes in
   ways old builds tolerate.
4. **Take clock-in and clock-out made without signal,** apply each exactly
   once, and never lose one. A lost tap is an unpaid cleaner. It must also not
   become a way to backdate a shift.

v1 starts with Bookmops Pro's cleaner screens. Manager, admin, and customer
endpoints are additions to v1 later, not breaking changes.

---

## 2. Signing in from a phone

### The principle: the phone talks to the company's own address

Each company lives at `<slug>.useawer.com`, and the host decides the tenant.
Four things follow from that:

- The session cookie is host-only.
- The session lookup (`customSession`, `lib/auth.ts`) reads the user through the
  host's organization. A session from another company therefore resolves to no
  session. This was traced through `db-scoped.ts` during review and holds.
- Row-level security scopes every query to that organization.
- **The apps use this model unchanged.** After sign-in the app sends every
  request to its company's address, so there is no second tenant path to get
  wrong.

### The flow

```
1. Email + password         → POST https://useawer.com/api/v1/auth/workspaces
                              ← [{ orgId, name, apiOrigin }]   (only where the password matches)
2. Pick a company            (automatic if there is one; a chooser if several)
3. Sign in at that company  → Better Auth sign-in at apiOrigin (Expo plugin)
                              ← session, kept in the device's secure storage
4. Every later call         → {apiOrigin}/api/v1/...
```

**Discovery** reuses the logic of `discoverWorkspaces`, with these changes:
- **No timing oracle.** When an email has no account, it runs a dummy
  password check against a fixed hash. It pads the number of checks, so the
  response time doesn't reveal whether the email exists or in how many
  companies. Today an unknown email answers in milliseconds.
- **Real rate limits.** Limits are per email **and** per IP, held in a shared
  store rather than per-instance memory, and backed by a Vercel WAF rule on
  discovery and every sign-in path. The per-IP limit is set with carrier NAT in
  mind: a whole crew on one mobile IP at shift start must not lock each other
  out.
- **Never returns the platform workspace.**
- **Returns `apiOrigin`,** always the canonical `<slug>.useawer.com`, even
  if a company later gets a custom domain. The app refuses to send credentials
  to any origin outside a built-in allow-list, and stores `orgId`, so a renamed
  slug is recovered by discovering again.

**Sign-in** is Better Auth's own, through `@better-auth/expo`:
- The session is stored with SecureStore at
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. It doesn't sync to iCloud and can't be read
  from a locked phone.
- The server adds Better Auth's `expo()` plugin. The apps' URL schemes are
  trusted **as an Origin only, never as a redirect target**: a password-reset
  or verification link carrying a token must not open a custom scheme that any
  installed app could claim. Anything that returns to the app uses Universal
  Links / App Links over https. CORS is never enabled on `/api/auth`.

**After sign-in,** `GET /api/v1/me` returns the person's role, the company's
name, timezone, and currency, and whether a password change is required:
- Bookmops Pro signs out a role outside its allow-list and says why.
- A required password change comes before anything else.

**Forgot password:** discovery needs the password, so the app can't know which
company to reset against. `POST /api/v1/auth/forgot-password` on the platform
host emails a reset link for each workspace the address belongs to, and always
answers 200.

**Switching company** means signing out and discovering again. Each company is a
separate account (`User` rows are per organization). Session storage and the
client are keyed by origin, so supporting several signed-in companies later is
additive.

### Sessions end when they should

- Sessions last 30 days and slide with use, as on the web. The Better Auth
  cookie cache stays off, so a revocation takes effect on the next request.
- **Deactivating or deleting a person deletes their sessions** in the same
  transaction as the flag change.
- **A password reset signs out every device** (`revokeSessionsOnPasswordReset`),
  and a password change signs out every other device.
- `customSession` treats an inactive or deleted user as no session. Every v1
  request also re-reads `isActive`, `deletedAt`, and `mustChangePassword` from
  the database, so revocation never rests on one mechanism.
- The app offers an optional biometric lock. Users and admins get "sign out all
  devices".

Today none of these revocations happen. See §10.

### Versions

`better-auth` moves from 1.4.5 to **1.4.22**, with `@better-auth/expo` pinned
to exactly the same version. 1.4.22 is the first release on the 1.4 line whose
expo plugin accepts Expo SDK 57's packages. It also fixes two rate-limiter
bypasses that affect production today, so it ships first, on its own.

---

## 3. The contract: `@bookmops/api`

One package shared by the server and both apps:

```
packages/api/
  src/v1/
    common.ts       error envelope, cursor pagination, openEnum(), shared types
    enums.ts        the v1 vocabularies, frozen (see below)
    me.ts, jobs.ts, clock.ts, …     request and response schemas per resource
    index.ts
  src/client.ts     a small typed fetch client
```

- **Schemas are zod 4.** The server validates every request. The app validates
  every response. In development and CI, the server also validates its own
  responses before sending them, so a contract break fails a test, not a phone.
- **v1 enums are frozen copies, not imports from core.** If v1 imported core's
  statuses, adding a status to core would silently change the v1 wire.
  Instead, `enums.ts` holds the values v1 was released with, and a CI check
  asserts core still contains every one of them.
- **Response enums are open.** zod's `z.enum` rejects unknown values, so an old
  build would reject a status added later. Every enum in a response goes through
  `openEnum()`, which keeps the value and marks it unknown, and the app
  shows a neutral fallback for it. Request enums stay closed.
- **Breaking changes are caught in CI.** JSON Schema is exported from the v1
  schemas and diffed against the released version. A removed field, a changed
  type, or a narrowed request fails the build.
- **Unknown fields in responses are ignored,** never rejected.

**Why plain handlers and zod rather than a framework:** tRPC's wire format is
tied to the server's code, with nothing stable to freeze as "v1". ts-rest has
stalled. Hono would add a second router inside Next, duplicating the auth and
tenant setup. Shared zod schemas add nothing to the phone's bundle. If the
hand-written client grows, oRPC's contract-first mode is the upgrade path,
because it keeps real REST paths.

### Rules for changing v1

**Always fine:**
- new endpoints;
- new response fields;
- new optional request fields, **provided that leaving one out means exactly
  what it meant before**;
- new values in an open enum.

**Never in v1, only in v2:**
- removing or renaming a field;
- changing a field's type or meaning;
- making anything required that wasn't;
- narrowing what a request accepts.

### Errors

```json
{ "error": { "code": "NOT_FOUND", "message": "This job isn't available.", "retryable": false }, "requestId": "…" }
```

- `code` is stable. The app handles the codes it knows, and treats any other
  code by its HTTP status.
- `message` is written for the person holding the phone.
- `retryable` drives the offline queue.

| Status | Meaning |
|---|---|
| 400 | Fails validation |
| 401 | No valid session |
| 403 | The role isn't allowed, `ACCOUNT_INACTIVE`, `PASSWORD_CHANGE_REQUIRED`, or `WORKSPACE_SUSPENDED` |
| 404 | Doesn't exist, **or isn't yours**. Same answer on purpose, so ids can't be probed. |
| 409 | Conflicts with current state, or the same request is still in flight |
| 422 | An idempotency key reused with a different method, path or body |
| 426 | App too old |
| 429 | Rate limited |

### Keeping old builds honest

- Every request sends `X-App-Version` (native build number plus OTA update id)
  and `X-App-Platform`.
- The public `GET /api/v1/meta` returns `{ minSupportedVersion, latestVersion }`
  for each app.
- A build below the minimum gets **426**, and the app shows a blocking "Please
  update" screen. The header is set by the app, so this is for experience, not
  security.
- When a v2 exists, v1 carries `Deprecation` and `Sunset` headers. v1 stays up
  for at least six months, and until version telemetry shows negligible
  traffic.

---

## 4. Anatomy of an endpoint

Every v1 route is built with one wrapper, so no endpoint can forget a check:

```ts
// apps/web/src/app/api/v1/jobs/[jobId]/clock-in/route.ts
export const POST = v1Route(
  {
    host: "tenant",          // "tenant" | "platform"
    access: "staff",         // an allow-list of roles
    body: ClockInRequest,    // from @bookmops/api
    idempotent: true,
  },
  (ctx) => clockIn(ctx.actor, { jobId: ctx.params.jobId, ...ctx.body }),
);
```

`v1Route` runs these gates in order:

1. **Request id.** Assigned and returned on every response.
2. **IP rate limit.** A cheap limit, applied before anything touches the
   database.
3. **CSRF**, for every non-GET request:
   - require `Content-Type: application/json` and the custom `X-App-Platform`
     header. Together they force a CORS preflight, which fails because
     `/api/v1` allows no cross-origin callers;
   - refuse an `Origin` that isn't the request's own;
   - refuse `Sec-Fetch-Site: cross-site` or `same-site`.

   This matters because every company subdomain is "same-site" to every other:
   a SameSite=Lax cookie still rides a POST from a sibling subdomain.
4. **App version.** 426 if the build is too old.
5. **Host class.** A `tenant` route on the apex, `www`, or a preview host, all
   of which resolve to the platform workspace, answers 404. A `platform`
   route (discovery, meta, forgot-password) never reads a tenant.
6. **Company.** Resolved from the host, as on the web. A suspended or missing
   company answers 403 `WORKSPACE_SUSPENDED`.
7. **Tenant context.** The rest of the request runs inside
   `runAsOrg(org, …)`. The web's per-request organization and timezone
   holders are React `cache()` scopes, which only exist during a render. With
   an explicit context, `pageStoreTz()` and the scoped database read the
   company directly, so a route handler formats times in the company's zone,
   not the server's.
8. **Session.** 401 if there is none. The actor's `organizationId` must equal
   the resolved company. That is checked explicitly, not left to
   `customSession` returning null.
9. **Account state,** read fresh:
   - `ACCOUNT_INACTIVE` if the person is inactive or deleted;
   - `PASSWORD_CHANGE_REQUIRED` if a change is pending, except on `/me`,
     change-password, and sign-out.
10. **Role.** `access` is an **allow-list**, and a missing or unknown role is
    403. The role is **re-read from the database on every request**, with
    the account state in gate 9, never taken from the session payload, a
    cookie cache or the request. A manager who is demoted (say ADMIN to
    EMPLOYEE) loses the manager routes on their very next request, without
    being signed out. For `staff`, the list is `EMPLOYEE` and `FIELD_LEAD`. Manager routes
    (`/api/v1/manager/*`) use `{ capability: X }`, resolved by
    `capabilitiesFor(role)` in `packages/api/src/v1/manager-access.ts`, the
    same function the app reads, so the two can't drift. `/me`, device
    registration, change-password, team chat and announcements admit every
    staff role (`OWNER`, `ADMIN`, `OPS_MANAGER` too).
11. **User rate limit,** per company and user.
12. **Validation.** Body and query against the schema. Field errors answer 400.
13. **Idempotency** (§6).
14. **The service call.** A typed result or error becomes the envelope.
    `CrossTenantError` becomes 404, and any unexpected error becomes 500
    carrying the request id, with the details only in the logs.
15. **Effects,** flushed with `after()` (§5).

**Ownership isn't a gate.** "Is this cleaner on this job?" depends on the data,
so it lives in the service. Not assigned and not found both answer 404.

**Rules every service follows,** whether or not an endpoint's contract repeats
them:

- **Every id resolves inside the session's company.** An id in a path, a query
  or a body (a job, a channel, a person, an announcement, an upload key) is
  looked up with the company in the query, never found first and checked
  after. Another company's id is 404, the same as one that doesn't exist. In a
  list of ids, such as announcements to mark read, it is ignored. A cursor is
  untrusted input and never widens what the query would otherwise return.
- **Tighter limits where a request costs something.** Gate 11 applies to
  every route. These carry their own, per person, answering 429:

  | Endpoint | Limit | Why |
  |---|---|---|
  | Office chat send | 10 a minute | Emails the office when no one is online |
  | Team chat send or edit | 20 a minute | Fans out to every member |
  | Issue report | 10 an hour | URGENT reports email the office at once |
  | Withdrawal request | 5 an hour | Emails the cleaner and the office |
  | Claim a job | 10 a minute | Races other cleaners for the same job |
  | Upload sign | 60 an hour | Each one is storage the company pays for |
  | Crew change (manager) | 60 an hour | Emails the client, invites cleaners |
  | Office chat reply (manager) | 10 a minute | Emails the cleaner when they're away |
  | Withdrawal decision (manager) | 60 an hour | "Mark paid" emails the cleaner |

  A replayed idempotency key is not counted again.
- **No redirects.** A v1 route answers, or fails with the envelope; it never
  redirects. The app sends the session as a header and refuses a redirect,
  since some platforms carry custom headers to the new host.
- **Only stored URLs go out.** A URL in a response (photo, attachment,
  upload) is https on the company's own storage. Photos are read from
  Cloudinary (res.cloudinary.com); signed, short-lived delivery is
  recommended. An upload ticket points only at api.cloudinary.com. A URL a client once sent in is never passed on to other people.

Every request is logged as structured data: request id, company, user, route,
app version, status, error code, duration.

---

## 5. One implementation, two front doors

Today the rules behind clock-in are split. Some are in `@bookmops/core`. The
rest are inline in `clockIn.ts` and `clockOut.ts`: authorization, the resume
decision, write ordering, status changes, logs, and emails. If the API wrote
its own copy of that inline half, the web and the phone would drift. That
has already happened once, with the two rating paths.

So each piece of cleaner functionality is **extracted into a service** that the
server action and the v1 handler both call:

```
apps/web/src/server/
  actor.ts            requireActiveStaffActor(): session → Actor, with every gate in §4 9–10
  clock/clock-in.ts   clockIn(actor, input) → Result<…, ClockInError> & { effects }
  clock/clock-out.ts
  jobs/…
  revalidate.ts       one invalidation helper per domain
```

A service follows these rules:

- **It takes an `Actor` and plain input.** It never reads headers or cookies,
  never redirects, and never calls `new Date()`. The time comes in as input:
  `now` for the web, and the validated `occurredAt` for an offline event
  (§6). Today `new Date()` drives the early window, lateness, the penalty,
  and the strike.
- **Its writes happen in one transaction.** Today `clockIn` writes the session,
  mirrors the job, updates the job, and logs as separate transactions. Helpers
  such as `syncClockMirrors`, `snapshotHourlyEmployeePay`, and
  `snapshotBilledActualHours` take the transaction as a parameter.
- **It is race-safe.** A partial unique index allows only one open work session
  per (job, cleaner), where `endedAt IS NULL`. A double tap, or two devices,
  can't open two sessions. The loser gets the winner's result.
- **It returns effects, it doesn't fire them.** Emails, notifications, and the
  rating request come back as a list, and both adapters flush it with
  `after()`. Today some are unawaited promises that can be frozen once the
  response is sent. A replayed request returns its stored response and fires
  nothing, so no second email and no second strike.
- **Invalidation is shared.** Both adapters call the domain's revalidate
  helper. A clock-in from a phone changes what the admin's screens show, so it
  must invalidate them too.

The server action becomes a thin adapter:
1. `requireActiveStaffActor()`
2. the service
3. flush effects, revalidate, return

Web behaviour must not change. The verify sweep and build route table are
compared after every extraction, as in phase 2.

Using `requireActiveStaffActor()` in the actions closes, as a side effect, the
missing role and account checks listed in §10. The web then gets the same
protection the API has.

---

## 6. Offline clock in and out

A cleaner in a basement taps "Clock in" with no signal. The tap has to count,
once, with the time it happened, **and** "I was offline" must not become a way
to backdate a shift.

### On the phone

- The tap goes into an outbox table in `expo-sqlite`, with a UUID and the time
  it happened.
- **The time comes from the monotonic clock, not the wall clock:** server time
  at the last successful call, plus the monotonic time elapsed since. Changing
  the phone's clock therefore can't move it.
- The outbox drains in order when the connection returns. What it does on each
  status is defined:

  | Status | Outbox action |
  |---|---|
  | 2xx, or 422 | Done |
  | 409 retryable | Retry later |
  | 401, 426, `ACCOUNT_INACTIVE`, `WORKSPACE_SUSPENDED` | **Pause, never discard.** The event waits for sign-in or update. |
  | Other errors | Kept for the "sync problem" screen, never silently dropped |

### On the server: exactly once

One `IdempotencyRecord` table covers every retried mutation (clock in, clock
out, breaks, withdrawals):

- **Columns:** company, user, key, route, request hash, state, stored response,
  expiry.
- **The request hash covers the method, the path and the body:** a SHA-256
  of the method, the concrete path with its ids filled in
  (`/api/v1/manager/withdrawals/w_123/decision`, not the route pattern), and
  the canonical JSON body. Ids live in the path, so a hash of the body alone
  would let one key, reused by a buggy client, replay the answer for one
  withdrawal or time item as if it were another's.
- **Unique on (company, user, key).** One person's key can never collide with,
  or replay, another's.
- **Replay:**
  - a retry returns the stored response and fires no effects;
  - the same key with a different method, path or body answers 422;
  - a key still in flight answers 409, `retryable: true`.
- Records are kept at least as long as the correction window (30 days), then
  deleted by the daily `/api/cron/api-retention` cron (CRON_SECRET, like the
  other crons; registered in `apps/web/vercel.json`).
- Sensitive answers aren't copied into the record: document signing (short-
  lived signed links) and withdrawals (money) store only
  `{"$replayRef": {id}}`, and a replay rebuilds the answer from current data
  (`replay` in `v1Route`). Everything else stores its answer.
- Server actions don't use it. The web has no offline queue, and a double
  submit is covered by the unique open-session index.

### On the server: which time counts

The server stores both times, `occurredAt` from the phone and `receivedAt` from
itself, and decides which to trust:

1. **Offline must be provable.** The server records, per person, every
   second in which they made an authenticated `/api/v1` request, on any
   session (`UserRequestActivity`: one row per person per minute holding a
   60-bit map of its seconds, kept ~15 minutes, pruned by the wrapper and the
   daily retention cron). The claim is disproven, the event applied at
   `receivedAt`, and a correction request with the claimed time sent to the
   office, when either:
   - any request falls wholly between `occurredAt + 1 s` and
     `receivedAt − 30 s` (the reconnect grace: the refresh and outbox drain
     the moment signal returns are not evidence); or
   - the session sending the event was created after `occurredAt` (the phone
     signed in, so it was online, after the tap).

   This replaced `Session.lastRequestAt`, which held only the session's
   latest request: any request inside the grace overwrote the evidence, and a
   fresh sign-in had none. The rule is `decideEventTime` in
   `packages/core/src/time/offline-clock.ts` (pure; cases in
   `apps/web/scripts/verify-api-v1-rules.ts`).
2. **A small gap is applied as is.** If `receivedAt − occurredAt` is under
   five minutes, which covers normal lag and short dead spots, the event
   applies at `occurredAt`.
3. **A larger gap needs the office.** When offline is proven but the gap is
   larger, the event applies at `receivedAt` and a correction request carries
   `occurredAt` for approval. See the Decision below.
4. **The rules use the effective time.** Lateness, the early window, the
   penalty, the strike, and ordering against the cleaner's other sessions all
   use the time the event applies at, never `new Date()`.

### Never lose an event

An event that can't be applied becomes a **correction request** carrying what
the phone reported, never an error loop and never a silent drop:

- a clock-out with no applied clock-in;
- an event for a job the cleaner is no longer on;
- anything that fails validation.

Two further cases:
- **Assignment at the claimed time.** Assignment history is limited:
  `JobAssignment.createdAt` is the best record there is, and `claimJob` only
  writes it at the end. So an event is accepted if the cleaner is assigned now,
  or the assignment existed at `occurredAt`. Otherwise it goes to correction.
  `clockOut` already has the stranded-session rule for this case.
- **The closing report is separate from closing the session.** Offline, the
  kit on the server can change before the clock-out arrives. A bad inventory
  line becomes a flag for the office. It never rejects the clock-out, because
  the hours are real either way.

### Events that arrive after a job looks finished

If teammate B's offline clock-out lands after A's "final" clock-out, the job is
already COMPLETED:
- its pay and billed hours are snapshotted;
- the customer's rating request has been sent.

The late event reopens the calculation. The job's hours and both snapshots are
recomputed, and the rating request is **not** sent twice. If the pay period is
locked or the customer has already paid, the event goes to correction instead.
Today `snapshotHourlyEmployeePay` silently skips a locked period, and those
hours would go unpaid.

The existing clock-out "resume window" compares against the current time, so it
can't judge a backdated event. In v1, idempotency-key replay replaces it.

### Schema changes, staging first

- `IdempotencyRecord`;
- the one-open-session partial unique index;
- `receivedAt` and `clientEventId` on `JobWorkSession` and `JobBreak`, for
  audit;
- ~~the per-session last-request time~~ superseded by per-person request
  activity (`UserRequestActivity`, migration
  `20260928100000_api_hardening_request_activity`).

> **Decision — offline times beyond five minutes.** Under the rules above, a
> gap over five minutes with offline proven is applied at server time, and the
> device time goes to the office to approve. The alternative is to apply the
> device time straight away and flag it. Approval is safer for payroll but
> means more office work in bad-signal buildings. **Recommendation: office
> approval,** with a one-tap approve in the admin queue.

---

## 7. The first endpoints: Bookmops Pro, cleaner screens

Built in this order. Each ships with its service extraction and its checks.

| # | Endpoints | Replaces (web) |
|---|---|---|
| 0 | `v1Route`, `requireActiveStaffActor`, `IdempotencyRecord`, `@bookmops/api` common | — (the foundation) |
| 1 | `GET /meta` · `POST /auth/workspaces` · `POST /auth/forgot-password` · `GET /me` · `POST /devices`, `DELETE /devices/:id` (push tokens) | platform discovery, layout checks |
| 2 | `GET /jobs?scope=today\|upcoming\|past&cursor=` · `GET /jobs/:id` | my-jobs and job-detail loaders |
| 3 | `POST /jobs/:id/clock-in` · `…/clock-out` · `…/breaks` · `…/breaks/:id/end` | `clockIn`, `clockOut`, `startJobBreak`, `endJobBreak` |
| 4 | `POST /uploads` (signed Cloudinary upload) · `POST /jobs/:id/photos` (attach by key) · `…/on-my-way` · `…/issues` · checklist | `uploadJobPhoto`, `markOnMyWay`, `reportJobIssue`, checklist actions |
| 5 | `GET /jobs/available` · `GET /jobs/available/:id` · `POST /jobs/available/:id/claim` | available-jobs loader, `getAvailableJobPreview`, `claimJob` |
| 6 | `GET /pay` · `POST /pay/withdrawals` | my-pay loader, `requestWithdrawal`. This moves money, so it's idempotent and gets its own security review. |
| 7 | availability, kit and inventory, chat, announcements, training, documents | the matching actions |
| 8 | `GET /manager/team/day` · `GET /manager/jobs/:id` · `…/candidates` · `PUT …/crew` · `POST …/cleaners` · approvals (`/manager/approvals/*`, `/manager/withdrawals*`, `/manager/kit-requests*`) · `/manager/alerts*` · `/manager/late-arrivals` · `/manager/issues*` · `/manager/chat/conversations*` · `DELETE /manager/team/channels/:id/messages/:id` | dashboard and calendar loaders, `assignCleaners`, `bulkAssignCleaner`, `decideTimeLogChange`, `processWithdrawal`, `resolveInventoryRequest`, `setJobIssueStatus`, admin chat, `deleteGroupMessage` |

All paths are under `/api/v1`. Notes on the endpoints:
- **Push tokens are per company,** registered after sign-in and removed on
  sign-out.
- **Uploads never pass through a function.** Photos go to Cloudinary, where
  the web already keeps them. The server signs the upload's parameters with
  the Cloudinary API secret (the public_id it chose, a fresh timestamp, the
  allowed formats); the app POSTs the file and those fields as a multipart
  form straight to `https://api.cloudinary.com/v1_1/<cloud>/image/upload`,
  then attaches the asset by its public_id. The server checks that the
  public_id's prefix matches the company, job, and user, and checks the
  asset's format and size through the Admin API before attaching it. The
  full rules are in `packages/api/src/v1/photos.ts`. Photos also queue
  offline.
- Lists use **cursor pagination** from the start.

---

## 8. Platform details

- **Runtime:** Node (Prisma) on Fluid Compute. Authenticated responses are
  never cached.
- **Hosts:**
  - Preview deployments on `*.vercel.app` resolve to the platform workspace,
    so they can't serve a tenant. Testing against staging needs a wildcard
    staging domain.
  - Simulators can't resolve `*.localhost`. Local development uses sslip.io or
    nip.io hostnames; the exact steps for running the app against a local
    server on the staging database are in `apps/staff/README.md`.
- **CORS:** none on `/api/v1` or `/api/auth`. Native apps don't need it, and its
  absence is part of the CSRF defence in §4.
- **`proxy.ts`** skips `/api/*`. `v1Route` does its own host and tenant
  resolution and trusts no header the proxy would have set.
- **Observability:**
  - structured logs per §4;
  - a request id on every response;
  - a histogram of `receivedAt − occurredAt`, to show how offline the crews
    really are.
- **App Store review:** both apps need a demo company and account for the
  reviewers. If the customer app lets people create accounts, it must also let
  them delete their account in the app (Guideline 5.1.1(v)).

---

## 9. How it's verified

- **Service extractions:** the web's verify sweep and build route table must be
  identical after each one.
- **The gates:** a verify script calls `v1Route` with forged requests and checks
  that each is refused:
  - no session;
  - a session from another company;
  - a request on the platform host;
  - an inactive user;
  - a deleted user;
  - a pending password change;
  - a client;
  - an applicant;
  - a missing role;
  - an old app version;
  - a cross-site POST;
  - a POST from a sibling subdomain;
  - a `text/plain` JSON body;
  - another user's idempotency key;
  - a reused key with a different method, path or body;
  - a manager demoted in the database while their session stays open.
- **Manager rules** (`packages/api/src/v1/manager-access.ts`, rules 9 and
  10), each checked against the staging database:
  - deciding one's own clock time, withdrawal or kit request is 403
    `SELF_APPROVAL`, and none of them appear in the caller's queues or
    counts;
  - a field lead reaching another group's clock time is 404, and sending
    ADJUST is 403;
  - two decisions on one item, sent at once, apply exactly once: one
    succeeds, the other is 409 with the endpoint's "already handled" code,
    and no stock moves or email goes twice;
  - two crew changes on one job, sent at once, with the same
    `expectedCrewIds`: one succeeds, the other is 409 `CREW_CHANGED`; a
    stale warnings hash is 409 `WARNINGS_CHANGED`.
- **Offline rules:** each rule in §6 is tested against fixed times. The cases
  are:
  - a backdated clock-in after online activity;
  - a gap under the threshold, and one over it;
  - out-of-order events;
  - a late event after completion;
  - a locked pay period.
- **End to end:** a script signs in as the seeded test cleaner and exercises
  every endpoint, against a local server connected to the **staging**
  database. It never touches production.
- **Security:** the auth-hardening auditor reviews the built wrapper and
  sign-in flow before the first endpoint ships, and again before withdrawals.

---

## 10. Production issues found while designing this

These exist on the live web app today, independent of the mobile work. Each has
been confirmed in the code, and the affected actions are confirmed as live
endpoints in the build's server-action manifest. They should ship as one small,
separately reviewed change on `main` once Prem approves.

| Severity | Issue | Where |
|---|---|---|
| High | Deactivating or deleting a person never ends their sessions (30 days, sliding). Actions don't check `isActive` or `mustChangePassword`; only the page layout does. A deactivated cleaner can still claim jobs, chat, and request withdrawals by calling actions directly. | `lib/auth.ts` `customSession`; all cleaner actions |
| High | A password reset doesn't sign out other devices, so a stolen phone stays signed in after the owner resets. | `lib/auth.ts` (`revokeSessionsOnPasswordReset` not set) |
| High | Role checks only exclude `CLIENT`. An `APPLICANT` account can claim real jobs and read available jobs' client names, addresses, and prices. | `claimJob.ts:21`, `getAvailableJobPreview.ts:45` |
| High | The sign-in rate limiter can be bypassed with a double slash in the path or by rotating IPv6 addresses (GHSA-x732-6j76-qmhm, GHSA-p6v2-xcpg-h6xw). | `better-auth` 1.4.5, fixed in 1.4.22 |
| Medium | Clock-in and break actions check the session but no role at all. | `clockIn.ts`, `jobBreak.ts`, `timeLogRequests.ts` |
| Medium | Platform sign-in discovery reveals through timing whether an email exists, and rate-limits per IP only. | `discover.ts:81-131` |
| Low | Group chat treats a missing role as `EMPLOYEE`, so it fails open if the session layer ever regresses. | `groupChat.ts:66` |
| Low | `ensureDefaultChannel` is a public action with no auth check. It only creates a missing default channel. | `groupChat.ts:176` |
| Low | `closeOpenBreaksOnClockOut` is an unguarded `"use server"` export. It isn't referenced today, so it isn't live, but it's one import away from being an open action. | `jobBreak.ts:104` |

The fix follows the same shape as §5:
- `requireActiveStaffActor()` with an allow-list, used by every cleaner action;
- revocation on deactivate, delete, and password reset;
- the dependency upgrade;
- constant-time discovery with per-email limits;
- the two helpers moved out of `"use server"` files.

---

## 11. What review changed

| Area | Draft | Revision |
|---|---|---|
| Tenant context | Resolved from the host | Also run inside `runAsOrg`. Otherwise route handlers lose the company's timezone. |
| Gates | 9 | 15. Added: request id, CSRF, host class, the explicit org-match check, fresh account state, allow-list roles, IP limit before the session, effects. |
| Idempotency | A unique column on the work session | One table scoped to company, user, and key. It covers updates, not just creates, and replays fire no effects. |
| Offline time | Device time, validated and flagged | Device time only when offline is provable, from a monotonic clock. Office approval beyond five minutes. Nothing is ever dropped. Late events reopen snapshots. |
| Services | Extracted | Also transactional, race-safe, clock-free, and returning effects. Invalidation is shared. |
| Contract | zod, lenient parsing | Plus frozen v1 enums, open response enums, and a JSON Schema diff in CI. |
| Sign-in | Discovery and expo plugin | Plus constant-time discovery, per-email limits, `apiOrigin`, an origin allow-list, forgot-password, scheme-as-Origin-only, and revocation. |
| Status codes | 403 for "not assigned", 503 for suspended | 404 for anything not yours. 403 `WORKSPACE_SUSPENDED`. |
| Endpoints | — | Added push tokens, signed uploads, cursor pagination, and forgot-password. |

---

## 12. Decisions needed

1. **The production fixes in §10.** Approve them to ship on `main` ahead of this
   work. They affect the live web app, and most are High.
2. **Offline times beyond five minutes:** office approval (recommended), or
   apply and flag (§6).
3. **Field leads in Bookmops Pro:** decided, **both, according to the
   permissions.** A field lead gets the cleaner screens and exactly the
   manager screens the web lets a field lead use (the matrix in
   `packages/api/src/v1/manager-access.ts`: their group's day, clock-time
   approvals, alerts). Nothing more.
4. **Minimum-version policy:** who raises `minSupportedVersion`, and how much
   notice cleaners get before a forced update.
