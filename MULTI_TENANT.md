# Awer Multi-Tenant Migration — Working Tracker

Turning Awer from TeamCleano's single-tenant software into a SaaS other cleaning
companies can buy: sign up, pay, get their own workspace at
`<slug>.useawer.com`.

**Started:** 2026-08-22 · **Branch:** `multi-tenant` (local, unpushed)
**Model:** convert in place — TeamCleano becomes organization #1.

---

## 🔴 The one hard rule

**Production is read-only. It has not been written to, and will not be, until
Prem explicitly approves a specific migration at a specific time.**

Every schema change, backfill and script targets the Supabase **staging**
branch. TeamCleano's cleaners and admin use the live system daily; this is a
real operating business, not a test environment.

Three independent layers enforce it:

1. **Separate database** — staging is its own Supabase branch.
2. **Separate deployment** — the Vercel project serving `www.useawer.com` is set
   to *Only build production*, so no branch push can raise a preview against
   production credentials.
3. **Script guards** — every script aborts unless the connection string
   contains the staging project ref.

**No production customer data outside production.** Staging briefly held a copy
(936 real emails, 909 real phones); it was truncated and reseeded with synthetic
data, and the local dump was deleted. Both migrations so far are
content-independent, so real data bought nothing and carried real risk.

---

## Environments

| | Production | Staging |
|---|---|---|
| Supabase project | `kbreldosgjzwqnwnvxgw` | `udgbixmlyqsoalvrjbgo` (persistent branch) |
| Env keys | `DATABASE_URL` / `DIRECT_URL` in `.env` | `STAGING_DATABASE_URL` / `STAGING_DIRECT_URL` in `.env.local` |
| Vercel project | `cleano-software` → `www.useawer.com`, builds `main` only | `awer-staging` (not yet created) |
| Data | live customers | synthetic: `.test` emails, `+1555` phones |
| Backups | daily, restorable. PITR available but **not** purchased — see below | n/a |

Migrations do **not** run on deploy. `prisma migrate deploy` is manual and must
run *before* shipping code that needs the new schema.

---

## Architecture

**Pooled multi-tenancy: one database, `organizationId` on every business table,
Postgres row-level security as the backstop.**

This is what Salesforce (OrgID on every row), HubSpot (`portalId`) and most
vertical SaaS do. AWS's guidance is to stay pooled until a customer or regulator
forces otherwise; database-per-tenant means every schema change runs N times and
moving a tenant becomes an engineering project (Shopify had to build a dedicated
tool for it).

**Why RLS specifically, and not just discipline:** there are ~1,400 query call
sites across 368 files. If isolation depends on every one of them remembering
`where: { organizationId }`, someone eventually forgets — and the failure mode
is one company seeing another's customers, revenue and payroll. RLS moves the
guarantee into the database, where forgetting is harmless.

Two details that must be right or RLS is decorative:
- Policies need **both** `USING` and `WITH CHECK`. `USING` alone protects reads
  while still allowing a write tagged with another org's id.
- Postgres exempts table owners from their own policies. Requires
  `FORCE ROW LEVEL SECURITY` plus a limited application role.

**`organizationId` is a plain indexed column, not a Prisma relation.** A relation
means a foreign key on 97 tables, and adding those to a live database validates
every existing row. A plain column is a pure `ADD COLUMN` — instant, no table
rewrite. Isolation comes from RLS; an FK only guarantees the id isn't garbage.

---

## Steps

| # | Step | Status |
|---|---|---|
| 0 | Staging environment, build guardrail, work branch | ✅ done |
| 1 | `Organization` table + nullable `organizationId` on 97 models | ✅ done (staging) |
| 2 | Backfill — found TeamCleano, claim every row | ✅ done (staging) |
| — | Synthetic seeder, drop prod data from staging | ✅ done |
| 3 | Tenant context — subdomain → org in `proxy.ts` | ✅ done |
| 4 | Scope ~1,400 queries, module by module | ⬜ next |
| 5 | Enforce — `NOT NULL`, RLS, constraint fixes, suspension | ✅ done |
| 6 | Platform layer — super admin, signup, plans, provisioning | ✅ done, migration applied to staging |
| 7 | Per-org links, cron, SMS, uploads | 🟡 7a done (Stripe deliberately deferred) |
| 8 | Production cutover (needs explicit approval) | ⬜ |

---

## ✅ Done

### Step 0 — safe place to work
- Supabase **persistent** branch `staging` created (~$9.70/mo, Micro).
  Persistent, not preview: it cannot be reset or auto-deleted.
- `libpq` installed locally for `pg_dump`/`psql`.
- **`ignoreBuildErrors` turned off** in `next.config.ts`. It had been hiding
  nothing — `tsc` was already clean once the Prisma client was regenerated — so
  it cost nothing and buys the guardrail that a query losing its org scope is a
  build failure rather than a customer-visible leak.
- Branch `multi-tenant` created. `main` stays the hotfix lane for TeamCleano.
- Confirmed every repo migration is applied to production and nothing is pending.
  The 3 extra rows in `_prisma_migrations` are rolled-back May attempts.

### Step 1 — `20260822170027_add_organization_and_tenant_columns`
97 `ADD COLUMN` (nullable), 98 `CREATE INDEX`, 1 `CREATE TABLE`, 2 enums.
**Zero drops, zero `NOT NULL` on existing tables.**

`Account`, `Session` and `Verification` are excluded — better-auth internals
carrying no business data. `Account`/`Session` hang off `User` (scoped);
`Verification` is token-keyed. Leaving them alone keeps the auth library
untouched, which is the most delicate part of this job.

### Step 2 — `20260824110653_backfill_teamcleano_organization`
One `INSERT` for `org_teamcleano`, then 97 guarded `UPDATE`s.

