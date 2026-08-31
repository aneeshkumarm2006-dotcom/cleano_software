# Cleano Software — Feature Status & Build Plan

**Prepared for:** Client Review
**Date:** June 15, 2026 · **last updated August 14, 2026**
**Purpose:** Compare what the platform already does today against the BookingKoala master settings spec, organized by who each feature serves, so we can agree on a build plan together.

---

## Update — August 14, 2026: the six pricing & access fixes

The most recent round of work closed six P0 items from your pricing-logic
document. They are defect fixes rather than new spec features, so they are
summarised here and the rows they changed are marked **(Aug 2026)** in the
tables below.

| # | Item | Status |
|---|---|:---:|
| 1 | Settings page returns an error — 39 staff accounts were locked out of their own Settings; the page can also no longer fail as a whole | ✅ **Done** |
| 2 | Itemized pricing vs. final price override — now a visible, admin-chosen setting on every job, not something inferred from where the booking came from | ✅ **Done** |
| 3 | One active price on every screen — price card, Charge button, profit, revenue, exports, invoices and the refund cap all read base + add-ons (or the override) | ✅ **Done** |
| 4 | Cleaner pay includes tips and parking as customer-funded pass-throughs, and honours a manual team payment | ✅ **Done** |
| 5 | Cleaner pay includes add-ons in the basis | ✅ **Done** |
| 6 | Clock-out reliability — named errors, a resumable retry, a record on the job, and an alert to the admin team | ✅ **Done** |
| 7 | Applicant access model — a restricted applicant portal, minted by invitation | ✅ **Done** |

Two companion documents go with this round:

- **`NUMBERS_THAT_MOVE.md`** — every figure on your dashboards that changes,
  before and after, measured against live data.
- **`CLIENT_DECISIONS.md` section 7** — the six decisions (D1–D6) made from code
  evidence, each with its reasoning, each independently overrulable.

---

## How to Read This Document

Every feature is marked with one of three statuses:

| Status | Meaning |
|:---:|---|
| ✅ **Done** | Built and working today |
| 🟡 **Partial** | Foundation exists, but needs finishing or a settings screen |
| 🔴 **To Build** | Not yet started |

Features are grouped by **who uses them**:
- 🧑‍💼 **Admin** — your back-office team (configuration, dashboards, money)
- 🛒 **Customer** — the people booking cleanings
- 🧹 **Cleaner** — the field staff / providers
- ⚙️ **System** — the engine behind the scenes (no screen)

---

## Summary at a Glance

| | Done ✅ | Partial 🟡 | To Build 🔴 | Total |
|---|:---:|:---:|:---:|:---:|
| 🧑‍💼 Admin | 12 | 8 | 12 | 32 |
| 🛒 Customer | 8 | 11 | 9 | 28 |
| 🧹 Cleaner | 9 | 7 | 3 | 19 |
| ⚙️ System | 6 | 1 | 0 | 7 |
| **Total** | **35** | **27** | **24** | **86** |

*Counts updated August 14, 2026: four new Admin capabilities from the pricing
round, and the cleaner contractor pay model moved from To Build to Done.*

**In plain terms:** ~40% of features are fully built. Most of the rest already has the hard technical groundwork in place (payments, scheduling, time tracking) — what remains is largely **admin settings screens** and **customer-facing polish**, not core engineering.

---

## 🧑‍💼 ADMIN — Back-Office Team

### Already Working ✅
| Feature | Notes |
|---|---|
| Admin account profile | Name, email, phone, photo |
| Invoices | List, view, and PDF download |
| Location management | Manage service locations by name |
| Admin calendar | Month / week / day views with provider display |
| Declined-payment handling | Booking is kept, admin is notified |
| Card holds & capture | Place, capture, and release holds |
| Charge / refund workflows | Full Stripe charge and refund flows |
| Three-strike system | Automatic cleaner strike tracking |
| Pricing mode per job **(Aug 2026)** | Itemized, or a final price override — chosen on the job form, shown on the job page |
| One active price everywhere **(Aug 2026)** | Price card, Charge button, profit, revenue, exports, invoices and the refund cap all read base + add-ons (or the override) |
| Shared Settings page **(Aug 2026)** | Every staff role reaches its own Settings; admin-only tabs stay admin-only; one failing section no longer takes the page down |
| Applicant portal & invite **(Aug 2026)** | Invite an applicant to a restricted portal; "Hire" converts that account instead of creating a second login |

### Partial — Needs Finishing 🟡
| Feature | What's left |
|---|---|
| Affiliate / commission dashboard | Basic referral tracking exists; full dashboard + payouts missing |
| Accepted payment forms config | Payment labels exist; no "card-only" enforcement toggle |
| Cancellation fee | Built, but currently **$20 / 48h** — spec says **$25 / 24h** (decision needed) |
| Refund on switch to cash/check | Manual refund works; auto-detection missing |
| Partial refund on price decrease | Works; no dedicated refund-log audit trail |
| Services catalog (add/edit services) | Add-ons exist; no full service-management screen |
| Master email templates | Emails work; no template editor for admin |
| Currency display | Works as CAD, but hardcoded (no settings screen) |

### To Build 🔴
| Feature | Why it matters |
|---|---|
| Subscription / billing module | View plan, price, billing date |
| Business name & logo settings | Brand the platform from settings |
| Timezone setting | Currently hardcoded |
| Time & date format settings | Currently hardcoded |
| Phone number format / mask | Currently raw text |
| Calendar color management | Color bookings by type |
| Reschedule-fee configuration | No fee config today |
| Pay cancellation fee to provider | No payout split today |
| Embed forms (login/signup/gift card/contact) | Copy-paste embeddable forms |
| Custom domain configuration | Use your own domain |
| Translation management tool | Manage translated text |
| Cancellation reason list | Free text today; no predefined list + visibility rules |

