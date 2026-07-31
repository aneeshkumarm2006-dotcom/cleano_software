# Cleano OS — Spec Build Handoff

**Spec:** `Cleano_OS_Additional_Software_and_CRM_Updates.pdf` — 19 features (9 Software Updates + 10 CRM), extracted to **208 atomic requirements**.
**Last updated:** 2026-07-30

> ### 👉 Picking this up? Jump to [ASSIGNED — three tasks](#-assigned--three-tasks-start-here).
> Task 1 (promo codes) is customer-facing and costing money today: customers are quoted a discount and charged full price.
>
> Two things to know before you touch anything:
> - **`.env` is PRODUCTION.** Small dataset, but live customer data.
> - **Migrations do NOT run on deploy.** `prisma migrate deploy` is manual, and must run *before* pushing code that needs the new schema.

## Read these first

| File | What's in it |
|---|---|
| `.claude/spec-runs/cleano-os-2026-07-30/requirements.md` | All 208 requirements, IDs, priority, type. The contract. |
| `.claude/spec-runs/cleano-os-2026-07-30/audit.md` | Per-requirement status with `file:line` evidence, plus the dated work log. **The detailed source of truth.** |
| `.claude/spec-runs/cleano-os-2026-07-30/UNDERSTANDING.md` | Scope, open questions, conflicts, build plan. |
| This file | Practical summary: what's done, what's next, what's blocked. |

**ID scheme:** `CLN-<P0|P1|P2>-<feature#>-<bullet#>`, e.g. `CLN-P0-1-04`.

## State of the branch

- All work is **uncommitted in the working tree**, on `main`. **Code is not pushed or deployed yet.**
- **One migration created and APPLIED TO PRODUCTION:** `20260730120000_booking_payment_binding`. `npx prisma migrate status` → **58 migrations, "Database schema is up to date"**. Verified: both columns exist and are nullable, `Job_depositPaymentIntentId_key` is UNIQUE, `Job_stripePaymentMethodId_idx` exists.
- ⚠️ **The database is therefore ahead of the deployed code.** That is the safe direction — the new column is nullable and additive, so the currently-live code simply ignores it. **Push the code when ready; no further DB work is needed.**
- Confirmed with Prem: the `DATABASE_URL` in `.env` **is production**. It holds ~14 jobs / 1 archived. The larger archived-job counts in `AWER_FIXES.md` are historical — those rows were destroyed by an old hard-delete bug (see the comment at the top of `src/app/admin/actions/deleteJob.ts`), not moved elsewhere. **Treat this database as live customer data.**
- Verify with: `npx tsc --noEmit` (clean) and `npm run build` (exit 0). Both pass as of this handoff.
- The working tree also contains substantial unrelated changes from a prior effort (the Awer fix lists). Don't assume every modified file is from this spec.

**Roughly 52 of 208 requirements are satisfied** — the audit's baseline was 30 already-built, plus 22 completed in this effort.

---

# ✅ DONE

## Payment security hardening (no migration)

Driven by a threat model of the public booking flow. **These were live vulnerabilities, not spec gaps.**

| What was wrong | Fix |
|---|---|
| **Free bookings.** `submitBooking` is public + unauthenticated and every deposit field was optional. Omitting them created real `SCHEDULED` jobs — plus a whole recurring series — for free. | Verified deposit is now mandatory. In a guest flow, the paid deposit stands in for authentication. |
| **Unverified deposit intent.** `depositPaid: true` and `depositPaymentIntentId` were stamped from a client-supplied string with no Stripe contact. That id is the **refund target**, so a forged one let a refund hit a stranger's charge, and a gift-card intent could be laundered into a "paid" booking. | Verified on 12 properties: existence, `succeeded`, `amount_received`, currency, deposit metadata, email binding, livemode, not-refunded, age, customer match, prior use. |
| **Client record poisoning.** `stripeCustomerId` / `stripePaymentMethodId` were written straight from the request body onto any client matched by email — enough to repoint a victim's default card and break every future charge. | Both removed from the input type. Values now read off the verified PaymentIntent. |
| **Add-card link hijack.** `finalizeCardSetup` proved the SetupIntent succeeded but never that it was *this* client's, while the browser supplies the id. | Requires `setupIntent.customer === client.stripeCustomerId` + metadata binding at mint time. |
| **Promo trust + `maxUses` race.** | Discount re-derived server-side from the catalog; `usesCount` burned via one conditional `UPDATE`. `applyPromoCode` no longer honours soft-deleted codes. |

