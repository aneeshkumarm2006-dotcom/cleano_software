# Security review — multi-tenant branch

**Reviewed:** 2026-08-30 · **Branch:** `multi-tenant` · **Head:** `82303bd` (45 commits, unpushed)
**Scope:** the security implications newly introduced by converting Awer from single-tenant
to multi-tenant. Not a general code review, and not a review of pre-existing issues.

> **Status: all four FIXED on 2026-08-30**, and each one proven against a dev server
> pointed at staging rather than assumed — see *Verification* below and the diary entry
> in `CUTOVER_LOG.md`. The descriptions are kept in the past tense of the bug so the
> reasoning survives; the fix applied is recorded under each one.
>
> Still open, and unchanged by this: **the tenant-isolation layer has never been
> audited** — `db-scoped.ts`, the RLS migrations, `setup-app-role.sql` /
> `setup-app-grants.sql`. That pass was interrupted and is the next security task.

| # | Finding | File | Severity | Confidence | Status |
|---|---|---|---|---|---|
| 1 | Settings cache is not keyed by organization | `src/lib/settings/index.ts:31` | High | 9/10 | FIXED |
| 2 | Session role lookup fails open to `EMPLOYEE` | `src/lib/auth.ts:131` | High | 8/10 | FIXED |
| 3 | Public signup joins an existing workspace | `src/lib/auth.ts:81` | High | 8/10 | FIXED |
| 4 | `x-awer-org` trusted from the client on `/api/*` | `src/lib/org.ts:39` | Medium | 8/10 | FIXED |

---

## 1. BROKEN_TENANT_ISOLATION — `src/lib/settings/index.ts:31`

* **Severity:** High · **Category:** `cross_tenant_cache_poisoning` · **Confidence:** 9/10

**Description.** The settings read cache is a **process-global `Map` keyed only by the
setting key**, with no organization component. This branch changed the query underneath it
from the single-tenant client to the org-scoped one (`import { db } from "@/lib/org-db"` at
line 14, used at lines 46 and 73), so the *read* is now per-tenant but the *cache in front of
it is not*. For the 30-second TTL, whichever tenant reads a setting first serves that value
to every other tenant handled by the same Node instance. `invalidateSetting` (line 164) and
`invalidateAllSettings` (line 168) are likewise org-blind.

```
30  const TTL_MS = 30_000;
31  const cache = new Map<string, CacheEntry>();
...
39    const cached = cache.get(key);          // <- no org in the key
40    if (cached && cached.expires > Date.now()) {
41      return cached.value as SettingValue<K>;
...
46      const row = await db.appSetting.findFirst({ where: { key } });   // org-scoped
...
58    cache.set(key, { value, expires: Date.now() + TTL_MS });
```

The `getSettings` batch path (lines 66-69, 89, 98-99) shares the same unkeyed map. The cache
was correct when there was one tenant; it became a cross-tenant channel the moment the query
below it became scoped.

**Exploit scenario.** The most damaging consumer is the deposit gate on the **unauthenticated**
booking endpoint. `src/lib/booking-deposit.server.ts:49-56` reads the deposit amounts via
`getSettings(...)`, and `src/app/(book)/actions/submitBooking.ts:529-537` treats a zero amount
as "no payment needed" (`verification = { status: "waived" }`). An attacker self-registers a
trial workspace at `useawer.com/get-started`, becomes its OWNER, and sets their own booking
deposit to `0` — permitted, since `STANDARD_DEPOSIT_MIN_USD = 0` (`src/lib/booking-deposit.ts`,
registered at `src/lib/settings/registry.ts:578`). They load `evil.useawer.com/book`, which
populates the global cache with `booking.standardDepositUsd = 0` under the bare key. Within
30 s, on the same instance, they POST the booking action against `victim.useawer.com`. The
amount resolves to `0`, `depositDue` is false, the deposit branch is skipped, and real `Job`
rows are minted on the victim's calendar with no payment and no card on file — defeating the
invariant the code comments above line 529 explicitly claim to hold. Paired requests keep the
entry warm indefinitely.

The same primitive works without any attacker, as continuous config bleed: `general.businessName`
/ `businessEmail` / `businessPhone`, `policy.cancellationFeeUsd`, `scheduling.noShowFeeUsd` and
`payments.giftCardTiers` cross tenants on every public page, and `forEachOrganization`
(`src/lib/cron-tenants.ts:63-66`) seeds the cache from the first org iterated for every org
after it in the same cron run.

