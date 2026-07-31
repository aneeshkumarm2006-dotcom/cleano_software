# Cleano OS — Understanding Report (Phase 3)
Run: 2026-07-30 · Spec: `Cleano_OS_Additional_Software_and_CRM_Updates.pdf`
Companion files: `requirements.md` (extraction) · `audit.md` (full classification table with file:line evidence)

---

## 1. Scope

- **Features parsed:** 19 (9 Software Updates + 10 CRM Development Changes) + 1 global implementation note
- **Total atomic requirements:** 208

| Bucket | Count | Share |
|---|---|---|
| ✅ BUILT | 30 | 14% |
| ⚠️ PARTIAL | 55 | 26% |
| ❌ MISSING | 110 | 53% |
| 🔍 VERIFY | 2 | 1% |
| ⛔ CONFLICT | 11 | 5% |

| Priority | Total | ✅ | ⚠️ | ❌ | 🔍 | ⛔ |
|---|---|---|---|---|---|---|
| P0 (F1-3, F10-13) + global | 99 | 16 | 30 | 48 | 1 | 4 |
| P1 (F4-8, F14-18) | 95 | 11 | 20 | 58 | 1 | 5 |
| P2 (F9, F19) | 14 | 3 | 5 | 4 | 0 | 2 |

**Headline:** job-specific chat (F3) is the only feature substantially built (12/19 ✅). Payments (F1) has real Stripe tokenization but no customer-facing surface and a server-side booking hole. Everything in the CRM half (F10-13, F14-19) is effectively greenfield — no conversation model, no task model, no consent/unsubscribe data, and no branch/multi-location model anywhere in the 91-model schema.

---

## 2. Full classification table

See **`audit.md`** — 208 rows grouped by feature, P0 → P1 → P2, each with file:line evidence or a precise gap.

---

## 3. Open questions (🔍) — each answerable in one line

1. **Twilio Voice account** — is there a Twilio account with Voice (or Proxy) enabled and a number pool available, or is telephony a net-new provider signup? *(F2 is unbuildable without this; only SMS credentials exist today.)*
2. **Cleaner phone visibility** — should `provider.showCustomerPhone` be forced to false permanently (spec-compliant), or stay admin-toggleable with masked calling as the default path? *(See Conflict C2.)*
3. **"Hot Leads" identity** — does Hot Leads mean `/admin/leads` (booking drop-offs) or `/admin/sales` (door-to-door sales leads)? *(See Conflict C7.)*
4. **Per-booking card lock** — should already-confirmed bookings truly keep charging the OLD card after a replacement, or is "default card at charge time" acceptable? *(See Conflict C1 — this changes five live charge paths.)*
5. **Branch model** — is Cleano actually multi-branch today, or should every "branch" requirement be deferred until a second location exists?
6. **Inbound email** — which mailbox should the CRM inbox ingest (and via which route: Resend inbound, Postmark, IMAP, or forwarding-address)? *(No inbound email capability exists at all.)*
7. **Email sending domain** — is `EMAIL_FROM`'s domain authenticated (SPF/DKIM/DMARC) for bulk marketing volume, or does marketing need a separate subdomain/ESP?
8. **Font decision** — confirm the global font is Montserrat (the dashboard `.display` face), and that Fraunces italic accents are removed everywhere rather than kept as brand accents.
9. **Font acceptance gate** — is a manual visual QA pass across tables/dropdowns/buttons the acceptance criterion for CLN-P1-8-08, or do you want screenshot regression tests?
10. **Pending migration** — should the unapplied `rating-exclusion` migration be applied to production before any new migrations from this spec are generated?
11. **Settings tabs → nav subsections** — may Settings tabs become URL-addressable (`/admin/settings?tab=pricing`) so the seven-section menu can deep-link them, or should those pages be split out?
12. **FAQ languages** — is French actually required now (CLN-P1-4-11), or English-only for v1 with the schema left bilingual-ready?
13. **Chat retention vs. deletion** — should permanent job deletion be blocked (or archive chat first) so chat history survives as the spec requires?

---

## 4. Conflicts (⛔) with recommended resolutions

