# Admin Settings — Progress Tracker

Living tracker for making the BookingKoala-spec settings **admin-editable** (per
[Admin_Settings_Roadmap.md](Admin_Settings_Roadmap.md)). Update statuses as work
lands. Companion to the feature docs:
[Feature_Comparison_Full.md](Feature_Comparison_Full.md) ·
[Admin_Settings_Roadmap.md](Admin_Settings_Roadmap.md).

**Legend**
| Mark | Meaning |
|---|---|
| ✅ | Done — wired to the admin Settings UI, type-checks + builds |
| 🟡 | Partial — some pieces in, work remaining |
| 🔴 | Not started |
| ⏭️ | Deferred — turned out to be a feature build (Bucket C), not a settings wire |
| ⛔ | Blocked — needs a client decision first |

**Design policy** (agreed 2026-06-16): build new settings UI with **existing
components** (`SectionCard`, `Field`, `Feedback`, `Input`, `Button`, native
checkbox/select). Anything needing a **full custom design** is flagged 🎨 and
deferred until designs are provided.

---

## Summary

| Phase / PR | Scope | Status |
|---|---|---|
| **PR0** | Settings spine (registry + read/write + audit) | ✅ |
| **PR1** | Cancellation fee + window | ✅ |
| **PR2** | Referral discount + referrer credit | ✅ |
| **PR3** | No-show fee + accept/decline timeout | ✅ |
| **PR5** | Gift-card tiers (min $150) | ✅ |
| **PR6** | Recurring horizon | ✅ |
| **PR4** | Provider pay % + data visibility | 🟡 (phone toggle ✅; rest ⏭️/⛔) |
| **PR7** | Store currency | ✅ (setting only; charges already CAD) |
| **Phase 2** | Bucket-C feature builds (minor-design first) | 🟡 in progress |
| **Final** | Runtime test pass of every setting | 🔴 |

---

## Settings spine (PR0) ✅

Foundation all settings build on. **No behavior change.**

- `src/lib/settings/registry.ts` — typed registry: key, category/tab, default, validator, audit flags. Pure module (UI-safe).
- `src/lib/settings/index.ts` — `getSetting` / `getSettings` / `writeSetting` with 30s cache + invalidation. Always falls back to the registry default (never $0/free on error).
- `src/app/(app)/actions/updateAppSetting.ts` — routes registry keys through validation + audit (`ActivityLog`, action `setting.update`, sensitive flag); legacy passthrough untouched for the 22 existing tabs.
- Store: existing `AppSetting` table. Audit: existing `ActivityLog` / `logActivity`. No migration.

---

## Phase 1 — wired settings (✅)

Each row: default **= current value** so behavior is unchanged until an admin edits. Money/charge keys are audit-logged.