Written to be **re-runnable** — the pooler has already dropped connections twice
and will again. Proven by running it twice on staging: the second pass touched
**0 rows**. If it drops mid-run on production, the fix is to run it again.

### Seeder — `scripts/seed-tenant.ts`
```
npx tsx scripts/seed-tenant.ts --slug demo --name "Demo Co"
```
Creates an org, 8 users (loginable — real better-auth scrypt hashes), 25 clients
with addresses, 40 jobs. Two orgs seeded so isolation can actually be tested;
it cannot be tested with one.

Not throwaway work: provisioning a new org with sensible starting data is
exactly what Step 6 must do when a company signs up. `AppSetting` rows are
deliberately not seeded — the settings registry returns its declared default
when no row exists, so a fresh org works with an empty settings table.

### Step 3 — tenant context
`src/lib/tenant.ts` (pure host→slug parsing), `src/proxy.ts` (stamps
`x-awer-org` on every request), `src/lib/org.ts` (`getCurrentOrg`,
`requireOrgId`, cached per request).

Anything that is not a tenant subdomain resolves to `DEFAULT_ORG_SLUG`, which is
what keeps `www.useawer.com` behaving exactly as today. The slug is always
recomputed from the host and overwrites any inbound header, so a client cannot
reach another tenant by sending it.

Two things found while wiring it:
- **The proxy matcher skips `/api/*`.** Route handlers — Stripe webhooks, cron,
  better-auth — would never have seen the header. `getOrgSlug()` now falls back
  to parsing the host itself, making resolution a property of the request rather
  than of the matcher.
- **Reserved labels** (`api`, `www`, `admin`, `staging`, …) are refused as
  tenant slugs, or `api.useawer.com` stops meaning the API.

Verified against both seeded orgs: each resolves from its own host, `www` falls
back to default, unknown slugs resolve to no org, and `*.localhost` works for
local subdomain testing. 19 parsing cases pass.

### Step 5a/5b/5c — enforcement so far
- **5a** Ten unique constraints made per-organization. Surfaced 41 type errors,
  all code addressing rows by a key that is no longer globally unique.
- **5b** Per-organization job numbering, allocated by an atomic
  `UPDATE ... RETURNING`. Three of eight creation sites build `jobData: any`, so
  the compiler could not see the missing required field — found by reading every
  site. Invoice numbering already worked, because it reads through the scoped
  client.
- **5c** `User.email` unique per organization. The same person can hold separate
  accounts at two cleaning companies.

**A bug worth remembering, found in 5c.** better-auth's session handler reads
the user with `select: { role: true }`. The scoped client checked ownership by
reading `row.organizationId` *after* the query, which is absent when the caller
did not select it — so the check read `undefined` and rejected every lookup.
Every session would have silently fallen back to the default role. `findUnique`
is now re-issued as a filtered `findFirst`, which respects any `select`, and
three regression cases cover it.

**Two security properties now verified**, not assumed:
- The same email signs into different accounts depending on the subdomain.
- A session cookie from one tenant does not resolve on another — the user lookup
  is organization-scoped, so the session is simply invalid there.

### Step 5d/5e/5f — the database enforces it now
- **5d** `organizationId` NOT NULL on all 97 tables, plus a CHECK that it is not
  blank. Nested writes had to be stamped first, or requiring the column would
  have broken booking photos, invoice line items and checklist items.
- **5e** Row-level security on all 97 tables, USING **and** WITH CHECK, FORCE
  set, and the application connecting as `awer_app` — a role that owns nothing
  and cannot bypass. The `postgres` role Supabase provides has `rolbypassrls`,
  so policies under it would have been decoration.
- **5f** The promo-code raw SQL now names its organization. Raw SQL bypasses the
  scoped client entirely, and two companies both running WELCOME10 would have
  burned each other's uses.

**The hard part was not the policies, it was announcing the tenant.** Every
statement runs inside a transaction that first sets `app.current_org_id`. The
~80 interactive transactions in the codebase hold one connection for their whole
body, so the announcement is made once at the top and an AsyncLocalStorage flag
stops nested operations opening a second transaction on a different connection —
which is precisely how RLS turns into blank screens.

`current_setting(..., true)` returns NULL when unset, and `"organizationId" =
NULL` is never true, so a connection that fails to announce itself sees **nothing
rather than everything**.

Verified with the whole application running on the restricted role: public pages
serve for both tenants, sign-in works, each admin sees exactly its own 25 clients
and none of the other's, and a session cookie from one tenant still will not
resolve on the other.

### Step 5g — a suspended workspace is locked out
Anything not ACTIVE — suspended, cancelled, or still being provisioned — gets a
notice instead of the application, and an unknown subdomain gets one that
reveals nothing about which workspaces exist.

**The gate had to move twice before it was right.** Gating in the root layout by
returning a notice in place *looked* correct and was not: Next renders a page in
parallel with its layout, so a suspended workspace still streamed its entire
client list — names, emails, phone numbers — inside the payload of a screen that
read "on hold". Redirecting instead of rendering did not fix it either; the page
had already been streamed, so the 307 carried 101KB of client data in its body.

The gate now sits at the **data layer**: `requireOrgId()` refuses a workspace
that is not ACTIVE, so nothing is fetched at all and there is nothing to stream.
The layout redirect stays on top, for the notice.

Worth being accurate about what this was: a suspended customer able to pull
*their own* data over raw HTTP — a billing-enforcement gap, not a cross-tenant
leak. It matters, and it is not a breach.

Verified: a live session on a workspace suspended mid-session gets 307 with zero
client emails and zero client names in the body, lands on the notice, and the
other tenant is unaffected throughout.