Also: the deposit intent is now the **idempotency key** — a retry with the same intent returns the job it already paid for. Dropped the `deduplicated` flag from the public response (it leaked whether an email had just booked).

**Files:** `src/app/(book)/actions/submitBooking.ts`, `applyPromoCode.ts`, `src/app/(book)/book/page.tsx`, `src/app/api/stripe/charge-deposit/route.ts`, `src/app/(public)/add-card/[token]/actions/*`, `src/lib/stripe.ts`

**Deploy note:** `charge-deposit` now stamps `kind: "booking_deposit"` + `email`. Intents created before this ships carry neither, so both checks tolerate absence (`type: "deposit"` still accepted; email enforced only when present). No staged deploy needed.

**Requirements:** `CLN-P0-1-01` ✅ `CLN-P0-1-13` ✅

## Customer payment methods (no migration)

New **Payment methods** subsection on `/account` — list, add card via Stripe Elements, make default, remove. Customers can now add a card themselves; previously the only route was an admin-emailed one-time link.

**Removal guards** in `src/lib/payment-methods.ts`, applied by **both** admin and customer paths. Note: the admin action previously detached the last card and *then* returned a warning — the client was already left un-chargeable. It now refuses up front.

**Expiry notifications** — new `cust.card.expiring` / `admin.card.expiring`, swept in the existing notifications cron, one warning per client, idempotent via `ensureNotSent`. No seeding needed: `isNotificationEnabled` falls back to `CATALOG_DEFAULTS` and both entries set `EMAIL: true`.

**Files:** `src/app/(customer)/(secured)/account/PaymentMethods.tsx`, `src/app/(customer)/actions/paymentMethods.ts`, `src/lib/payment-methods.ts`, `src/app/admin/actions/clientPaymentMethods.ts`, `src/lib/email.ts`, `src/lib/notifications/catalog.ts`, `src/app/api/cron/notifications/route.ts`

**Requirements:** `CLN-P1-7-01/02/03/04/05/08` ✅ · `CLN-P0-1-04/05/11/12` ✅ · `CLN-P0-1-14`, `CLN-P1-7-09` partial

## Booking ↔ payment binding (migration `20260730120000_booking_payment_binding`)

Two additive schema changes, both reversible with no data loss:

1. **`UNIQUE` on `Job.depositPaymentIntentId`** — makes the deposit intent the booking's idempotency key, closing the replay race two concurrent requests could otherwise win together. Postgres allows many NULLs under a UNIQUE index, so admin-created, imported and recurring child jobs (all NULL) are unaffected. `submitBooking` now catches `P2002` and returns the winning job rather than erroring or double-booking.
2. **`Job.stripePaymentMethodId`** — the card a booking is pinned to at confirmation.

**Nullable, and deliberately NOT backfilled.** NULL means "not pinned", and every charge path falls back to the client's current default — which is *exactly* the pre-migration behaviour. Existing rows therefore change behaviour not at all; only new bookings get pinned.

All five charge paths now resolve through `resolveChargePaymentMethod()` in `src/lib/payment-methods.ts`: prefer the pinned card, fall back to the client default when the job predates pinning **or when the pinned card is no longer on file** (insisting on a detached card would just fail the charge).

- `chargeJob.ts` (and `bulkChargeJobs`, which delegates to it)
- `cardHoldActions.ts` — holds land on the same card the charge will
- `markNoShow.ts`
- `requestCancellation.ts`