**Recommendation.** Key the cache by organization, and make the key impossible to build without
one:

```ts
const cache = new Map<string, CacheEntry>();          // key: `${orgId}:${settingKey}`
const ck = (orgId: string, key: string) => `${orgId}:${key}`;

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const orgId = await requireOrgId();                 // throws rather than sharing
  const cached = cache.get(ck(orgId, key));
  ...
  cache.set(ck(orgId, key), { value, expires: Date.now() + TTL_MS });
}
```

Apply the same change to the `getSettings` batch path (lines 66-69, 89, 98-99) and to both
invalidation functions. Simplest safe fix if you would rather not thread `orgId` through:
replace the module-level `Map` with a per-request `React.cache`, which cannot outlive one
tenant's request. Separately, stop letting a `0` deposit silently mean "skip verification" —
gate that on an explicit per-workspace flag read in the same request.

**Why the confidence is high.** Independently found and traced to the same exploit by two
reviewers with no shared context; the defect is visible in eight lines and needs no assumptions
about library internals.

---

## 2. DEFAULT_DENY_VIOLATION — `src/lib/auth.ts:131`

* **Severity:** High · **Category:** `session_fails_open_across_tenant` · **Confidence:** 8/10

**Description.** The `customSession` plugin resolves the caller's role through the **org-scoped**
client, then treats "no row found" as "EMPLOYEE of this organization" rather than "not a
member — reject".

```
120  plugins: [customSession(async (session) => {
121      if (session.user) {
123        const userProfile = await db.user.findUnique({   // scoped -> null for a foreign user
124          where: { id: session.user.id },
125          select: { role: true },
126        });
131            role: userProfile?.role ?? 'EMPLOYEE',        // non-member becomes a cleaner
```

This is load-bearing because session validation itself is not tenant-bound: `Session` is
deliberately excluded from `TENANT_MODELS` (`src/lib/tenant-models.ts:4` — "either a
better-auth internal (Account, Session, ...)"), so the session lookup is not org-filtered. The
scoped role lookup was the one org-aware step, and its miss is answered with a valid role
instead of a refusal. Downstream guards then check role only, never membership.

**Exploit scenario.** An attacker holding any valid session — from their own self-registered
workspace, or as a cleaner at any tenant — presents that session token against another
workspace's host (`curl -H 'Cookie: ...' https://victim.useawer.com/cleaners/available-jobs`;
a browser will not send it cross-host, but the attacker sets the header directly). The session
resolves, the scoped user lookup returns `null` because that user is not in the victim's org,
and line 131 hands back `role: "EMPLOYEE"`. Every guard that asks only "is this a cleaner?"
now passes for a principal who is not a member of the victim organization at all.
`src/app/cleaners/layout.tsx:44` compounds it: its deactivation and temp-password checks are
written as `if (dbUser && ...)` / `dbUser?.`, so a `null` user skips them entirely. The correct
outcome is no session.

**Recommendation.** Fail closed. When the scoped lookup returns no row, return `null` from the
`customSession` callback so `getSession` yields no session at all — never substitute a default
role for a failed authorization lookup. Better, enforce membership explicitly: fetch
`organizationId` alongside `role` and compare it against `await requireOrgId()`, returning
`null` on mismatch. Longer term, add `organizationId` to the `Session` model and include it in
`TENANT_MODELS` so the boundary is enforced at the data layer rather than by convention.

**Caveat on confidence.** The fallback and the `TENANT_MODELS` exclusion are both directly
verified in source. The one link not confirmed is whether better-auth resolves the session in a
single joined query (attack works as described) or two queries with a scoped user read (session
would fail to resolve and impact drops). **The `?? 'EMPLOYEE'` default is wrong either way.**

---

## 3. BROKEN_ACCESS_CONTROL — `src/lib/auth.ts:81`

* **Severity:** High · **Category:** `cross_tenant_account_provisioning` · **Confidence:** 8/10

**Description.** `emailAndPassword` is enabled with **no `disableSignUp`**, so better-auth's
public `POST /api/auth/sign-up/email` endpoint is live on every workspace subdomain. Because
the adapter is now built on the org-scoped client, the `User` row that endpoint creates is
stamped with the `organizationId` of whichever host the request arrived on. Self-registration
therefore **joins an existing organization** instead of creating one, bypassing the governed
`/get-started` -> `provisionOrganization()` path entirely.