### Step 6a — plans, subscriptions, and an identity above the tenants
`Subscription` (tenant-scoped), `PlatformAuditLog` (not tenant-scoped — it is a
record *about* organizations), `User.platformRole`, and `src/lib/plans.ts` as the
single source of what each plan costs and allows.

`platformRole` is deliberately **not** a value in `Roles`. `OWNER` there means
"owns this cleaning company"; one widened check would have handed a customer the
keys to every other customer's data.

### Step 6b — the console
`/console`, served at `platform.useawer.com`. Eight screens over real data:
overview, workspaces, one workspace in full, trials, billing, audit log, staff
access, system health.

**Reads** go through `src/lib/console/queries.ts` — the only module besides
`platform-db.ts` allowed to see across organizations, and read-only. Grouped
queries, never one per workspace: the workspace list is five `groupBy` calls
assembled in memory, and it is wrapped in React `cache()` so the rail, the table
and the attention queue share one set of results and cannot disagree with each
other.

**Writes** go through `src/lib/console/actions.ts`. Four rules hold for every
action without exception:

1. It begins with `requirePlatformStaff()` naming its minimum role. No action
   trusts that the page already checked — a page guard protects a page, and an
   action can be called directly.
2. It writes a `PlatformAuditLog` row after the change succeeds.
3. It refuses to touch Awer's own workspace. Suspending ourselves would lock the
   console out of the console.
4. It returns a result object rather than throwing, so the UI can say what went
   wrong instead of showing an error page.

Roles are enforced, not decorative: `SUPPORT` reads everything and changes
nothing, `ADMIN` adds plans/seats/trials/suspend, `OWNER` adds staff access.

**Four things the adversarial pass changed:**

- `if (plan in PLANS)` → an explicit allowlist. `"__proto__" in PLANS` is true,
  and every argument here arrives from a browser with its TypeScript type erased.
- Same for the staff-role argument, which would otherwise have reached a Prisma
  enum update as an arbitrary string.
- The suspension reason is stored verbatim in the audit log, so it is capped.
- **`setStaffRole` now requires the target account to live in the platform
  workspace.** Without it, a mistyped id could have granted the keys to every
  customer on Awer to a cleaner's or a customer's login — an account nobody at
  Awer controls.

**Deliberately not built yet, and said so on the page rather than faked:**
signing in as a customer (needs a single-use short-lived link, a banner the
customer can see, and a record at both ends — its own pass), export and delete
in the danger zone, and the uptime/error/cron panels on system health. The
isolation panel there is real: every line is a live `pg_catalog` query, because a
green tick someone typed into a template is worse than a blank space.

Routing: `/console/*` uses the staff sign-in door; platform staff land on
`/console` after signing in, read from the database rather than the session,
since `platformRole` is not in the session payload. A signed-in non-staff user is
sent to their own home, not made to retype a password that was never the problem.

Verified: `tsc --noEmit` clean, `next build` clean with all eight routes dynamic,
eslint clean. Not exercised against a database — production lacks the
`organizationId` columns entirely, so the console can only be run against
staging, which is the standing rule anyway.

### Step 6c — a company can sign itself up
`/get-started`. Pick a plan, name the company, claim an address, create the
owner account. `provisionOrganization()` does the rest in one transaction, so a
half-made workspace cannot exist.

**No card is taken.** The trial is 30 days and the agreed answer was "one month,
limited features", so signup ends in a working workspace, not a checkout. Card
capture belongs with the Stripe work in step 7, and the console already shows
who has no card on file.

**The handoff between hosts is the interesting part.** Signup runs on one host
and the workspace lives on another, and a session cookie set on `www` can never
apply to `<slug>.useawer.com`. Rather than pretend otherwise, signup finishes by
handing over the address; the owner signs in at their own door, with the email
carried across so they type one thing rather than two.

`workspaceOriginFor()` derives that address from the host the request arrived
on, not an env var, so it is correct in every environment at once — and it
returns null where subdomains cannot work (a `*.vercel.app` build URL) so the
caller shows text instead of a link that would not resolve. Checked against
nine hosts, including a round-trip back through `orgSlugFromHost()`: the URL
signup hands out resolves to the slug it was built from.

**Two problems found reading it back:**

- `findFreeSlug()` made one query per candidate — up to 50 round-trips. Fine
  when only a script called it; not fine behind an unauthenticated form. Now one
  prefix query, chosen in memory.
- The address-availability endpoints had no ceiling at all. They do now, at a
  much higher limit than signup itself, because a real visitor types and retypes.

Throttling is honest about what it is: the per-address window is in memory, so
it covers one instance and resets on deploy. The global hourly cap is a database
count, so it holds everywhere. A durable per-address limit needs shared storage
and is worth doing when signup volume is real.

`/get-started` sits outside the tenant gate in the root layout, alongside the
unavailable notice. Signup belongs to Awer, not to any one workspace, so a
visitor creating a company must not be turned away because the host they landed
on has no workspace behind it.

Reuses the sign-in page's shell and form controls rather than inventing a second
visual language for the same audience. Plans, prices and cleaner caps are read
from `lib/plans.ts` — the same definition that enforces them — because a pricing
page that can drift from what is enforced is a promise nobody kept.

Left: the Organization tier says plainly that it is arranged rather than bought
and that the request form is next, instead of linking to a page that does not
exist. No welcome email — that waits for per-organization email URLs in step 7.

### Step 6d — the Organization tier can be asked for
`20260826120000_access_requests` — **applied to staging 2026-08-26.** One enum,
one table, three indexes. The SQL was hand-written and then diffed against
`prisma migrate diff` run offline from the previous schema: byte-identical apart
from the comments and the revoke.