Removal guard upgraded: a card with upcoming bookings pinned to it **cannot be removed even when other cards exist**, because those bookings will charge that card. Both admin and customer surfaces show the count.

**Requirements:** `CLN-P0-1-07` ✅ `CLN-P0-1-08` ✅ `CLN-P0-1-09` ✅ `CLN-P1-7-06` ✅

**Rollback:**
```sql
DROP INDEX "Job_depositPaymentIntentId_key";
ALTER TABLE "Job" DROP COLUMN "stripePaymentMethodId";
```

## Correctness, permissions, chat, booking flow (no migration)

- **Inbound SMS was misfiling replies.** `api/twilio/inbound` ordered threads by message *count* while its comment said "most recent activity" — a client's chattiest old booking captured every later reply forever. Now ordered by newest message, bounded to 30 days. `CLN-P0-3-18` ✅
- **FAQ audit logging** — the editor claimed "Changes are audit-logged" and the flag was missing. `CLN-P1-4-18` ✅ (was a ⛔ conflict)
- **Admin nav ignored role entirely.** The `isAdmin` prop was passed as a bare attribute (hardcoded `true`) *and* never read, so OPS_MANAGER / FIELD_LEAD saw links to Finances, Payouts, Invoices, Settings, Clients, Contacts — all of which bounce them. Nav is now built from `user.role`; 16 gated destinations were verified one-by-one against each `page.tsx` guard. Empty sections hide. `CLN-P1-5-09` partial
- **Job chat quick messages** — all five spec messages verbatim, one tap to send, on the cleaner job page. `CLN-P0-3-06` ✅
- **Booking flow** — completed progress steps clickable (backwards only; forward would skip the validation gating Next), and step 1 has a Back control using browser history. `CLN-P1-6-01/06/07` ✅

**Files:** `src/app/api/twilio/inbound/route.ts`, `src/lib/settings/registry.ts`, `src/app/admin/Sidebar.tsx`, `src/app/admin/layout.tsx`, `src/components/JobChatThread.tsx`, `src/app/cleaners/my-jobs/[jobId]/page.tsx`, `src/app/(book)/book/page.tsx`

---

# 👉 ASSIGNED — three tasks, start here

Prem reviewed these and assigned them to you. They were deliberately **not** implemented because each changes live behaviour (billing, staff access, or the assignment flow) and wanted a second pair of eyes.

---

## TASK 1 — Make promo codes actually work 🔴 highest priority, customer-facing

**The bug:** a customer enters a promo code, the UI shows a discount, and they are **charged the full price**.

**Why:** `src/app/(book)/book/page.tsx` never passes `promoCode` into the `submitBooking(...)` call. It's on the draft (`types.ts:60-62`) and `Step5Review.tsx` validates it and subtracts it from the *displayed* total (line 158) — but it is dropped at submit. So:
- `Job.appliedPromoCode` and `Job.promoDiscountAmount` are always NULL for web bookings
- `PromoCode.usesCount` never increments
- `chargeJob.ts:37` bills `price - discountAmount` (referral credit only) and **never reads `promoDiscountAmount`**
- The recurring-cancellation win-back funnel can never register a redemption, so the retention KPI is permanently wrong

**What's already done for you:** `submitBooking` already re-validates the promo server-side against the catalog and the server-computed subtotal, and burns `usesCount` atomically with a `maxUses` guard. That code is live but **inert**, because `input.promoCode` is always `undefined`. See the block commented `5b-bis` in `src/app/(book)/actions/submitBooking.ts`.

