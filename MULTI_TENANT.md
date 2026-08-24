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
| 5 | Enforce — `NOT NULL`, RLS, and the constraint fixes below | ⬜ |
| 6 | Platform layer — super admin, signup, plans, provisioning | ⬜ |
| 7 | Second real tenant + Stripe Connect | ⬜ |
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

## Open decisions

| # | Question | Status |
|---|---|---|
| 1 | Stripe Connect account type — Standard / **Express** (recommended) / Custom | deferred by Prem |
| 2 | Do you take a cut of tenant transactions, or subscription revenue only? | open — decides #1 |
| 3 | Real pricing. Placeholders: Starter $49, Professional $149, Organization custom | placeholder |
| 4 | Signup: two self-serve tiers; "Organization" is request-access via form | ✅ confirmed |
| 5 | Super admin sits **above** all orgs, separate from the `Roles` enum | ✅ agreed, not built |
| 6 | Whitelabel | ❌ no — Awer branding, subdomains only |

---

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