| Setting key | Default | Reader wired | Admin tab | Notes |
|---|---|---|---|---|
| `policy.cancellationFeeUsd` | **$20** | `portal/actions/requestCancellation.ts` | Payments & Fees | client decision: keep $20 |
| `policy.cancellationFeeWindowHours` | **48** | `requestCancellation.ts` | Payments & Fees | client decision: keep 48h |
| `customer.newClientReferralDiscountUsd` | $15 | `(book)/actions/submitBooking.ts` | Customer | |
| `customer.referrerCreditUsd` | **$10** | `submitBooking.ts` | Customer | client decision: keep $10 |
| `scheduling.noShowFeeUsd` | $25 | `actions/markNoShow.ts` | Scheduling | sensitive |
| `scheduling.acceptDeclineTimeoutMin` | 10 | `lib/invites.ts` | Scheduling | |
| `scheduling.recurringWeeklyHorizon` | 3 | `lib/booking-pricing.ts` → `submitBooking.ts` | Scheduling | weekly-cadence count |
| `payments.giftCardTiers` | **[150…400]** | `gift-card/actions/createGiftCardIntent.ts` + `gift-card/page.tsx` | Payments & Fees | **behavior change: min $150** (dropped $100) |
| `provider.showCustomerPhone` | true | `my-jobs/[jobId]/page.tsx` | Provider | gates contact card |
| `general.currency` | **CAD** | (setting only) | General | charges already CAD; no charge-path change |
| `scheduling.minLeadDays` | 1 | `getBookingConfig` → `book/page.tsx` → `Step3Schedule` | Scheduling | booking lead time; set 2 to match spec's 2-day cutoff |
| `customer.cancellationReasons` | 6 reasons | portal booking page → `RequestActions.tsx` → `requestCancellation` | Customer | required dropdown on cancel; choice logged to job activity (no migration) |
| `customer.blockedMessage` | spec text | `portal/(secured)/layout.tsx` | Customer | full-screen notice when `Client.isActive = false`; enforced at the portal gate |
| `customer.smsOptInDefault` | true | `getBookingConfig` → `book/page.tsx` → `Step4Contact`; saved by `submitBooking` | Customer | booking-form SMS checkbox default; **migration** `Job.smsConsent` added. ⚠️ consent is *captured*, not yet *enforced* in `sms.ts` (follow-up) |
| `provider.deactivatedMessage` | spec text | `(app)/layout.tsx` (cleaner branch) | Provider | full-screen notice when `User.isActive = false`. **Migration** `User.isActive` + admin toggle in Staff → Employees (`EmployeeModal` "Active account") |
| `content.faqs` | 2 samples | public `/faq` page | Website & FAQ | dynamic FAQ list, admin-managed (no migration); native accordion page |
| `website.customDomain` | "" | Website tab (display) + embed codes | Website & FAQ | stored domain; powers embed snippets. DNS routing is a separate infra step |
| `customer.liveReviewsEnabled` / `customer.liveReviewThreshold` | true / 5 | public `/reviews` page | Customer | shows ratings ≥ threshold with a written note; name as "First L." |

**PR1 customer-facing copy completed (2026-06-16):** the portal cancel modal
(`RequestActions.tsx`) and its `within-window` check now use the live
`policy.cancellationFeeUsd` / `policy.cancellationFeeWindowHours` (passed from
the booking detail server page) instead of hardcoded `$20` / `48h`.

**New Settings tabs** (admin-only, existing components): General · Customer · Provider · Payments & Fees · Scheduling. Registered in `settings/SettingsClient.tsx`.

**The one real behavior change:** gift-card minimum purchase is now **$150** (the $100 option is removed from the public buy page + rejected server-side).

---

## PR4 / PR6 — deferred or blocked items

These looked like quick wires but are **feature builds** or need a decision:

| Item | Status | Why |
|---|---|---|
| Provider default pay **40%** | ⏭️ | No constant — pay = `payMultiplier` × rating multipliers. Needs a pay-model decision, not a wire. |
| **Price** visible to cleaner | ⛔ | Pending decision (Comparison row 158). Cleaners currently see `clientTotal` in the pay breakdown. Untouched. |
| Customer **email** to cleaner | ✅ (already hidden) | Nothing to wire — not shown today. |
| **SMS opt-in default** | ✅ | Done — booking-form checkbox built + `Job.smsConsent` migration; admin toggle in Customer tab. Send-time enforcement in `sms.ts` is a follow-up. |
| **Ratings display threshold (≥4)** | ⏭️ | No review-threshold filter exists — Bucket-C feature. |

---

## ⛔ Open client decisions

| # | Decision | Current | Spec |
|---|---|---|---|
| 158 | Booking price visible to cleaner | shown | hide |
| 188 | Provider assignment method | accept/decline invites | auto-accept |

(Answered already: cancellation $20/48h · referrer $10 · gift-card min $150 · currency CAD.)

---

## Phase 2 — Bucket-C feature backlog (🔴 not started)

Real features, not settings wires. 🎨 = needs full design before build.