```
81   emailAndPassword: {
82     enabled: true,
83     sendResetPassword: async ({ user, url }) => {
```

The row takes the Prisma defaults — `role @default(EMPLOYEE)`, `isActive @default(true)` — and
`autoSignIn` returns a session in the same response.

**Exploit scenario.** Workspace slugs are enumerable (`checkSlug` in
`src/app/get-started/actions.ts:117` confirms which are taken). An attacker runs
`curl -X POST https://acme.useawer.com/api/auth/sign-up/email -d '{"name":"x","email":"x@evil.tld","password":"..."}'`.
`/api/auth/` is in `PUBLIC_PREFIXES` (`src/proxy.ts:45`), the workspace is ACTIVE, and a `User`
with `organizationId = <acme>` and `role = EMPLOYEE` is created with a live session.
`src/app/cleaners/layout.tsx:40` checks only `isCleanerRole(role)`, so the attacker reads Acme's
open jobs — client names, full street addresses, prices and pay — and can claim jobs, a write.

Aimed at `useawer.com` / `www` / `platform`, all of which resolve to `PLATFORM_ORG_SLUG`
(`src/lib/tenant.ts:37`), it plants an attacker-controlled account **inside the vendor's own
platform workspace** — which is the sole precondition `setStaffRole` checks before granting a
`platformRole` (`src/lib/console/actions.ts:521`:
`if (!platformOrg || user.organizationId !== platformOrg.id)`).

**Recommendation.** Set `emailAndPassword: { enabled: true, disableSignUp: true }`. Route the
two legitimate self-registration flows through server-controlled provisioning: `/get-started`
already calls `provisionOrganization`, and the customer-portal setup flow should use a server
action that sets `role: "CLIENT"` explicitly and only against an org-issued token or a
pre-existing `Client` row. Do not let `@default(EMPLOYEE)` be the identity an unprovisioned
account inherits by omission.

**Caveat on confidence.** The open-signup endpoint itself likely predates this branch (on
single-tenant `main` a stranger got an EMPLOYEE account in the only org). What is **new here**
is that it now targets any customer's workspace by hostname, and that it hollows out the
platform-membership precondition the new console relies on.

---

## 4. HOST_HEADER_TRUST — `src/lib/org.ts:39`

* **Severity:** Medium · **Category:** `client_controlled_tenant_selection` · **Confidence:** 8/10

**Description.** Tenant resolution prefers an **inbound** request header over the host, and the
proxy that is supposed to overwrite that header does not run on the paths where it matters.

```
src/lib/org.ts
39      return h.get(ORG_SLUG_HEADER) ?? orgSlugFromHost(h.get("host"));

src/proxy.ts
215     '/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)',
```

The comment above line 39 acknowledges the matcher skips `/api/*` and presents the host fallback
as the fix — but the header is read **first**, so on exactly the paths the proxy never touches,
an attacker-supplied value wins. The identical pattern is at `src/lib/org-url.ts:81`.
`getOrgSlug` feeds `requireOrgId()` -> the scoped client -> the RLS
`set_config('app.current_org_id', ...)` announcement, so the attacker's chosen value becomes
authoritative for *both* isolation layers simultaneously; RLS is pointed at the victim and does
not stop it.

**Exploit scenario.** `POST https://evil.useawer.com/api/stripe/charge-deposit` with
`x-awer-org: victim` and a JSON body scopes the request to the victim:
`db.client.findFirst({ where: { email } })` runs against the victim's rows and
`getOrCreateStripeCustomer` writes `stripeCustomerId` onto the victim's `Client` row against the
victim's connected Stripe account (`src/app/api/stripe/charge-deposit/route.ts:64-72`,
`src/lib/stripe-org.ts:207-225`). The same header aims `/api/auth/sign-up/email` (finding 3) at
`platform` from any hostname, and `x-awer-path` is client-settable on the same paths, bypassing
the workspace-status gate in `src/app/layout.tsx`.