```bash
# staging only, from .env.local
DATABASE_URL="$STAGING_DATABASE_URL" DIRECT_URL="$STAGING_DIRECT_URL" \
  npx prisma migrate deploy

# 9 checks, including the one that matters
DATABASE_URL="$STAGING_DIRECT_URL" npx tsx scripts/verify-access-requests.ts
```

Verified on staging: exactly the 17 expected columns, the enum, the three
indexes, **`awer_app` holds no privilege on the table at all** — and, as a
contrast so that pass cannot just mean "that role has nothing anywhere", the same
role still reaches `Subscription`. No RLS, deliberately. A probe row defaults to
PENDING and was removed.

Production re-checked immediately after and is unchanged: **0 `organizationId`
columns, 0 tables with RLS, 0 multi-tenant tables**, and `_prisma_migrations`
still 90 rows / 87 finished / 3 rolled back — the same May attempts recorded at
the top of this file.

`AccessRequest` is platform-level like `PlatformAuditLog`: prospective
customers' names, emails and phone numbers, belonging to no workspace. So it
gets **no RLS policy and a revoked grant** — deliberate, not an omission. RLS
keys off `organizationId` and this table has none; the protection is that
`awer_app` cannot touch it at all, and only the console's platform client can.

Public form at `/get-started/organization`, separate from signup because it ends
somewhere else: signup ends in a working workspace, this ends in a conversation.
Three required fields — company, contact, email — because every extra required
box costs a conversation with a company that was ready to have one. A honeypot
field answers bots with "thanks, we'll be in touch" rather than a rejection, so
a script gets no signal to tune against.

Console queue at `/console/requests`, ordered by **how long each has waited**,
oldest first, with the wait on every card and past three days in red. Sorting by
newest would bury exactly the request that has been ignored longest. The count
also reaches the rail and the overview headline, because a company sitting
unanswered is worth the same weight as a failed payment.

**Approving creates the workspace in the same action.** Two separate steps —
mark approved, create later — is the failure that leaves a customer waiting on
something everyone believes already happened. The staff member confirms the
address (editable, since what was asked for is not always what it should be),
and gets a random first password shown once, stored only as a hash, paired with
`mustChangePassword` so the owner replaces it immediately. That flag is set here
rather than inside provisioning: a company that signs itself up chose its own
password and should not be asked to change it.

Nothing is emailed to the requester at either decision, and the console says so
rather than implying otherwise.

### Step 6e — the cleaner cap actually bites
Until now the limit was a number on a pricing page. `lib/seat-rules.ts` holds
what a seat *is* (pure), `lib/plan-limits.ts` holds the check that needs a
database.

**The console and the app import the same definition of a seat.** If those two
ever disagreed, a customer would be blocked at four of five or allowed a seventh
— and the screen showing the number would be the last place anyone looked.

**Hiring is not the only way to use a seat**, which is what makes this more than
one `if`. Reactivating a login, converting an applicant, restoring an archived
person and promoting someone into the cleaner role each take one, and each lives
in a different action under a different name. `takesASeat(before, after)` decides
from state rather than from what the operation is called, so the paths cannot
drift apart. Ten cases exercised offline, including the two that would have hurt:
re-saving an unchanged cleaner must **not** consume a seat (otherwise every edit
is blocked at the cap), and promoting a cleaner to admin must **free** one.

Six paths enforce it: create employee, hire applicant (all three of its paths),
edit employee, bulk activate, CSV import, BookingKoala import.

**The two importers are checked once for the whole batch, not per row.** The CSV
importer runs rows concurrently, so per-row checks would each read the same
"seats used" and all conclude there was room; and seat usage is cached per
request, so a sequential loop would keep reading the count from before its own
first insert. Both count only rows that would create someone new, so re-importing
a file of people who already exist is not refused as though it added anyone.

Deactivating frees a seat; soft-deleting frees a seat. That is deliberate — an
admin at the cap can let someone go without destroying the history attached to
them. Admins, owners and ops managers are not cleaners and never count, so hiring
an office manager is never blocked.

The employees page warns at two seats remaining rather than always, because a
banner that is always there is a banner nobody reads on the day it matters. Every
refusal says what to do — deactivate someone who has left, or move up a plan —
since a limit that only says "no" sends someone to support to be told the same
thing more slowly.

### Step 7a — links, scheduled work and SMS belong to a company, not a deployment
Stripe deliberately set aside; everything else in step 7 that does not depend on
it.

**Absolute links in emails.** 67 call sites built every "View this booking",
"Rate your cleaning" and password reset from one environment variable. One
variable names one company, so a second tenant's customers would have received
links into the first tenant's workspace — clicked, they land on a login screen
for a company they have never heard of. All 67 now resolve the organization they
belong to. The derivation reuses `workspaceOriginFor()` from the signup handoff
rather than being a second copy of it, and needs **no new configuration**: the
existing `NEXT_PUBLIC_APP_URL` already yields the right root. Ten configurations
checked, including a bare domain, a trailing slash, localhost, and a Vercel build
URL where subdomains cannot work and it must fall back rather than emit a dead
link.

**Scheduled work.** The four cron jobs queried the whole table with the raw
client. Under RLS that now returns *nothing* — it fails closed, which is the
right way round, but the reminders stop. They run once per active organization
instead. One company's failure is caught and reported without stopping the rest:
a run that aborts half way leaves every remaining company without its reminders
that day, and the cause is usually specific to one workspace's data.

**The seam that made this small.** Rather than thread a client through every
helper, `runAsOrg()` announces the organization and `@/lib/org-db` was taught to
consult that announcement before the request host. So helpers defined at module
scope — which cannot be handed a client as an argument — are scoped without being
touched. Each cron route changed by one import and one wrapper.