**What to do:**
1. Pass `promoCode: draft.promoCode` in the `submitBooking({...})` call in `book/page.tsx`. That alone makes recording + `usesCount` + win-back tracking work.
2. **Then make the discount real.** Decide where it applies — the cleanest is to pass the validated promo amount into `computeBookingPrice` so it lands in `Job.price`, rather than teaching `chargeJob` to subtract a second discount field.
3. Decide whether the promo applies to recurring child jobs or only the first booking. Compare with how the referral discount is handled (children carry **only** the recurring frequency discount — see the comment around the `childPricing` block; there's a prior bug fix there worth reading first).

⚠️ **Do not ship step 1 without step 2.** Recording the code while still charging full price would burn each customer's one-use promo for a discount they never received — worse than today.

**Verify:** book with a valid code and confirm the charged amount matches the quoted total; confirm `usesCount` incremented exactly once; confirm a win-back code flips `RecurringCancellation.offerStatus` to `REDEEMED`.

---

## TASK 2 — Lock down `bulk-charge` and `logs` 🟠 access control

**The gap:** the admin area admits OWNER, ADMIN, OPS_MANAGER and FIELD_LEAD. Most sensitive pages redirect all but the first two, but these have **no guard at all**, so a FIELD_LEAD can open them by typing the URL:

- **`/admin/bulk-charge`** — charges customer credit cards in bulk 🔴
- **`/admin/logs`** — the full system audit trail 🔴

Also ungated, but probably fine — confirm with Prem: `promo-codes`, `gift-cards`, `quotes`, `documents`, `jobs`, `web-bookings`, `requests`, `time-tracking`, `job-applications`, `training-docs`, `wash-payouts`, `inventory/kits`, `inventory/rag-wash`, `recurring`, `calendar`, `dashboard`, `kpi`, `jobs/new`.

**What to do:** add the same guard the gated pages use (copy from `src/app/admin/leads/page.tsx:16-17` — redirect to `/admin/dashboard` when the role isn't OWNER/ADMIN), at minimum to `bulk-charge` and `logs`.

**Then update the nav to match:** mark those entries `adminOnly: true` in `src/app/admin/Sidebar.tsx`. The nav already filters on `user.role` and hides sections that end up empty — the `adminOnly` flags just have to stay in sync with each page's own guard. There's a comment on the `NavItem` type explaining this.

**Verify:** sign in as a FIELD_LEAD, confirm the links are gone *and* that typing the URL redirects.

---

## TASK 3 — Archived jobs still accept cleaner assignments 🟡 small

**The bug:** `src/app/admin/actions/respondToJobInvite.ts` has **no `deletedAt` check**, so a cleaner can accept an assignment for a job that's been archived. It then appears on their schedule for work that was cancelled.

Observed in production: job #1545 was archived at 23:49:34, and a cleaner accepted the assignment at 23:53:22 — four minutes later.

**What to do:** load the job's `deletedAt` in that action and refuse the response when it's set, with a clear message ("This booking is no longer active"). Check whether the same guard is missing on the *invite-sending* side too.

**Verify:** archive a job with a pending invite, then try to accept it.

---

# ⛔ Still open — questions for Prem

### Open questions from the audit
1. Is there a Twilio account with **Voice** (not just Messaging), and budget for per-minute + per-number cost? — blocks all of Feature 2.
2. "Hot Leads" — is that `/admin/leads` (booking drop-offs) or `/admin/sales` (door-to-door)? Nothing is named "Hot Leads" today. — blocks Feature 9.
3. Should cleaners lose the client's real phone entirely, or keep `provider.showCustomerPhone` as an override? (It currently **defaults to true**, which contradicts the spec.)
4. Is a single company inbox enough, or is multi-branch a real requirement? **No Branch model exists** and it's load-bearing for ~12 requirements.
5. Which ESP for marketing — extend Resend, or a provider with bounce/complaint webhooks?

---

# 🔜 TODO — ready to build, no decision needed

Ordered roughly by value. All are code-only unless marked.

### Zero-migration
- `CLN-P0-3-08` — unread-message badges for job chat on all three sides. The existing sidebar badges poll the *internal staff* chat, not job chat.
- `CLN-P1-4-01` — FAQ page inside the customer portal (public `/faq` exists; portal has none).
- `CLN-P1-4-05` — keyword search on the public FAQ.
- `CLN-P1-6-09` — booking wizard has no `popstate`/draft persistence; browser Back exits and discards answers.
- `CLN-P1-7-09` — finish: notify admin when a card is **replaced** (expiry + failure already covered).
- `CLN-P1-7-07` — let a customer choose the payment method for a *specific* booking. The `Job.stripePaymentMethodId` column now exists, so this is UI + a server action, no migration.
- `CLN-P1-8-*` — font standardization. Three parallel systems today: body forced to TT Norms Pro via `!font-tt-norms-pro`, Montserrat atoms, Manrope on customer/cleaner, Fraunces **serif-italic** accents (those are the italics the spec objects to). Also: Manrope is double-loaded (next/font + CDN) with its next/font variable never attached, and `.text-xs` is globally overridden to `line-height: 0.7rem` with sub-9px `.text-xxs`/`.text-xxxs`.

### Needs migration (batched for the end — see below)
- `CLN-P0-3-05` — chat photo attachments (`JobChatMessage` column).
- `CLN-P0-3-14` — disable messaging per booking/user.
- `CLN-P0-3-17` — admin hide/moderate a message while preserving the original.
- `CLN-P1-4-06/08/09/10/11` — FAQ categories, draft/publish, EN/FR, per-item visibility. FAQ data currently lives as a JSON blob in the `content.faqs` AppSetting; this needs real `Faq`/`FaqCategory` tables + a data migration.
- `CLN-P1-4-17` — FAQ analytics (new event tables).

### Large greenfield — architecture first
- **Feature 2 (masked calling)** — nothing exists. No voice integration, no `twilio` SDK (SMS is raw REST), no call-log model. Blocked on Q1.
- **Features 10–13 (CRM inbox, contact comms, tasks, unanswered detection)** — effectively greenfield.
- **Features 14–19 (email marketing)** — greenfield.
- **Feature 5** — the seven-section dropdown side menu restructure.

---

# 🗄️ Migration queue

## ✅ `20260730120000_booking_payment_binding` — DONE, applied to production

Applied 2026-07-30 and verified against the production database. Pre-flight was clean (0 duplicate deposit intents). **No action needed.**

Post-apply verification that was run:
```sql
SELECT column_name, is_nullable FROM information_schema.columns
 WHERE table_name='Job' AND column_name IN ('stripePaymentMethodId','depositPaymentIntentId');
SELECT indexname, indexdef FROM pg_indexes
 WHERE tablename='Job' AND indexname IN ('Job_depositPaymentIntentId_key','Job_stripePaymentMethodId_idx');
```
Result: both columns nullable, `Job_depositPaymentIntentId_key` UNIQUE, `Job_stripePaymentMethodId_idx` present.

### What still has to happen: push the code

The DB is **ahead of** the deployed code. That's the safe direction (nullable additive column; live code ignores it), so there's no rush and no breakage — but the features are inert until the code ships.

**Important for any FUTURE migration:** this project does **not** run migrations on deploy. `package.json` `postinstall` is `prisma generate` only, and `vercel.json` has no migrate step. `npx prisma migrate deploy` must be run **by hand, before** pushing code that depends on the new schema. Use `migrate deploy`, never `migrate dev` — `dev` can offer to reset the database.

### Smoke test after the code is deployed

1. Book through `/book` end to end. It should succeed, and the new job row should have `depositPaymentIntentId` **and** `stripePaymentMethodId` populated.
2. Open that client in admin → the card shows an "upcoming booking" pill, and **Remove** is refused with an explanation.
3. `/admin/logs` shows a `booking.deposit_verified` entry.

### Rollback (only if something goes wrong)

```sql
DROP INDEX "Job_depositPaymentIntentId_key";
ALTER TABLE "Job" DROP COLUMN "stripePaymentMethodId";
```
Then `DELETE FROM "_prisma_migrations" WHERE migration_name = '20260730120000_booking_payment_binding';` so Prisma stops considering it applied. No data is lost either way — the column has no backfill and nothing else reads it.

## Not yet created

- Chat columns — `CLN-P0-3-05` (attachments), `CLN-P0-3-14` (disable messaging), `CLN-P0-3-17` (hide/moderate).
- FAQ tables — `CLN-P1-4-06/08/09/10/11` need real `Faq`/`FaqCategory` tables plus a data migration out of the `content.faqs` JSON blob. Keep `faqList()` backward-compatible or existing entries are silently dropped on validate.
- FAQ analytics event tables — `CLN-P1-4-17`.
- The CRM and marketing schemas (Features 10–19) — large; design before writing.

---

# ⚠️ Landmines — know these before you build

- **No Branch / multi-location model** anywhere (91 models; only `InventoryLocation` for stock). Blocks ~12 CRM/marketing requirements.
- **No business-hours setting** — only hardcoded `BOOKING_DAY_START/END` 09:00–19:00.
- **No Task model.** `Alert` is a dismissible notification, not a task (no due date, status workflow, or creator).
- **No customer conversation model.** Comms are scattered across `EmailLog`, `ActivityLog` (SMS), `JobChatMessage`, `ChatMessage` (internal staff only), `ContactActivity` — none carry a `contactId`/`conversationId` FK. Retro-threading must join on email/phone strings.
- **No inbound email ingestion.** Resend is outbound-only.
- **Cascade deletes contradict "permanent history":** `JobChatMessage`→Job and `ContactActivity`→Contact are `onDelete: Cascade`, and `permanentlyDeleteJobs` already destroys chat history.
- **`MarketingCampaign` is an ad-spend tracker, not email marketing.** Name the new model `EmailCampaign` to avoid collision.
- **`mergeContacts` archives losers without re-parenting** their activities, links, or bookings — so "merge preserving messages/notes/bookings" is unmet today.
- **`Contact.ownerId`, `EmailLog.leadId`, `ActivityLog.actorId` are soft references** (no FK). Building assignment/permissions on them risks orphans.
- **Dead schema that looks usable:** `Complaint` and `AlertRoutingRule.escalateToRole/escalateAfterHours` exist with **zero application writers**. `notifyByRule` is implemented and never called.
- **Existing hardcoded automations must not be duplicated** by any new engine: 24h/48h reminders, never-found-provider, leave-tip, weekly/monthly digests, rating requests, recurring-cancellation win-back (which is marketing-style email with **no unsubscribe link** — a compliance exposure today), waitlist availability.
- **No rate limiting anywhere.** `/api/stripe/charge-deposit` is unauthenticated and unmetered; lead and quote submission likewise. Separate ticket.
- **`.env` points at PRODUCTION** (confirmed by Prem). It's a small dataset (~14 jobs) because an old hard-delete bug destroyed ~1533 rows — see the comment at the top of `deleteJob.ts`. Small ≠ safe: this is live customer data. Never run destructive SQL against it without a snapshot, and use the fake **"Prem Sai"** job for testing rather than real bookings.

---

# Conventions

- Server actions live under `src/app/**/actions/`; guards in `src/lib/action-guards.ts` (`requireAdmin`, `requireOwnerAdmin`).
- Audit trail: `logActivity()` in `src/lib/activity-log.ts` — never throws, safe to call anywhere. Categories incl. `PAYMENT`, `DEPOSIT`.
- Settings: `src/lib/settings/registry.ts`. Add `audit: true` to anything sensitive or the change won't be logged.
- Notifications: add to `src/lib/notifications/catalog.ts`; defaults come from the entry's `channels`, so no seeding is required.
- Money invariants: never trust prices, discounts, or Stripe ids from the client — resolve server-side. `submitBooking` and `clientPaymentMethods.ts` are the reference implementations.
- Verify every change with `npx tsc --noEmit` and `npm run build`.
- Commits: author is Prem only — **no Co-Authored-By trailer**.