---

## 🛒 CUSTOMER — People Booking Cleanings

### Already Working ✅
| Feature | Notes |
|---|---|
| Online booking form | Full multi-step booking wizard |
| Self-rescheduling | Customers reschedule their own bookings |
| Self-cancellation | Customers cancel their own bookings |
| Postpone bookings | Customers can postpone |
| Rate the cleaning | Post-job rating flow (email + portal) |
| Saved payment cards | Securely stored, masked |
| Invoice view | View bookings & pricing in portal |
| Referral credits | Referral code system in place |

### Partial — Needs Finishing 🟡
| Feature | What's left |
|---|---|
| Provider ratings threshold (show ≥4) | Ratings exist; display filter missing |
| Same-day booking block (2-day cutoff) | Cancellation window exists; booking cutoff missing |
| Recurring cancellation scope | Model exists; "single / from-point / entire" options missing |
| Refund on pre-charged cancellation | Infrastructure exists; refund rule not wired |
| Referral / social sharing ($15) | Referral codes exist; $15 share incentive missing |
| SMS notification opt-in | Channel exists; default-checked not set |
| Customer invoice downloads | Invoice PDF works; gift-card download missing |
| Gift cards ($150 minimum) | Gift cards work; minimum not enforced |
| Payment summary in portal | Pricing visible; no dedicated summary view |
| Cancellation reasons shown to customer | Free text only; no structured reasons |
| Show assigned provider details | Not yet restricted/limited per spec |

### To Build 🔴
| Feature | Why it matters |
|---|---|
| Live reviews on site | Approved-only reviews to boost conversions |
| Facebook share coupon ($15 off) | Social-share discount flow |
| Customer document storage ("My Drive") | Customer file area |
| Modify quote | Let customers edit their quote |
| FAQ / Support section | Self-serve help content |
| **French language portal** | English + French support (Quebec market) |
| Show-assigned-provider (limited fields) | Privacy-safe provider preview |
| Waiting-list signup polish | Foundation exists, customer flow to refine |
| External review sharing | Optional, lower priority |

---

## 🧹 CLEANER — Field Staff / Providers

### Already Working ✅
| Feature | Notes |
|---|---|
| Clock in / out **(Aug 2026)** | Time tracking on jobs. Failures are now named, retryable without double-counting, recorded on the job, and alerted to admin |
| Contractor pay model **(Aug 2026)** | Tier base rates (Trainee 30% / Standard 40% / Field Lead 46%) × the rating multiplier, applied to base + add-ons, with tips and parking passed through |
| Schedule & availability | Cleaners set their own availability |
| Booking notes | Job notes visible to cleaners |
| Late-arrival message | Templated late-arrival notification |
| Unassigned jobs folder | Cleaners see & claim open jobs |
| New-job notifications | Alerts on new unassigned bookings |
| Team / multi-cleaner jobs | Multiple cleaners per job |
| Strike & penalty tracking | Automatic accountability system |

### Partial — Needs Finishing 🟡
| Feature | What's left |
|---|---|
| GPS path tracking | Location fields exist; provider GPS tracking missing |
| Auto clock-out by distance | Partial logic; distance trigger missing |
| On-the-way / clock-in reminders | Constants exist; full reminder flow to verify |
| Provider file uploads / "My Drive" | Chat uploads exist; dedicated drive missing |
| Provider pairing / teams | Multi-cleaner exists; formal pairing logic missing |
| Stripe payouts to cleaners | Payout tracking exists; bank-account linking missing |
| Provider self-signup control | Signup exists; enable/disable toggle missing |

### To Build 🔴
| Feature | Why it matters |
|---|---|
| Customer-data privacy gating | Cleaner sees phone, **not** email/price |
| Auto booking-completion trigger | Auto-complete when job length elapses |
| Distance unit setting (km) | Configurable GPS distance unit |

---

## ⚙️ SYSTEM — Behind the Scenes

### Already Working ✅
| Feature | Notes |
|---|---|
| Stripe payments | Live payment processing |
| 3DS / Strong Customer Authentication | Secure card challenges |
| Recurring booking scheduling | Generates future occurrences |
| Provider availability checks | Honors cleaner schedules |
| Capacity / spots checks | Limits jobs per time slot |
| Email & SMS notifications | Resend (email) + Twilio (SMS) |

### To Build 🔴
| Feature | Why it matters |
|---|---|
| Provider auto-assignment | "Accepted automatically" — auto-assign jobs to cleaners |

---

## ⚠️ Decisions We Need From You

These are not bugs — they're places where the spec and the current build disagree, and we need your call:

1. **Cancellation fee:** Current build = **$20 with a 48-hour window**. Spec = **$25 with a 24-hour window**. Which is correct?
2. **Referrer credit:** Current build = **$10** to the referrer. Spec = **$15**. Which is correct?
3. **French language:** Is full English + French portal support required for launch, or a later phase?
4. **Services catalog:** No services are configured yet. We need the final list of services and prices before launch.
5. **Branding cleanup:** Some payment descriptors and links still reference the old platform. Confirm the wording you want customers to see.

---

## Recommended Next Steps

1. **You review this document** and confirm priorities + the 5 decisions above.
2. We turn the agreed items into a **phased plan** (Phase 1 = launch-critical, Phase 2 = enhancements).
3. We start with the **quick wins** — most "🟡 Partial" admin settings are small because the groundwork already exists.

---

*This is a working document. Statuses reflect a code audit as of June 15, 2026, updated August 14, 2026 for the six pricing & access fixes, and may be refined as we verify edge cases together.*