| Feature | Audience | Design |
|---|---|---|
| ~~Live reviews~~ ✅ | Customer | done — `/reviews` wall (`liveReviewsEnabled` + `liveReviewThreshold`); shows rated reviews with "First L." Approval-flag is a follow-up (star-threshold gated). |
| ~~FAQ / Support module~~ ✅ | Customer | done — `content.faqs` + `/faq` accordion; admin editor in Website tab. |
| ~~Embed forms~~ ✅ | Admin | done — copy-paste iframe snippets in the Website tab (existing public pages are embeddable). |
| ~~Custom domain config~~ ✅ | Admin | done — `website.customDomain` setting (display + embeds). DNS routing is separate infra. |
| French portal / i18n | Customer | ⏭️ **infra project** — every string + a translation system; not "simple UI". Dedicated effort. |
| Facebook share coupon ($15) | Customer | 🔴 needs share buttons + coupon-grant logic. |
| ~~Blocked-customer message~~ ✅ | Admin/Customer | done — `customer.blockedMessage` + portal gate on `Client.isActive`. |
| ~~Deactivated-provider message~~ ✅ | Admin/Cleaner | done — `provider.deactivatedMessage` + app-layout gate on new `User.isActive` (migration) + admin "Active account" toggle in the Employee modal. |
| Modify-quote (customer edits quote) | Customer | 🔴 quote-edit flow. |
| Provider auto-assignment | System | 🔴 logic + ⛔ decision 188 (auto-accept vs accept/decline). |
| GPS path tracking + distance unit | Cleaner | ⏭️ **infra project** — geolocation capture + storage + map. Not "simple UI". |
| ~~Cancellation reasons (list)~~ ✅ | Customer/Admin | done — configurable required dropdown; reason now sent + logged on the job. (Cancellation-reason *visibility-to-customer* toggle still a follow-up.) |
| ~~Same-day booking cutoff~~ ✅ | Customer | done — configurable `scheduling.minLeadDays` (default 1; set 2 for spec). Server hard-reject still a follow-up. |
| ~~SMS opt-in checkbox~~ ✅ | Customer | done — booking-form checkbox (default = `smsOptInDefault`); consent saved on `Job.smsConsent` (migration `20260616000000_job_sms_consent`). Enforcement in `sms.ts` is a follow-up. |
| Calendar color management | Admin | ⏭️ complex refactor (`statusMeta` across 6 files) + status-vs-type decision. Regression risk. |
| Services catalog CRUD | Admin | 🔴 model + admin CRUD + booking integration (booking uses hardcoded service types). |

---

## Final test pass (🔴 — do at the end)

No automated test suite exists in this repo. Gates used per change: `tsc --noEmit`, `eslint`, `next build`.

End-to-end manual checklist (per wired setting):
- [ ] Edit in Settings → saves, success toast, validation rejects bad input
- [ ] `AppSetting` row written; `ActivityLog` audit row for sensitive keys
- [ ] New value takes effect in the live flow (cancel fee charged, gift-card tier list, recurring count, no-show charge, phone hidden, etc.)
- [ ] With no row present, behavior matches the documented default
- [ ] Cross-check the one intended behavior change: gift-card min = $150

Current gate status (last run 2026-06-16): `tsc` ✅ 0 errors · `eslint` ✅ clean · `next build` ✅ compiled (72/72 pages).

---

## Work log