**SMS.** `20260826140000_org_sms_number` — **applied to staging.** Outbound now
sends from the company's own number; inbound routes *by the number the message
arrived on*, because that is the only thing Twilio tells us about who was meant.
Matching the sender's phone first would have been the bug: two cleaning companies
can share a customer, and the same mobile would land in whichever company's chat
was found first. `smsNumber` is UNIQUE precisely because it is a routing key.
Both columns are nullable and nothing is backfilled — a workspace without a
number falls back to the environment, so the first tenant is unaffected.

Verified on staging against two live tenants, **connected as the restricted
application role**: 11 of 11 (`scripts/verify-tenant-runtime.ts`) — the
announcement reaches the query layer, each org counts only its own 25 clients,
one org asking for another's client *by id* gets nothing, context does not leak
between loop iterations, the two orgs produce different email addresses, and an
unowned phone number resolves to nothing rather than to a default.

**The harness was wrong before the code was.** The first run reported two
failures; the scoped reads were correct and the *control* query returned zero,
because it was pointed at the restricted role, which RLS refuses. The script now
takes a separate elevated connection and asserts up front that it can see across
organizations at all — otherwise every comparison in it is meaningless.

### Cutover rehearsal — 2026-08-27

Run against **production's real schema**, with no production data. `pg_dump
--schema-only` (0 COPY/INSERT statements, verified) plus the `_prisma_migrations`
rows, loaded into a scratch database, then filled with synthetic rows at
production's exact volume: 232 users, 966 clients, 288 jobs.

This mattered because production's schema is **not** what the migrations alone
would build — 44 of 104 tables were created with `db push` and appear in no
migration. The only way to know the pending migrations apply cleanly to what is
actually there was to try it on a copy.

| Step | Result |
|---|---|
| Create `awer_app` | instant |
| **11 pending migrations** | **2 seconds**, no errors |
| Grants + revokes | instant |

Verified afterwards: 98 tables with `organizationId`, RLS and FORCE and the
not-blank CHECK on all 98 (97 original + `Subscription` from step 6a — the "97"
elsewhere in this file predates it); TeamCleano created as organization #1;
**zero** unclaimed rows in users, clients or jobs; `awer_app` reaches `Job` and is
denied on `AccessRequest`.

Row-level security checked from the restricted role on that schema:

- no organization announced → **0** clients visible (fails closed)
- organization announced → **966** clients, **288** jobs

**The migration is not the risky part.** At this data volume it is seconds, and
it is re-runnable. The window is dominated by deploy, DNS and verification.

---

---

## ⚠️ Constraints that break with a second tenant

Found by auditing every `@unique` in the schema. **These are Step 5 work — the
schema is currently correct for exactly one organization.**

### Must become per-org (`@@unique([organizationId, …])`)

| Where | What breaks today |
|---|---|
| `PricingRule @@unique([bedCount, bathCount])` | **Only one org can ever price a 3-bed/2-bath home.** |
| `AppSetting.key` | Only one org can have settings at all. |
| `Target @@unique([metric, period, periodStart])` | Only one org can set a monthly revenue target. |
| `AlertRoutingRule @@unique([alertType, recipientRole])` | Only one org can route a given alert. |
| `ServiceArea.prefix` | Two orgs cannot both serve postal code H2X. |
| `PromoCode.code` | Two orgs cannot both run "WELCOME10". |
| `BudgetCategory.slug` | Two orgs cannot both have "supplies". |
| `LandingPage.slug` | Two orgs cannot both publish `/p/summer`. |
| `User.email` | One person cannot exist at two orgs; two orgs cannot share an admin address. Touches better-auth — go slowly. |
| `NotificationSetting @@unique([recipient, key, channel])` | Collides where `recipient` is a role rather than a user id. |

### Need per-org sequences, not global ones

- **`Job.jobNumber`** — global `autoincrement()`. Org #2's first job would be
  #265. Cosmetic but wrong.
- **`Invoice.invoiceNumber`** — same, and for invoices sequential per-company
  numbering is an accounting expectation, not a preference.

### Correctly global — leave alone

Secret-bearing or externally-owned identifiers: `ApplicantInviteToken.token`,
`ClientCardSetupToken.token`, `JobRatingToken.token`, `GiftCard.code`,
`Client.referralCode`, `Client.stripeCustomerId`,
`ClientPaymentMethod.stripePaymentMethodId`, `Job.depositPaymentIntentId`.

Composite keys anchored on an already-scoped FK (`jobId`, `employeeId`,
`channelId`, `categoryId`) are safe automatically.

---

## Scenario analysis

What breaks with a second tenant, beyond the query layer. Grouped by when it has
to be solved, not by how hard it is.

### 🔴 Must be solved before a second tenant exists

**`www.useawer.com` cannot be two things.** It is TeamCleano's customer portal
today. As a product it should be Awer's marketing and signup page. Those are
incompatible, and resolving it means TeamCleano's customers move to
`teamcleano.useawer.com` — changing bookmarks, saved links, and every URL in
every email ever sent. Needs a decision and a redirect plan, not just code.
*(Cookies are set per-host, so this also logs every existing user out once.)*

**Email links point at one host.** `NEXT_PUBLIC_APP_URL` is a single env var
used throughout `src/lib/email.ts` — "View this booking", "Rate your cleaning",
receipts, password resets. FixaroPro's customers would receive links to
TeamCleano's subdomain. Must be derived per-organization from `org.slug`.

**One Twilio number cannot serve many companies.** `api/twilio/inbound` matches
an inbound SMS by phone number across all clients. Two organizations can have
the same customer, and with one shared number there is no way to know which
company a reply belongs to. Either a number per organization, or inbound SMS
does not survive multi-tenancy.

**Sender identity is global.** One `EMAIL_FROM`, one Twilio sender. FixaroPro's
customers would get mail from TeamCleano. Per-org sender or a neutral Awer
sender with the org name in the body.

### 🟠 Before taking real money from a second tenant

**Cloudinary is one shared bucket.** Booking photos land in a single folder, and
`isBookingPhotoUrl` validates that a URL sits inside it — so org A's photo passes
org B's check. Cloudinary URLs are public to anyone holding them. Needs per-org
folders and per-org validation.

**Stripe.** Existing TeamCleano cards live on the platform account; a connected
account changes which account holds them. Needs a deliberate migration, or live
customers' cards silently stop working.

**Suspension mid-session.** `isOrgUsable()` exists but nothing calls it. A
suspended org's users currently keep working until their session expires.

**Tenant offboarding.** No export, no delete. A company that leaves has a legal
right to its data and to have it removed, and a shared database makes "delete
everything for org X" a real piece of work rather than dropping a database.

### 🟡 Watch, not urgent

- **Cross-org references.** Nothing at the database level stops a Job pointing
  at another org's Client. The scoped client prevents it in practice; RLS will
  make it structural. Worth a periodic integrity check.
- **Noisy neighbours.** One shared Postgres. Fine at single-digit tenants;
  revisit if one company gets large.
- **Backup granularity.** Backups are whole-database. Restoring one tenant to
  yesterday, without touching the others, is not currently possible.
- **PWA manifests.** The cleaner app's manifest and `start_url` are global; an
  installed icon would be Awer-branded rather than per-company.
- **Scripts.** 29 operational scripts talk to Prisma directly with no request
  context. They must name their organization explicitly.

---

## Decisions

| # | Question | Answer |
|---|---|---|
| 1 | Job / invoice numbering | **Per-org.** Every organization starts at #1 |
| 2 | Suspended organization | **Locked out entirely**, "contact billing" screen |
| 3 | Same email at two companies | **Allowed.** One person can be a customer of two cleaning companies |
| 4 | `www.useawer.com` | **Awer's marketing + signup page.** TeamCleano moves to `teamcleano.useawer.com` |
| 5 | Free trial | **One month, limited features** |
| 6 | Plan limits | **Enforced** — a Starter org cannot add a 6th cleaner |
| 7 | Inbound SMS | **A Twilio number per organization** |
| 8 | Email sender | **Neutral Awer address**, org name as display name, org address as Reply-To |
| — | Whitelabel | No. Awer branding, subdomains only |
| — | Stripe Connect account type | Still open. Express recommended; blocks Step 7 only |
| — | Real pricing | Placeholder: Starter $49 / Professional $149 / Organization custom |

**On #8:** per-org sender domains would make every tenant verify a domain and
configure SPF/DKIM. A non-technical owner gets that wrong, their mail lands in
spam, and Awer gets blamed. One warmed domain under our control has much better
deliverability, and Reply-To still routes replies to the company. The cost is
shared sending reputation, so per-org rate limits are part of this. If volume
grows, per-tenant subdomains isolate reputation without tenant DNS work.

**On #3:** this is the most delicate change in Step 5. better-auth looks a user
up with `findUnique({ where: { email } })`, which Prisma only permits while
email is globally unique. Making it per-org means that lookup has to change, so
it is sequenced last and on its own.

## Known wrinkles

- **Existing saved cards live on the platform Stripe account.** TeamCleano's
  customers have `stripeCustomerId` / `ClientPaymentMethod` rows on Awer's own
  Stripe account. When TeamCleano becomes a *connected* account those cards are
  on the wrong one. Deliberate migration required; silently failing cards on
  live customers is the failure mode.
- **Staging drifts.** It is a point-in-time schema copy reseeded with synthetic
  data. Re-sync the schema before the final production rehearsal.
- **Supabase pooler drops connections.** Seen twice. Retry rather than assume
  failure — this is why the backfill is idempotent.
- **PITR not purchased.** Deliberate: only two additive migrations ever touch
  production, both rehearsed, plus a manual dump taken minutes before each.
  Daily backups cover the rest. Revisit before anything destructive.
- **Cron jobs + real contacts.** `vercel.json` runs four crons, one every five
  minutes. Any staging deployment must omit `RESEND_API_KEY`, `TWILIO_*` and
  `CRON_SECRET` — the code already skips sending when each is absent.
- **Cleano OS tracker disagrees with "done".** `.claude/spec-runs/…/audit.md`
  still reads 82 ✅ / 138 ❌. Probably just un-updated as work landed, but worth
  confirming before assuming that scope is closed.

---

## Every company gets its own address — 2026-08-27

TeamCleano predated multi-tenancy, so `www.useawer.com` *was* their application.
That stopped being tenable the moment anyone could sign up: a cleaning company
arriving at the product's home page would be shown another company's booking
form. So the bare domain became Awer's front door, and TeamCleano became a
tenant like everyone else.

Decided with the customer beforehand: **nobody outside TeamCleano is using the
app yet** — no customers have signed in, so there are no live links in anyone's
inbox and no search ranking to preserve. That is what made a single clean cut
safe instead of a staged migration with redirects held open for months.

| Address | Before | Now |
|---|---|---|
| `useawer.com`, `www.` | TeamCleano's app | Awer's front door → `/get-started` |
| `teamcleano.useawer.com` | (nothing) | TeamCleano's app |
| `<slug>.useawer.com` | (nothing) | that company's app |

Paths are unchanged — `/sign-in` → `/admin`, `/cleanos/login` → `/cleaners`,
`/login` → the customer portal. Renaming them would have broken every cleaner's
bookmark and phone home-screen icon to gain nothing anyone outside the company
ever sees.

**What the front door serves is an allowlist**, not a denylist:
`/get-started`, `/console`, `/sign-in`, `/workspace-unavailable`, `/design`.
Everything else is some company's application and is forwarded away. The
allowlist is the point — with a denylist, every route added from here on would
be served on the front door by accident, backed by Awer's own workspace, and
someone would eventually find `useawer.com/admin` offering to add a cleaner to
it.

`LEGACY_ORG_SLUG` forwards old bookmarks from the bare domain to that company
(307, deliberately temporary — a cached permanent redirect would outlive the
setting). Clear it once the bookmarks have died out.

Rollback is a single environment variable: setting `DEFAULT_ORG_SLUG` back to a
company slug restores the previous behaviour completely, guard included, with no
deploy.

### Three bugs this turned up

**Awer's console leaked every customer's name to any customer's admin.** The
console layout refuses a non-staff visitor and redirects — and Next renders a
layout and its children *in parallel*, so the page underneath had already run
its queries and had its output flushed into the body of that same redirect. The
browser navigated away; the bytes had gone. Nothing in the database was wrong
and no query returned the wrong rows. Fixed at the query layer rather than the
layout: `src/lib/console/queries.ts` is the only module besides platform-db that
reads across organizations, so every cross-org read now asserts platform staff
itself. Guarding the layout again would have fixed this page and lost to the
next one somebody added. Covered by `scripts/verify-console-isolation.ts`, which
was checked by disabling the guard and watching it go red.

**Sign-in redirects lost the company.** `teamcleano.useawer.com/admin` bounced
to a sign-in page on a different host, where the session does not exist —
signing in there did nothing. `new URL(path, request.url)` was the cause: Next
does not guarantee the URL a proxy sees carries the public host. The identical
mistake had already broken sign-in once in `/api/post-signin`.

**`setup-app-role.sql` could take production offline.** A Postgres role belongs
to the *server*, not a database, so running the script against a scratch
database — a rehearsal, a restored copy, a second deploy without the original
password to hand — rotated the live application's password out from under it.
Nothing errors; every request just starts failing with "authentication failed",
which reads like the database is down. It happened locally during the cutover
rehearsal. The script now leaves an existing role's password alone unless asked
with `-v rotate_password=yes`, verified on a throwaway server.

### Production environment variables

```
DEFAULT_ORG_SLUG=platform        # or omit — this is now the default
LEGACY_ORG_SLUG=teamcleano       # clear once old bookmarks have died out
APP_ROOT_DOMAIN=useawer.com
```

Still needed outside the code: wildcard DNS (`*.useawer.com`), the wildcard
domain on Vercel, and the `platform` organization plus a staff account.

### Checked

`npx tsx scripts/verify-host-routing.ts` — 38 checks, pure functions, no
database. Plus, against local Docker at real request level: sign-in on a tenant
host lands on that host's dashboard; a session minted for one company shows
neither its own nor the other company's clients on a second company's address;
the console gives a customer's admin nothing and still renders for staff.

---

## Going live — the ordered cutover

The order matters and is not obvious. Two migrations REVOKE privileges from
`awer_app`, and a REVOKE naming a role that does not exist is an error — so the
role must be created BEFORE the migrations. Tables created BY a migration have
no grants for that role — so the grants must be applied AFTER them.

Rehearsed against production's real schema (a structure-only dump, no customer
rows) on 2026-08-27: all pending migrations applied in **2 seconds**, and again
in 2 seconds after the Stripe columns were added. The database step is not the
risky part of this.

### Before the window — nothing changes yet

1. **Buy point-in-time recovery** on the Supabase project. Daily backups are not
   enough for a one-way migration. This is the only item here that cannot be
   fixed afterwards.
2. **Wildcard DNS**: `*.useawer.com` → Vercel.
3. **Add `*.useawer.com`** as a domain on the Vercel project.
4. **Generate the secrets key** and keep it somewhere durable —
   `openssl rand -hex 32`. Lose it and every stored Stripe credential becomes
   unreadable (the app fails closed and asks for re-entry, but it is a bad day).

### The migration and the deploy are ONE step, not two

**Do not apply the migrations in advance to "get them out of the way".** They
must land within minutes of the new code, and here is why.

Every tenant table gets `organizationId TEXT NOT NULL DEFAULT ''` plus a CHECK
that it is not blank. The code running in production today has no idea the
column exists — `origin/main` contains the string `organizationId` exactly zero
times — so its inserts take the empty default and are refused:

```
ERROR: new row for relation "Client" violates check constraint
       "Client_organizationId_not_blank"
