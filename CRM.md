# Cleano Master Software Changes — Tracker

Living progress tracker for the **Cleano Master Software Changes** spec
(`Cleano_Master_Software_Changes_Developer_Spec.pdf`). Update the status as work
lands.

**Legend**
| Mark | Meaning |
|---|---|
| ✅ | Done — built in the production app |
| 🟡 | Partial — foundation exists, work remaining |
| 🟢 | Already existed in the codebase before this effort (verify, don't rebuild) |
| 🔴 | Not started |
| ⏭️ | Skipped — duplicates an existing feature |

---

## Summary

| # | Area | Status |
|---|---|---|
| 3 | Contacts / Leads CRM | ✅ (CRM-002/005/006 remaining) |
| 4 | Lead Source & True CPA | ✅ |
| 5 | Custom Property Engine | ✅ registry + drives contact record |
| 6 | Manage Duplicates | ✅ (DUP-004 partial) |
| 7 | Lifecycle Automation | 🔴 |
| 8 | Training — Job Applications | ⏭️ existing `/job-applications` (approve→invite 🔴) |
| 9 | Training Documents — Locked Access | ✅ `/training-docs` (verify gating) |
| 10 | After-Photo Consent | 🟢 schema · 🟡 UI |
| 11 | Cancellation Retention ($15 winback) | 🟡 |
| 12 | Post-Cleaning Ratings + Modal | 🟢 verify |
| 13 | Three-Strike System | 🟢 verify |
| 14 | P0 Software Fixes | 🟡 (FIX-001 ✅ /recurring; FIX-004 open) |
| 15 | P1 Software Fixes | 🟡 |
| 16 | P2 Software Fixes | 🟡 (FIX-010 ✅; FIX-011 ~done) |

---

## 3. Contacts & Leads CRM ✅

| ID | Feature | Status | Notes |
|---|---|---|---|
| CRM-001 | Contacts navigation | ✅ | `/contacts`, saved views, filters, column selector |
| CRM-002 | Create contact / lead | 🟡 | "New contact" button is a stub — no create form yet |
| CRM-003 | Contact record page | ✅ | `/contacts/[id]` — property cards, activity timeline, bookings, comms, source, ratings, duplicates tabs |
| CRM-004 | Lifecycle stages | ✅ | `LifecycleStage` enum — 10 stages |
| CRM-005 | Property-driven UI | ✅ | Contact record Overview now renders **from the registry**; custom properties auto-appear; bindings map to columns/props/system |
| CRM-006 | Auto-property updates | 🔴 | Customer edits don't yet sync to contact properties |

**Files:** `src/app/(app)/contacts/*`, `src/lib/crm.ts`, `src/lib/crm-meta.ts`, `src/app/(app)/actions/contactActions.ts`
**Data model:** `Contact`, `ContactActivity` (back-link `clientId`/`leadId`). Migration `20260615000000_contacts_crm` — backfilled 726 contacts (714 clients + 12 leads).
**⚠️ Data debt:** backfill mislabeled lifecycle (706 "Active", only 2 have jobs). Re-derivation from real jobs pending.

## 4. Lead Source & True CPA ✅

`/reports` — stat cards, spend-by-channel donut, 6-month trend, CPA-by-source table, ad-spend import (live recompute), referral/WOM sub-report.
- **Files:** `src/app/(app)/reports/*`, `src/lib/cpa.ts`, `src/lib/cpa-meta.ts`, `src/app/(app)/actions/adSpendActions.ts`. Model `AdSpendImport`.
- **Gaps:** trend approximated from `createdAt`; date-range filter not wired; attribution sparse (existing clients import as "Other").

## 5. Custom Property Engine ✅

`/properties` — object switcher (Contact/Company/Booking), grouped list, editor modal (field-type grid, option manager, validation), system-field guardrails.
- **Files:** `src/app/(app)/properties/*`, `src/lib/prop-engine.ts`, `src/lib/prop-engine-meta.ts`, `src/app/(app)/actions/propertyActions.ts`. Model `PropertyDefinition` (25 seeded).
- ✅ **Drives the contact record:** Overview tab renders from the registry (`listObjectProperties("contact")`). `CONTACT_BINDINGS` map each property to a column / props-bag key / system field. Dropdowns render selects with the registry options; custom admin-added properties auto-appear (land in "Contact info" group).
- ⚪ Minor v1 gaps: `multi`/`checkbox` field types render as text on the record; new-property group is fixed to "Contact info"; Company/Booking objects have no record surface yet.

## 6. Manage Duplicates ✅

| ID | Feature | Status | Notes |
|---|---|---|---|
| DUP-001 | Detect duplicate groups | ✅ | union-find on phone/email; score + matched fields |
| DUP-002 | Side-by-side field selection | ✅ | merge comparator |
| DUP-003 | "Use newest" one-click | ✅ | toggle in comparator |
| DUP-004 | Safe merge audit trail | 🟡 | archives losers + audit entry; **no old-values snapshot** |
| DUP-005 | Delete / archive duplicates | ✅ | soft-archive (`archivedAt`) |

**Files:** `src/app/(app)/contacts/duplicates/*` + merge/dismiss in `contactActions.ts`.

## 7. Lifecycle Automation — Cancellations & Edits 🔴

Auto-update contact lifecycle/properties on: cancel appointment, cancel recurring plan, edit booking, rebook. Guardrails (don't downgrade returning customers). **Not started.**

## 8. Training — Job Applications ⏭️

Existing `/job-applications` + `JobApplication` model already cover intake. The design's richer outline form was **skipped** to avoid duplication.
- 🔴 **APP-002 / APP-004**: Approve → create/unlock cleaner account + send invite — genuinely useful, not yet wired into the existing page.

## 9. Training Documents — Locked Access ✅

Built at `/training-docs` (`TrainingDocsClient.tsx`). **Verify** DOC-004 (no pre-quiz access — block direct URLs/API to doc content, not just hide UI) and DOC-006 (access audit log) are enforced server-side.

## 10. After-Photo Consent 🟢🟡

Schema exists: `Job.afterPhotoConsent`, `afterPhotoConsentVersion`, `afterPhotoOverrideAt`.
| ID | Status | Notes |
|---|---|---|
| PIC-001 booking checkbox | 🟡 | verify present on booking page |
| PIC-002 store consent | 🟢 | fields exist |
| PIC-003 cleaner job view | 🟡 | verify |
| PIC-004 audit history | 🔴 | |

## 11. Cancellation Retention ($15 winback) 🟡

`RecurringCancellation` (offerType/offerStatus) + save-offer flow exist. Remaining: $15 single-use code generation + winback email + timeline logging — verify/complete.

## 12. Post-Cleaning Ratings + Forced Modal 🟢

Already built: `JobRatingToken` (email + portal popup + opt-out + expiry), `EmployeeRating`. RAT-001…005 — **verify only.**

## 13. Three-Strike System 🟢

Already built: `CleanerStrike` (30-day rolling window, reason codes, auto-triggers, excuse/remove, `CLEANER_STRIKE` alert). STR-001…005 — **verify only.** `src/lib/strikes.ts`.

## 14. P0 Software Fixes

| ID | Feature | Status | Notes |
|---|---|---|---|
| FIX-001 | Recurring reschedule (single occurrence, "moved" badge) | ✅ | `/recurring` (`RecurringClient.tsx`) |
| FIX-002 | Recurring discount after first booking | 🟢 | `src/lib/booking-pricing.ts` (12% wk / 8% biwk) |
| FIX-003 | Recurring jobs 4 weeks ahead | ✅ | via `/recurring` (verify horizon) |
| FIX-004 | Late-time minute calculation | 🟡 | `clockIn.ts` modified in working tree — confirm fix |

## 15. P1 Software Fixes

| ID | Feature | Status | Notes |
|---|---|---|---|
| FIX-005 | Flexible booking time window | 🟡 | `Step3Schedule` has whole-day flexible; needs start–end window + notes |
| FIX-006 | Service-based add-on visibility | ✅ | per-add-on "Shows for service" toggles in Pricing Rules; `Step2Property` filters by service + deselects hidden |
| FIX-007 | Deep-clean hourly pricing ($50/hr, min 3h, ≤3 cleaners) | 🟡 | hourly already built for Post-Construction (`PC_HOURLY_RATE=50`); reuse for Deep Clean via a toggle |
| FIX-008 | Password management (admin reset/set) | 🔴 | better-auth supports it; needs UI |
| FIX-009 | Notification preferences | 🟢 | `NotificationSetting` catalog |

## 16. P2 Software Fixes

| ID | Feature | Status | Notes |
|---|---|---|---|
| FIX-010 | Announcements / Team Hub | ✅ | done |
| FIX-011 | Cleaner shift-drop + auto penalty | 🟡 | **~done** — `CancelShiftButton.tsx` + `cancelShift.ts` (unassign + 1★ rating + $20 fee + strike + log). Gaps: admin Alert on drop; penalty currently late-only |

---

## Work log

- **2026-06-15** — Built items **1–5**: Contacts list + record (`Contact`/`ContactActivity`), Manage Duplicates (merge tool), Lead Source & True CPA (`AdSpendImport`), Property Engine registry (`PropertyDefinition`). 4 migrations applied. Job Applications (item 6) skipped as duplicate.
- **2026-06-15** — Wired contact record → Property Engine (CRM-005 ✅): Overview renders from the registry, custom properties auto-appear, dropdown selects. Fixed contacts pager (windowed) + property-engine row height.
- **2026-06-15** — FIX-006 ✅ service-based add-on visibility: per-add-on service toggles in Pricing Rules + booking-step filter (no migration).

## Recommended next

1. ~~Wire contact record → Property Engine~~ ✅ done.
2. **Lifecycle data cleanup** (re-derive the 704 mislabeled "Active" contacts) — needs a go-ahead (data mutation).
3. **Lifecycle automation** (§7, CRM-006) + **create-contact form** (CRM-002) — no new design needed; I can build.
4. **Recurring reschedule** (FIX-001 — top untouched P0) — *awaiting design*.

### Buildable with existing components (no mockup)
- **FIX-005 flexible window** — quick-pick chips + Earliest/Latest selects + notes (needs 1 small field on `Job` to store the window).
- **FIX-007 deep-clean hourly** — reuse the Post-Construction hours/cleaners UI + a Standard/Hourly toggle.
- **FIX-011 shift-drop** — already built; just decide admin-alert + penalty scope.