**Recommendation.** Never read the tenant from an inbound header. Resolve from `orgFromContext()`
then `orgSlugFromHost(h.get("host"))` only; if a stamped header is present and disagrees with the
host, refuse the request rather than picking one. Apply identically at `src/lib/org-url.ts:81`.
Then either widen the matcher to `'/((?!_next/static|_next/image|favicon.ico).*)'` or strip
`x-awer-org` / `x-awer-path` from every inbound request at the edge, and correct the comment at
`src/proxy.ts:105-107`, which documents a guarantee the matcher does not provide.

**Why Medium, not High.** 8/10 on the code defect — verified directly in both files, not in
dispute. Lower on impact, because the strongest counterargument holds for most endpoints: an
attacker can usually reach the same handler simply by using the victim's hostname, so the header
adds *reach* rather than *access*. It is a genuine escalation only where the host is not
otherwise usable — notably aiming signup at `platform`.

---

## Coverage and caveats

**Two review passes did not complete.** The dedicated tenant-isolation audit
(`src/lib/db-scoped.ts`, the RLS migrations, `setup-app-role.sql` / `setup-app-grants.sql`,
per-org unique constraints) and the adversarial false-positive filtering round were both
interrupted. The four findings above carry direct verification of the primary code facts —
`src/lib/settings/index.ts`, `src/lib/auth.ts`, `src/lib/org.ts`, `src/proxy.ts` and
`src/lib/tenant-models.ts` were read and quoted as they actually are — but **the RLS and
scoped-client layer has not been independently audited**, and no finding here has been through a
dedicated refutation pass. Treat the confidence scores as un-adjudicated.

### Dropped below the reporting bar

- **Weak key derivation** when `SECRETS_KEY` is a passphrase rather than 32 random bytes: a
  single unsalted SHA-256 (`src/lib/secret-box.ts:51`). Confidence 7 — requires an operator
  misconfiguration. Worth fixing; reject non-32-byte values, or use scrypt/argon2id with a salt
  and bump the envelope to `v2`.
- **Shared platform-wide Twilio sender** colliding with per-org inbound routing
  (`src/lib/sms-sender.ts:29`). Confidence 6 — requires a specific number assignment plus a
  customer shared between two companies. Fix by scoping the env fallback to one named workspace
  the way Stripe does with `STRIPE_ENV_ORG_SLUG`.

### Reviewed and found sound

- All eight console server actions independently call `requirePlatformStaff()` with an explicit
  minimum rank, rather than relying on the layout check.
- Every cross-org read in `src/lib/console/queries.ts` goes through `assertConsoleReader()`.
- `createWorkspace` allowlists fields and never accepts `role` / `organizationId` / `status` /
  `platformRole`. `provisionOrganization` hard-codes `role: "OWNER"` and always creates a new org.
- `RESERVED_SLUGS` blocks `www`, `api`, `admin`, `platform`, `console`; `slugify` is idempotent
  and the taken-slug check is backed by a unique constraint re-checked inside the transaction.
- Session cookies are host-only — no `Domain=` and no `crossSubDomainCookies` anywhere — so there
  is no parent-domain cookie-sharing primitive between tenant subdomains.
- The Twilio inbound signature check is a correct constant-time HMAC-SHA1 that runs before org
  resolution and fails closed.
- Cron authorization uses `timingSafeEqual` and fails closed when `CRON_SECRET` is unset.
- The Stripe webhook derives its signing secret and its execution org from the same source, so a
  tenant cannot sign an event that executes against another tenant. Replay is blocked by the
  `WebhookEvent` primary-key claim.
- Per-company Cloudinary folder paths cannot be escaped: slugs are constrained to the DNS-label
  charset at every write path, and caller-supplied segments are stripped to `[A-Za-z0-9._-]`.
- Token-gated public pages (`add-card/[token]`, `rate/[token]`) use `randomBytes(24)`, are
  single-use and expiring, and resolve through the scoped client — so a token minted in org A
  returns nothing on org B's host.
- The interpolated raw SQL in `submitBooking` and `src/lib/job-number.ts` uses parameterized
  tagged templates carrying an explicit `organizationId`.
- `setEmployeePassword` resolves its target through the scoped client before touching the
  unscoped `Account` row, so it cannot cross an org boundary.

### Suggested order of work

1. **Finding 1** — contained change in one file, and it is the only one that lets a stranger
   create unpaid jobs on a paying customer's calendar.
2. **Finding 2** — deleting the `?? 'EMPLOYEE'` fallback is a one-line fix and is correct
   regardless of how the rest resolves.