```

Reads keep working. Only writes fail. So the site looks completely normal while
quietly refusing to save a booking, a client, a clock-in or an invoice — which is
the worst way for an outage to present, because nobody notices for an hour.

Verified against the rehearsal copy of production's schema on 2026-08-27 by
inserting a row the way the live code does. It failed, as it should.

**What this means for the window:**

- Writes are broken from the moment `migrate deploy` finishes until the new code
  is serving. That gap is however long a Vercel build takes — two to five
  minutes.
- Pick a genuinely quiet hour. For TeamCleano that is the middle of the night in
  Canada.
- **Pause the cron jobs** for the window, or a nightly run lands mid-gap and
  fails half way through a payroll period.
- Have the deploy queued and ready to promote BEFORE running the migration, so
  the gap is the promote, not the build.

There is no way to make this zero without splitting every CHECK constraint into
a second migration, and those constraints are the thing keeping unclaimed rows
out of the database. A few minutes at 3am is the cheaper trade.

### The window

Set `PROD` to the elevated (postgres) connection string, not the pooler.

```bash
# 5. A restore point you chose, rather than one you hope exists.
#    Note the PITR timestamp before touching anything.

# 6. The restricted role the app will connect as. BEFORE the migrations.
psql "$PROD" -v ON_ERROR_STOP=1 -v pw='<a new strong password>' \
  -f scripts/setup-app-role.sql