**C1 — Per-booking card linkage vs. default-card charging** (CLN-P0-1-07; blocks 1-09, 7-06, 7-07)
The spec wants the previous card to stay attached to already-confirmed bookings. The data model has no booking↔card link; `chargeJob`, `bulkChargeJobs`, `cardHoldActions`, `markNoShow`, and `requestCancellation` all read `client.defaultPaymentMethodId` at charge time.
*Recommendation:* add a nullable `Job.stripePaymentMethodId` stamped at booking confirmation, and have charge paths prefer it with fallback to the client default. Backfill NULL (existing jobs keep today's behavior) — additive, reversible, no behavior change for live jobs until they're re-stamped.

**C2 — Cleaners currently see the client's real phone** (CLN-P0-2-12, CLN-P0-3-19)
`provider.showCustomerPhone` defaults TRUE and the cleaner job page renders a `tel:` link to the real number. The spec forbids cleaner access to the real number entirely.
*Recommendation:* ship masked calling first, then flip the default to false and gate the raw number behind an explicit OWNER-only override. Flipping before masked calling exists would leave cleaners with no way to reach clients.

**C3 — FAQ edits are not audit-logged despite the UI saying so** (CLN-P1-4-18)
`WebsiteTab.tsx:72` tells admins "Changes are audit-logged", but `content.faqs` lacks the `audit` flag so `settings/index.ts:144-160` never writes an ActivityLog row.
*Recommendation:* add `audit: true` to the `content.faqs` def — one-line fix, no migration. Note ActivityLog will then store full old/new FAQ arrays per save; consider storing a diff summary instead.

**C4 — Seven sections already exist, but not the spec's seven** (CLN-P1-5-01, 5-10)
Actual: Overview / Operations / Staff / Inventory & Supplies / Sales & Marketing / Finance / Admin. Only "Operations" and "Finance" match by name.
*Recommendation:* adopt the spec's seven names and re-home every existing page into them; treat "Inventory & Supplies" as a subsection of Operations and "Admin" as Settings. Requires a re-homing decision for ~12 pages with no spec slot (see Risks).

**C5 — "Collapse into icons" vs. off-canvas drawer** (CLN-P1-5-07)
Today `<md` is a hidden off-canvas hamburger; there is no icon-only rail at any breakpoint.
*Recommendation:* keep the mobile drawer (better on phones) and add an icon-only collapsed rail for the tablet/desktop range, which is what the spec is actually describing.

**C6 — Spec subsections that have no page** (CLN-P1-5-11)
Tasks, Hot Leads, Follow-ups, Customer Accounts, Reviews (admin), Complaints, Field Leads, Groups, Payroll, Refunds, Deposits, Add-ons don't exist; 11 more exist only as Settings tabs.
*Recommendation:* build the menu with only the subsections that resolve to real pages; Tasks arrives with F12. Do not create empty placeholder routes.

**C7 — "Hot Leads" doesn't exist under that name** (CLN-P2-9-01)
`/admin/leads` (booking drop-offs, Flame icon, under Operations) vs `/admin/sales` (door-to-door, already under Sales & Marketing).
*Recommendation:* treat `/admin/leads` as Hot Leads and move it under Sales; needs your confirmation (Question 3).

**C8 — Lead fields the spec assumes don't exist** (CLN-P2-9-02)
Spec says preserve "notes, assigned users, follow-up dates"; the `Lead` model has none of those columns.
*Recommendation:* the nav move preserves everything that exists (route is unchanged, so zero data risk). Adding notes/owner/follow-up to `Lead` is separate scope — flag, don't silently build.

**C9 — Alert is not a Task** (CLN-P0-12-04)
`Alert` has no due date, status workflow, assignee-with-completion, or creator; `AlertSeverity` (INFO/WARNING/CRITICAL) can't express Low/Normal/High/Urgent.
*Recommendation:* build a distinct `Task` model rather than migrating Alert rows; keep Alerts as notifications and let task-creating triggers emit both.

---

## 5. Build plan — ordered work packages

Dependency-ordered. Each package lists requirement IDs, expected files, and agents. Every package ends with test-engineer → code-reviewer.

### WP-0 — Foundations & decisions (blocking)
- **Covers:** CLN-GLOBAL-01, Questions 1-13, Conflicts C1/C2/C4/C7
- **Work:** confirm answers; apply or defer the pending `rating-exclusion` migration; decide the Branch question (Q5) since it gates ~8 requirements across F10/F13/F14/F16/F17.
- **Files:** none (decisions + `prisma/migrations` state check)
- **Agents:** architect (lead), database-specialist

### WP-1 — Payment security hardening (P0, highest risk)
- **Covers:** CLN-P0-1-01, 1-13 (server enforcement), 1-14, 7-08
- **Work:** verify the deposit PaymentIntent server-side in `submitBooking` before stamping `depositPaid`; require a valid saved card server-side; add ActivityLog writes to every card add/remove/set-default action.
- **Files:** `src/app/(book)/actions/submitBooking.ts`, `src/app/admin/actions/clientPaymentMethods.ts`, `src/app/api/stripe/webhook/route.ts`
- **Gate:** threat-modeler BEFORE → security-auditor + compliance-privacy-auditor AFTER (both must pass)
- **Agents:** backend-engineer (lead); support: database-specialist (no schema change expected), test-engineer, code-reviewer

### WP-2 — Per-booking card linkage (P0)
- **Covers:** CLN-P0-1-07, 1-08, 1-09, 7-06, 7-07 · **Depends on:** WP-1, C1 resolution
- **Work:** additive nullable `Job.stripePaymentMethodId` + payment-method history table keyed on the Stripe `pm_` id (not the mirror row id — the mirror is destructively re-synced); charge paths prefer job-stamped card with client-default fallback.
- **Files:** `prisma/schema.prisma` + migration, `chargeJob.ts`, `bulkChargeJobs.ts`, `cardHoldActions.ts`, `markNoShow.ts`, `requestCancellation.ts`
- **Gate:** database-specialist owns the migration (reversible, no data loss); security-auditor AFTER
- **Agents:** database-specialist (lead), backend-engineer; support: test-engineer, code-reviewer

### WP-3 — Customer payment-method management (P0/P1)
- **Covers:** CLN-P0-1-04, 1-05, 1-11, 1-12 · CLN-P1-7-01…7-05, 7-09 · **Depends on:** WP-2
- **Work:** Payment Methods section under customer Account (self-serve add/replace/set-default via SetupIntent); server-side last-card + unsettled-booking removal guard with the explanatory message; card-expiry cron notifying customer and admin ahead of upcoming bookings.
- **Files:** `src/app/(customer)/(secured)/account/*`, new customer payment actions, `src/app/api/cron/notifications/route.ts`, `src/lib/email.ts`
- **Gate:** threat-modeler BEFORE → security-auditor + compliance-privacy-auditor AFTER
- **Agents:** frontend-engineer + backend-engineer; support: prem-design-eng, test-engineer, code-reviewer

### WP-4 — Job chat completion (P0, cheapest P0 win)
- **Covers:** CLN-P0-3-05, 3-06, 3-08, 3-14, 3-17, 3-18 (+ 2-14 handoff later)
- **Work:** photo attachments; the five verbatim quick messages; unread badges on all three sides; per-booking/user messaging disable; admin hide-with-audit (`hiddenAt`/`hiddenBy`, original preserved); fix inbound SMS threading to order by recency not message count; enforce `Job.smsConsent` at send time.
- **Files:** `prisma/schema.prisma` (JobChatMessage columns), `src/lib/jobChatActions.ts`, `src/components/JobChatThread.tsx`, `src/app/api/twilio/inbound/route.ts`, `src/lib/notifications/catalog.ts`
- **Gate:** compliance-privacy-auditor on the SMS-consent change
- **Agents:** backend-engineer (lead), frontend-engineer, database-specialist (migration); support: test-engineer, code-reviewer

### WP-5 — Masked calling (P0, largest external dependency)
- **Covers:** CLN-P0-2-01…2-14 (all 14) · **Depends on:** Q1, C2, WP-4
- **Work:** Twilio Voice/Proxy integration; `CallLog` model (job link, duration, answered/missed/failed/declined); assigned-cleaner-only server guard; admin-configurable access window with auto-expiry; admin call log; flip `provider.showCustomerPhone` default after launch.
- **Files:** new `src/lib/voice.ts`, `src/app/api/twilio/voice/*`, `prisma/schema.prisma`, cleaner job page, admin call-log page, `src/lib/settings/registry.ts`
- **Gate:** threat-modeler BEFORE (PII + telephony) → security-auditor + compliance-privacy-auditor AFTER; secrets-config-auditor on new Twilio credentials
- **Agents:** architect → backend-engineer (lead), database-specialist, frontend-engineer; support: devops-engineer (env/webhooks), test-engineer, code-reviewer

### WP-6 — Conversation core: unified inbox (P0, largest CRM package)
- **Covers:** CLN-P0-10-01…10-17 · **Depends on:** WP-0 (branch decision), Q6
- **Work:** `Conversation` + `Message` models spanning email/SMS/job-chat/notes with contact FKs; inbound email ingestion; thread list with filters/search/assignment/statuses (Open, Pending, Waiting for Customer, Resolved, Closed); composer; failed-delivery alerts + resend; inbox permission set.
- **Files:** `prisma/schema.prisma` + migrations, new `src/app/admin/inbox/*`, new inbound-email route, `src/lib/email.ts`, `src/lib/sms.ts`
- **Gate:** architect designs the model first; database-specialist owns migrations; auth-access-auditor on the new permission set; compliance-privacy-auditor on stored customer comms
- **Agents:** architect → database-specialist → backend-engineer → frontend-engineer; support: test-engineer, code-reviewer

### WP-7 — Contact communication history (P0)
- **Covers:** CLN-P0-11-01…11-11 · **Depends on:** WP-6
- **Work:** attach real emails/SMS/chats/calls to contacts; chronological view with direction/recipient/status/booking; quick actions; auto-create/link contacts at lead capture and booking; merge that actually re-parents activities and links.
- **Files:** `src/lib/crm.ts`, `src/app/admin/contacts/[id]/*`, `src/app/admin/actions/contactActions.ts`, `submitBooking.ts`
- **Gate:** database-specialist owns the re-parenting backfill (reversible)
- **Agents:** backend-engineer (lead), database-specialist, frontend-engineer; support: test-engineer, code-reviewer

### WP-8 — CRM Tasks + unanswered detection (P0)
- **Covers:** CLN-P0-12-01…12-14, CLN-P0-13-01…13-09 · **Depends on:** WP-6
- **Work:** `Task` model with the exact five statuses and four priorities; list + calendar views; auto-task triggers; configurable thresholds (15m/30m/1h/4h/1 business day); Awaiting Reply + wait timers; urgent keyword list; escalation (wire up the dead `notifyByRule` + `escalateAfterHours`); dashboard/badge counts and response-time reporting.
- **Files:** `prisma/schema.prisma` + migration, new `src/app/admin/tasks/*`, `src/app/admin/actions/createAlert.ts`, new cron, `src/app/admin/Sidebar.tsx`, settings tab
- **Agents:** architect → database-specialist → backend-engineer → frontend-engineer; support: test-engineer, code-reviewer

### WP-9 — Admin navigation restructure (P1) + Hot Leads move (P2)
- **Covers:** CLN-P1-5-01…5-11, CLN-P2-9-01…9-06 · **Depends on:** C4/C6/C7 resolved; WP-6/WP-8 for Inbox+Tasks entries
- **Work:** seven spec-named dropdown sections with expand/collapse, session memory, chevrons, icon rail, three-level highlighting; centralized role→page map so sections hide when fully inaccessible (fixes the current leak where the full nav renders to every admin-area role); move Leads under Sales.
- **Files:** `src/app/admin/Sidebar.tsx`, new nav config module, `src/lib/role-routing.ts`
- **Gate:** auth-access-auditor must confirm no page loses its server-side gate (nav visibility ≠ access control)
- **Agents:** frontend-engineer (lead), prem-design-eng; support: auth-access-auditor, test-engineer, code-reviewer

### WP-10 — Booking flow back button (P1, small)
- **Covers:** CLN-P1-6-01, 6-04, 6-06, 6-07, 6-08, 6-09
- **Work:** Back on step 1 → landing; clickable completed progress steps; popstate handling + draft persistence; close the deposit-charged-before-booking-created window (defer deposit confirmation to after `submitBooking`, or reconcile orphaned PaymentIntents).
- **Files:** `src/app/(book)/book/page.tsx`, `steps/Step1PostalCode.tsx`, `steps/Step5Review.tsx`, `submitBooking.ts`
- **Gate:** security-auditor on the payment-ordering change
- **Agents:** frontend-engineer (lead), backend-engineer; support: test-engineer, code-reviewer

### WP-11 — FAQ system (P1)
- **Covers:** CLN-P1-4-01, 4-05, 4-06, 4-08…4-14, 4-17, 4-18
- **Work:** `Faq`/`FaqCategory` models migrating the existing `content.faqs` JSON; categories, search, draft/publish, duplicate/reorder, per-item visibility, EN/FR fields, preview, design editor, logo + CTA, view/search analytics; add the missing `audit: true` flag.
- **Files:** `prisma/schema.prisma` + migration, `src/app/admin/settings/tabs/WebsiteTab.tsx` (or new FAQ tab), `src/app/(public)/faq/page.tsx`, new customer FAQ page, `src/lib/settings/registry.ts`
- **Gate:** database-specialist owns the JSON→table migration with `faqList()` kept backward-compatible
- **Agents:** database-specialist → backend-engineer → frontend-engineer + prem-design-eng; support: docs-writer, test-engineer, code-reviewer

### WP-12 — Typography standardization (P1)
- **Covers:** CLN-P1-8-01…8-09 · **Depends on:** Q8
- **Work:** single global font through the design system; remove Fraunces italic accents; unify the three application mechanisms (drop `!font-tt-norms-pro`, `.admin-font`, `customer.css :root`); fix double-loaded Manrope and the unattached next/font variable; document the full typography scale; fix the `.text-xs` line-height override and sub-9px utilities.
- **Files:** `src/app/layout.tsx`, `src/app/globals.css`, `src/app/customer.css`, `DESIGN-SYSTEM.md`
- **Agents:** prem-design-eng (lead), frontend-engineer; support: docs-writer, test-engineer, code-reviewer

### WP-13 — Consent & suppression (P1, compliance-first)
- **Covers:** CLN-P1-18-01…18-08, CLN-P1-17-05 · **Must precede WP-14/15**
- **Work:** consent status enum on Contact + date/source/reason; unsubscribe route and List-Unsubscribe header; suppression lists; extend `EmailStatus` with BOUNCED/COMPLAINED; Resend bounce/complaint webhook; add unsubscribe to the existing win-back email (a live CASL/CAN-SPAM exposure today).
- **Files:** `prisma/schema.prisma` + migration, new unsubscribe route + Resend webhook, `src/lib/email.ts`
- **Gate:** compliance-privacy-auditor + security-auditor both must pass
- **Agents:** database-specialist → backend-engineer; support: compliance-privacy-auditor, test-engineer, code-reviewer

### WP-14 — Segmentation & marketing lists (P1)
- **Covers:** CLN-P1-17-01…17-04, 17-06, 17-07 · **Depends on:** WP-13
- **Agents:** backend-engineer + frontend-engineer, database-specialist for the list models; support: test-engineer, code-reviewer

### WP-15 — Email campaigns, builder, analytics (P1)
- **Covers:** CLN-P1-14-01…14-07, 15-01…15-09, 16-01…16-08 · **Depends on:** WP-13, WP-14, Q7
- **Note:** needs distinct model naming — `MarketingCampaign`/`CampaignStatus`/`Contact.campaign` are already taken by the ad-spend tracker.
- **Agents:** architect → database-specialist → backend-engineer → frontend-engineer + prem-design-eng; support: dependency-auditor (any email-builder library), test-engineer, code-reviewer

### WP-16 — CRM automations (P2, last)
- **Covers:** CLN-P2-19-01…19-08 · **Depends on:** WP-8, WP-13, WP-15
- **Note:** must absorb or coexist with the existing hardcoded crons without double-sending.
- **Agents:** architect → backend-engineer, database-specialist; support: devops-engineer (scheduling), test-engineer, code-reviewer

---

## 6. Agent routing

| Role | Assignment |
|---|---|
| **architect** | Kicks off WP-0, WP-5, WP-6, WP-8, WP-15, WP-16 (data model + API contract before code) |
| **database-specialist** | Owns **every** migration (WP-2, 4, 6, 7, 8, 11, 13, 14, 15). Each must be reversible with no data loss. |
| **backend-engineer** | WP-1, 2, 3, 4, 5, 6, 7, 8, 10, 13, 14, 15, 16 |
| **frontend-engineer** | WP-3, 4, 6, 7, 8, 9, 10, 11, 12, 14, 15 |
| **prem-design-eng** | WP-12 (lead), plus WP-3, 9, 11, 15 polish |
| **devops-engineer** | WP-5 (Twilio webhooks/env), WP-16 (cron scheduling) |
| **test-engineer** | Closes every package |
| **code-reviewer** | Final gate on every package, after test-engineer |
| **threat-modeler** | BEFORE WP-1, WP-3, WP-5 (payments/PII/telephony) |
| **security-auditor** | AFTER WP-1, WP-2, WP-3, WP-5, WP-10, WP-13 |
| **compliance-privacy-auditor** | AFTER WP-1, WP-3, WP-5; both it and security-auditor must pass on card data (WP-1/2/3) and consent (WP-13) |
| **auth-access-auditor** | WP-6 (inbox permissions), WP-9 (nav gating must not become access control) |
| **secrets-config-auditor** | WP-5 (new Twilio credentials), WP-15 (ESP credentials) |
| **dependency-auditor** | WP-15 if an email-builder library is introduced |
| **docs-writer** | WP-11, WP-12 (DESIGN-SYSTEM.md), and release notes per package |
| **infra-hardening-auditor** | Optional sweep after WP-5/WP-6 add new public webhook endpoints |
| **secrets-scanner / auth-hardening-auditor / incident-responder** | Not routed to a package; available on demand |

**Standing gates:** threat-modeler before any payments/PII/telephony work and the matching auditor after · compliance-privacy-auditor + security-auditor both pass on card data and consent/unsubscribe · database-specialist owns every migration, reversible, no data loss · test-engineer then code-reviewer close every package.

---

## 7. Risks

**Destructive / irreversible**
- Any migration on `ClientPaymentMethod` must key history on the Stripe `pm_` id, not the mirror row id — `listClientPaymentMethods` destructively deletes and recreates mirror rows on sync, so FKs to those rows would dangle.
- The unapplied `rating-exclusion` migration means new migrations stack on drift; confirm apply order before generating any.
- 831 intentionally archived jobs must never be restored or touched by any backfill.
- `JobChatMessage`→Job and `ContactActivity`→Contact are `onDelete: Cascade`; `permanentlyDeleteJobs` already destroys chat history, contradicting the spec's permanent-history requirements.

**Permission regressions**
- The sidebar currently renders the full nav to every admin-area role (`isAdmin` accepted but unused). The nav rewrite must not be mistaken for access control — server-side page gates are the real boundary and must stay.
- Gating today is copy-pasted `role !== "OWNER" && role !== "ADMIN"` per page plus `adminOnly` flags in settings; centralizing this for WP-9 risks drift between the nav config and the actual guards.

**Live booking / charging impact**
- Five charge paths read the client default card. A partial WP-2 rollout could silently change which card live jobs charge, or break auto-charging.
- Making a saved card mandatory server-side will break legacy/BookingKoala-imported clients without a `stripeCustomerId`.
- The booking flow confirms the $20 deposit *before* creating the booking — a customer who backs out in that window is charged with no booking record.

**Provider setup & cost**
- Twilio Voice/Proxy is a new product line (per-minute + per-number costs); the SMS bridge is inert until `cust.chat.new_message` is enabled and TWILIO_* env vars are set — provider dashboard config cannot be verified from code.
- Bulk marketing volume may need a separate authenticated sending subdomain and will change Resend costs.

**PII & compliance**
- Cleaners see real client phone numbers by default today.
- `Job.smsConsent` is captured at booking but never checked at send time; the inbound route has no STOP-keyword handling.
- Zero unsubscribe infrastructure exists while a marketing-style win-back email is already being sent — a present-tense CASL/CAN-SPAM exposure, not just a future one.
- A unified inbox concentrates customer PII in one searchable surface; permissions and retention need to be designed in, not added later.

---

## 8. Out of scope (and why)

- **Branch / multi-location model** — assumed by ~8 requirements but absent from all 91 models. Building it is a company-structure decision, not a spec line item; deferred pending Question 5.
- **`Lead` notes / assigned user / follow-up date** (CLN-P2-9-02) — the spec asks to "preserve" fields that don't exist. The nav move preserves everything real; adding those columns is new scope.
- **Duration recalculation** (part of CLN-P1-6-04) — no duration concept exists anywhere in the booking flow; cannot be recalculated until one is introduced.
- **Complaints, Field Leads, Groups, Payroll, Refunds, Deposits, Customer Accounts pages** — named as menu subsections but are unbuilt features in their own right; the menu will only link pages that exist.
- **Automated cross-device testing** (CLN-P1-6-08) — no test harness exists in the repo; responsive breakpoints are implemented but "tested on mobile/desktop/tablet" needs a QA process decision (Question 9).
- **Reviving the dead `Complaint` model and `AlertRoutingRule` escalation fields** beyond what WP-8 needs — they carry no data and their semantics were never exercised.
- **Migrating existing `Alert` rows into Tasks** — deliberately excluded; Alerts stay notifications (Conflict C9).