3. **Finding 3** — one config flag, but confirm the customer-portal setup flow first, since it
   may depend on open signup.
4. **Finding 4** — two-line change in `org.ts` and `org-url.ts`.
5. Re-run the interrupted tenant-isolation audit and the filtering round.

**Before cutover:** findings 1 and 2 are both small and both sit on the tenant boundary. Fixing
them is cheaper than explaining either one to a customer afterwards.

---

## Fixes applied — 2026-08-30

Each fix was proven against a dev server pointed at the **staging** database, using the two
seeded workspaces `teamcleano-demo` and `fixaropro-demo`. Production was not touched; the
`organizationId` column count there is still **0**.

| # | Fix | Where |
|---|---|---|
| 1 | Cache entries keyed `<organizationId>:<settingKey>`; no tenant means the cache is not touched at all rather than shared. `invalidateSetting` became async and org-aware. | `src/lib/settings/index.ts`, `src/app/admin/actions/updateAppSetting.ts` |
| 2 | A scoped-lookup miss now returns `null` — no session — instead of `role: 'EMPLOYEE'`. | `src/lib/auth.ts` |
| 3 | `role` declared as a better-auth additional field with `defaultValue: "CLIENT"` and `input: false`, plus a `databaseHooks.user.create.before` that forces it. | `src/lib/auth.ts` |
| 4 | The tenant is derived from the host only; the inbound `x-awer-org` header is no longer read. | `src/lib/org.ts`, `src/lib/org-url.ts` |

### Verification

**Finding 2 — cross-tenant session replay.** Signed in as `teamcleano-demo`'s admin, then
replayed the exact cookie against the other workspace's host:

```
own host        (teamcleano-demo)  ->  {"session":{...}}   real session
another company (fixaropro-demo)   ->  null                no session
```

Before the fix the second call returned a session carrying `role: "EMPLOYEE"`.

**Finding 4 — header spoofing.** With the same cookie:

```
Host: teamcleano-demo  +  x-awer-org: fixaropro-demo   ->  session   (header ignored)
Host: fixaropro-demo   +  x-awer-org: teamcleano-demo  ->  null      (host won)
```

**Finding 3 — signup role.** `POST /api/auth/sign-up/email` on a tenant host:

```
before the fix              ->  role = EMPLOYEE   (a staff role: opens the cleaner app)
after declaring the field   ->  role = CLIENT
with "role":"OWNER" in body ->  role = CLIENT     (input: false holds)
```

The first attempt at this fix — the `databaseHooks` hook alone — **did not work**, and the
probe caught it: better-auth's adapter strips fields it has not been told about, so the
INSERT omitted the column and Prisma's `@default(EMPLOYEE)` filled it back in. Declaring the
additional field is what makes it take. Worth remembering: the hook looked correct and was
silently a no-op.

All probe rows were deleted; staging holds none.

### Regression checks

```
verify-tenant-isolation      23 passed, 0 failed
verify-tenant-runtime        11 passed, 0 failed
verify-provisioning          13 passed, 0 failed
verify-access-requests        9 passed, 0 failed
verify-stripe-isolation      12 passed, 0 failed
verify-host-routing          38 passed, 0 failed
npx tsc --noEmit             clean
npm run build                exit 0
```

`verify-endpoint-auth` and `verify-console-isolation` could not run: both hardcode a
`teamcleano` slug and `@teamcleano.test` logins, and staging is seeded as `teamcleano-demo`.
Proven to be that mismatch and not a regression — sign-in returns **503** on a host whose
workspace does not exist (correct, fail-closed) and **200** on `teamcleano-demo`.

`verify-cleaner-pay` fails to load with a `server-only` import error under tsx. Proven
pre-existing by running it in a git worktree at `82303bd`, before any of these changes, where
it fails identically.

### Not fixed, and worth a decision

`linkClientAccount` matches an existing `Client` row **by email alone**
(`src/app/(customer)/actions/linkClientAccount.ts:35`). It refuses when the row is already
linked to another user, so a customer who has set up a portal login is safe — but most have
not. Combined with unverified email addresses and per-org email uniqueness, a stranger can
register a known customer's address in that workspace and inherit their client record.

This is pre-existing logic, not introduced by the multi-tenant work, and the fix — requiring
email verification before linking — changes the customer signup experience. That is a product
decision, so it is recorded here rather than made unilaterally.