#    Safe to re-run: it will not change an existing role's password unless
#    asked with -v rotate_password=yes.

# 7. The schema. ~2 seconds.
DATABASE_URL="$PROD" DIRECT_URL="$PROD" npx prisma migrate deploy

# 8. Grants for the tables the migrations just created. AFTER them.
psql "$PROD" -v ON_ERROR_STOP=1 -f scripts/setup-app-grants.sql

# 9. Awer's own workspace and your staff login.
DATABASE_URL="$PROD" npx tsx scripts/seed-platform.ts \
  --email you@awer.com --name "Your Name" --password '<a strong password>'
```

10. **Environment variables on Vercel**, then deploy:

| Variable | Value | Why |
|---|---|---|
| `DATABASE_URL` | the **`awer_app`** connection string | row-level security is decorative under a role that can bypass it |
| `PLATFORM_DATABASE_URL` | the elevated string | the console has to read across companies |
| `DEFAULT_ORG_SLUG` | `platform` | the bare domain is Awer's front door, not a customer's app |
| `LEGACY_ORG_SLUG` | **leave unset** | see below — the old address is a clean break, not a forward |
| `APP_ROOT_DOMAIN` | `useawer.com` | how links in emails are built for each company |
| `STRIPE_ENV_ORG_SLUG` | `teamcleano` | binds the existing Stripe key to the one company it belongs to |
| `SECRETS_KEY` | the value from step 4 | encrypts credentials companies paste into Settings |

### The old address is a clean break — decided 2026-08-27

`LEGACY_ORG_SLUG` exists and is deliberately **not set**. The code can forward
old bookmarks from the bare domain to the company that used to live there, and
the customer chose not to.

The reasoning is sound: a forward that works forever is a migration that never
finishes. Everyone keeps using the old link, it can never be switched off, and
the "temporary" redirect outlives the person who added it.

So `useawer.com` is Awer's front door only. TeamCleano's team use
`teamcleano.useawer.com` and nothing else. That is a decision to communicate,
not a technical fallback — the team has to be told before the cutover, not
discover it.

Consequence worth knowing: a cleaner opening a stale bookmark lands on Awer's
signup page, which will not mean anything to them. If that turns out to bite,
the fix is either setting `LEGACY_ORG_SLUG=teamcleano` (one variable, no deploy)
or a short "this has moved" page on the front door.

### Afterwards, in a browser

- `useawer.com` → Awer's marketing page (not a customer's login)
- `useawer.com/sign-in` → your staff account → `/console`
- `teamcleano.useawer.com/sign-in` → TeamCleano's admin
- `teamcleano.useawer.com/cleanos/login` → a cleaner
- `useawer.com/admin/dashboard` → forwards to `teamcleano.useawer.com/admin/dashboard`
- Console → Health: every workspace ACTIVE, no unclaimed rows

Everyone signs in again once. A session on `www.useawer.com` is not sent to
`teamcleano.useawer.com` — that is the same rule that stops one company's login
reaching another's, so it is working as intended. Warn the team the day before.

**Do not run the verify suites against production.** They write probe rows;
`assertSafeTarget` refuses production for exactly that reason, and the refusal
is the feature.

### Rollback

`DEFAULT_ORG_SLUG=teamcleano` restores the previous behaviour completely —
the front-door guard, the forwarding, all of it — with no deploy and no schema
change. The added columns are nullable and unread by the old code, so they can
sit there harmlessly until you try again.

### Not covered by this, and known

- **The maintenance scripts now refuse to run.** They were written when there
  was one company, so a query like `updateMany({ where: { status: "COMPLETED" }})`
  meant "this company's rows" and now means everybody's. Rather than half-convert
  two dozen mostly-historical repairs, every one that can reach the database
  stops on a multi-tenant database and says why (`scripts/_scope.ts`).

  Verified by running all 24 against the local multi-tenant database: 21 refuse.
  The other three cannot reach it — two take a CSV or are pure logic, and
  `probe-awer-fixes-4` has been unable to load since before this work (it pulls
  in `src/lib/metrics.ts`, which imports the `server-only` package that Next
  aliases away and npm never installs).

  To bring one back: give its queries an `organizationId` using `scopeWhere()`
  and swap `refuseOnMultiTenant()` for `requireScriptScope()`, which takes
  `--org <slug>` or an explicit `--all-orgs`. `importBookingKoala` is the one
  most likely to be wanted — it is how a new company's history would come across
  from another system.
- **Cloudinary uploads share one folder** across companies.
- **44 of 104 tables are in no migration** — they were created by `db push`, so
  the migration history cannot rebuild this schema from scratch. It applies
  cleanly ON TOP of the real schema, which is what was rehearsed and what
  matters here.
- **A real card payment has never been taken end to end**, because local has no
  live Stripe key. The routing is proven; the charge is not.

---

## Runbook

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"

# staging connection (NEVER substitute production)
S=$(grep -E '^STAGING_DIRECT_URL=' .env.local | cut -d= -f2- | tr -d '"')
echo "$S" | grep -q udgbixmlyqsoalvrjbgo || echo "ABORT: not staging"

# reseed from scratch
psql "$S" -c 'TRUNCATE TABLE ... RESTART IDENTITY CASCADE;'   # all but _prisma_migrations
DATABASE_URL="$S" npx tsx scripts/seed-tenant.ts --slug teamcleano-demo --name "TeamCleano Demo"
DATABASE_URL="$S" npx tsx scripts/seed-tenant.ts --slug fixaropro-demo  --name "FixaroPro Demo"

# login: owner@<slug>.test / StagingPass123!

# verify production untouched
P=$(grep -E '^DIRECT_URL=' .env | cut -d= -f2- | tr -d '"')
psql "$P" -tAc "select count(*) from information_schema.columns
                where table_schema='public' and column_name='organizationId';"   # expect 0
```