- **2026-06-16** — PR0 settings spine (registry + read/write + audit over `AppSetting`/`ActivityLog`).
- **2026-06-16** — PR3: no-show fee + accept/decline timeout → spine; new **Scheduling** tab.
- **2026-06-16** — Client decisions: cancellation **$20/48h**, referrer **$10**, gift-card min **$150**, currency **CAD**.
- **2026-06-16** — PR1/PR2/PR5/PR7: cancellation fee+window, referral discount+credit, gift-card tiers, currency → spine; new **General / Customer / Payments & Fees** tabs. Gift-card min raised to $150.
- **2026-06-16** — PR6: recurring horizon → spine (Scheduling tab). PR4: provider phone-visibility toggle → spine; new **Provider** tab. Rest of PR4/PR6 deferred as feature work. Gates green.
- **2026-06-16** — Phase 2 (minor-design): completed PR1 customer-facing copy (cancel modal fee/window now dynamic); shipped configurable booking lead time (`scheduling.minLeadDays`, default 1) through the booking wizard + Scheduling tab. `tsc` ✅ 0 · `next build` ✅ 72/72. (Pre-existing lint issues in `book/page.tsx` + `RequestActions.tsx` are not from these changes.)
- **2026-06-16** — Phase 2: cancellation reasons (`customer.cancellationReasons`) — required dropdown in the portal cancel modal (replaced the dead free-text field that was never sent); reason now passed to `requestCancellation` and logged on the job; admin editor in the Customer tab. No migration. `tsc` ✅ 0 · `next build` ✅. Fixed one pre-existing lint error in `RequestActions.tsx` while in the file.
- **2026-06-16** — Phase 2: blocked-customer gate (`customer.blockedMessage`) — deactivated customers (`Client.isActive = false`) get a configurable full-screen notice + sign-out at the portal layout instead of the portal; admin editor in the Customer tab. Deactivated-provider side deferred (no `User.isActive`). `tsc` ✅ 0 · `eslint` ✅ · `next build` ✅ 72/72.
- **2026-06-16** — Phase 2: deactivated-provider gate (`provider.deactivatedMessage`) — **migration** `User.isActive` (`prisma/migrations/20260616010000_user_is_active`, additive boolean default true). App layout shows deactivated cleaners a configurable notice; admin toggles a cleaner's "Active account" in the Employee modal (`updateEmployee`); message editor in the Provider tab. Completes the blocked/deactivated spec pair. `tsc` ✅ 0 · `next build` ✅ 72/72. (Pre-existing `any` lint in `EmployeeModal.tsx`/`employees/page.tsx` left as-is — not from this change.)
- **2026-06-16** — Both Phase-2 migrations applied to the DB via `npx prisma migrate deploy` (`job_sms_consent`, `user_is_active`). SMS consent + provider-deactivation features are now runtime-ready.
- **2026-06-16** — Phase 2 (simple-UI batch, no migration): **FAQ module** (`content.faqs` + `/faq` accordion), **custom domain** (`website.customDomain`), **live reviews** (`/reviews` wall + `liveReviewsEnabled`/`liveReviewThreshold`), and **embed codes** (iframe snippets) — all in a new **Website & FAQ** settings tab + Customer tab. `/faq` and `/reviews` are `force-dynamic`. `tsc` ✅ 0 · `eslint` ✅ · `next build` ✅. Remaining: French i18n + GPS = infra projects; services catalog / modify-quote / FB coupon = real builds; auto-assignment ⛔ decision 188; calendar colors = complex refactor.
- **2026-06-16** — Phase 2: SMS opt-in consent (`customer.smsOptInDefault`) — **first migration** in this effort: added `Job.smsConsent` (`prisma/migrations/20260616000000_job_sms_consent`, additive boolean default true). Booking form (`Step4Contact`) shows an SMS-consent checkbox defaulting to the admin setting (plumbed via `getBookingConfig`); `submitBooking` saves the choice on every job; admin toggle in the Customer tab. ⚠️ **Migration not yet applied to the DB** — run `prisma migrate deploy` before runtime testing. Consent is captured but `sms.ts` does not yet gate sends on it. `tsc` ✅ 0 · `eslint` ✅ · `next build` ✅.
- **2026-06-18** — General Store Settings batch (no migration). Added & **wired** four General-tab settings: **business name** (`general.businessName` → public site header/footer), **contact email + phone** (`general.businessEmail`/`general.businessPhone` → both portal "Need help?" tiles as real `mailto:`/`tel:` links), and **store timezone** (`general.timezone`, 7 Canadian zones). Closes Comparison rows **#12, #15, #19, #16** (timezone is the source of truth going forward; currently feeds the booking cut-off). Also shipped the **same-day server hard-reject** (#72): `submitBooking` now enforces `scheduling.minLeadDays` server-side, timezone-aware via `general.timezone`. Verified **#160/#161 gift-card minimum already enforced** (`createGiftCardIntent` rejects non-tier amounts; admin page is display-only). `tsc` ✅ 0 · `next build` ✅.
- **2026-06-18** — Cancellation-reason visibility (#45) + **privacy fix**. Added structured `Job.cancellationReason` (migration `20260618000000_job_cancellation_reason`, additive nullable); saved by `requestCancellation` (customer) and `cancelJobByAdmin` (admin) and shown to the customer in the portal booking detail (pending banner + a cancelled banner). **Found & fixed a leak**: the portal Activity feed rendered *raw* `jobLog` descriptions — including internal notes like "no card on file — collect $20 fee manually" and admin free-text notes. The feed now shows only customer-safe lifecycle events (CREATED/STATUS_CHANGED/PAYMENT_RECEIVED/INVOICE_SENT/CLOCKED_IN/CLOCKED_OUT) with curated labels, never raw descriptions. ⚠️ Run `prisma migrate deploy` before runtime test. `tsc` ✅ 0 · `next build` ✅.
