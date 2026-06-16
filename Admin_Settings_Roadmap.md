# Cleano — Admin Settings Roadmap

**Prepared for:** Client Review
**Date:** June 16, 2026
**Goal:** Make every *applicable* setting from the master document **editable by the admin** from a Settings screen — no hardcoded values.

---

## How to Read This

Each setting is tagged with a **bucket** that tells us the work involved:

| Bucket | Meaning | Work |
|:---:|---|---|
| **A** | Already admin-editable today | ✅ None |
| **B** | Behavior works, but value is **hardcoded** | 🔧 Move to Settings + add a control (fast) |
| **C** | Doesn't exist yet | 🛠️ Build feature + its setting |
| ~~**D**~~ | BookingKoala-internal, **not applicable** | ❌ Cut (see bottom) |

Settings are grouped by the **Admin Settings tab** they'll live in. ⭐ = a value decision is needed from you (becomes the default).

---

## Summary (after cuts)

| Admin Settings Tab | A ✅ | B 🔧 | C 🛠️ | Total |
|---|:---:|:---:|:---:|:---:|
| Account | 3 | 1 | 0 | 4 |
| General | 1 | 6 | 8 | 15 |
| Bookings & Calendar | 5 | 9 | 16 | 30 |
| Customer | 5 | 6 | 16 | 27 |
| Provider | 9 | 13 | 13 | 35 |
| Scheduling | 8 | 2 | 8 | 18 |
| Payments | 4 | 4 | 4 | 12 |
| Notifications | 4 | 4 | 0 | 8 |
| Website & Content | 1 | 0 | 14 | 15 |
| **TOTAL (214 applicable)** | **~40** | **~45** | **~79** | **214** |

**12 settings cut** as BookingKoala-internal (listed at the bottom). Roughly: **40 already done, 45 quick wires (Bucket B = Phase 1), 79 real builds (Bucket C = Phase 2+).**

---

## ⚙️ Tab: Account — 🧑‍💼 Admin

| # | Setting | Bucket | Notes / Default |
|---|---|:---:|---|
| 1 | Profile photo upload | B | Wire upload to profile |
| 2 | Admin name | A | |
| 3 | Account email | A | |
| 4 | Account phone | A | |

## ⚙️ Tab: General — 🧑‍💼 Admin

| # | Setting | Bucket | Notes / Default |
|---|---|:---:|---|
| 12 | Business name | C | Add field; used as brand name |
| 13 | Logo upload | C | |
| 14 | Store currency | B | Default **CAD** |
| 15 | Store email | B | Default info@teamcleano.com |
| 16 | Time zone | B | Default Canada/Eastern |
| 17 | Time format | B | Default 12-hour |
| 18 | Date format | B | Default MM/DD/YYYY |
| 19 | Business phone | B | Default 514-649-4430 |
| 20 | Phone number format/mask | C | Default 999-999-9999 |
| 21 | Country code option | C | Default Off |
| 23 | Form types offered | A | Booking forms live |
| 24 | Calendar color management | C | Color by booking type |
| 25 | Remember last selected filters | C | Default Off |
| 26 | Rename Service Fee | C | Default Off |
| 28 | Show location name at end of address | C | Default Off |

## ⚙️ Tab: Bookings & Calendar — 🧑‍💼 Admin / 🛒 Customer

| # | Setting | Bucket | Notes / Default |
|---|---|:---:|---|
| 22 | Accepted payment forms | B | Default Card only |
| 27 | Location management | A | ServiceAreas tab exists |
| 29 | Default booking view | B | Default Calendar |
| 30 | Default calendar period | B | Default Month |
| 31 | Provider display position | C | Default Side |
| 32 | Month view booking display | B | Default Names |
| 33 | Multiple bookings on one date | B | Default Side-by-side |
| 34 | Hide provider non-working hours | C | Default No |
| 35 | Rescheduling fee | C | Default No |
| 36 | Reschedule fee override | C | |
| 37 | ⭐ Cancellation fee | B | **Decision: $20 or $25?** (built $20) |
| 38 | Pay cancellation fee to provider | C | Default Disabled |
| 39 | Override category cancellation settings | C | |
| 40 | Stop adding bookings when recurring canceled | B | Default Yes |
| 41 | ⭐ Cancellation fee timing | B | **Decision: 24h or 48h?** (built 48h) |
| 42 | Cancellation reasons | C | Predefined list |
| 43 | Cancellation reason required | C | Default Yes |
| 44 | Cancellation comment box | C | Default No |
| 45 | Cancellation reason visibility | C | Both admin & customer |
| 46 | Allow customer to modify quote | C | Default Yes |
| 47 | Price adjustment note | C | Default No |
| 48 | Time adjustment note | C | Default No |
| 49 | Charge unassigned booking | C | Default No (guard) |
| 50 | Auto-charge completed bookings | C | Default No |
| 51 | Refund when pre-charged → cash/check | B | Default Yes |
| 52 | Refund difference when total decreases | B | Default Yes |
| 53 | Handle totals after prior refunds | C | Do-not-consider-refund |
| 54 | Refund extra charges w/ existing records | C | Default Yes |
| 55 | Declined pre-payment handling | A | Add booking + notify admin |
| 56 | Individual charge notifications for bulk | C | Default No (suppress) |
| 57 | Card hold | A | Toggle (built) |
| 58 | Invoice card-hold behavior | A | Capture (built) |
| 60 | Chat feature | A | Toggle (built) |
| 61 | Multiple appointments per booking spot | C | Default No |
| 62 | Blocked customer message | C | Editable text |
| 63 | Deactivated provider message | C | Editable text |

## ⚙️ Tab: Customer — 🛒 Customer

| # | Setting | Bucket | Notes / Default |
|---|---|:---:|---|
| 64 | Show assigned provider to customer | C | Default Yes (field control) |
| 65 | Provider details visible (which fields) | C | First name, last initial, ratings, jobs |
| 66 | Provider ratings display threshold | B | Default ≥4 |
| 67 | Where provider details enabled | C | Front + back end |
| 68 | Show provider count in booking summary | C | Default Yes |
| 69 | Live reviews | C | Approved-only display |
| 70 | Live reviews threshold | C | Default ≥5 |
| 71 | Live review name display | C | First + last initial |
| 72 | Same-day bookings (cutoff) | C | Default No, 2-day cutoff |
| 73 | Payment summary visibility | B | Customer backend |
| 74 | Primary phone required | B | Default Yes |
| 75 | Disable secondary email/phone | B | Default No |
| 76 | Customer service ratings | A | Built |
| 77 | Industries customers can rate | C | Per-category |
| 78 | External review sharing | C | Default No |
| 79 | Recurring signup discount after 4/5+ rating | C | Default 0% |
| 80 | Customer job media visibility | C | Default Yes |
| 81 | Reminder notifications for unassigned | B | Default Yes |
| 82 | Customer self-rescheduling | A | Built (expose toggle) |
| 83 | Reschedulable service categories | C | Per-category |
| 84 | Customer postpone bookings | A | Built |
| 85 | Postpone pre-charged bookings | C | Default No |
| 86 | Customer self-cancellation | A | Built |
| 87 | Recurring cancellation options (scope) | C | single / from-point / entire |
| 88 | Customer cancellable services | C | Per-category |
| 89 | Admin confirmation before cancellation | C | Recurring only |
| 90 | Refund pre-charged customer cancellation | B | Default Yes |
| 91 | Provider cancellation payment if resumes | C | Keep payment |
| 92 | Facebook share coupon | C | Default Yes |
| 93 | Facebook coupon content | C | "$15 off" editable |
| 94 | Twitter referral description | C | Editable text |
| 95 | Unconfirmed booking display | A | Pending (built) |
| 96 | Tooltip | C | Default Off |
| 97 | FAQ/Support URL | C | teamcleano.com/contact |
| 98 | Customer My Drive | C | Default No |
| 99 | Customer invoice downloads | B | Add gift-card type |
| 100 | Customer gift card updates | C | Default No |
| 101 | Card added by customer → all bookings | C | Default Yes |
| 102 | SMS notification opt-in default | B | Default Checked |

## ⚙️ Tab: Provider — 🧹 Cleaner

| # | Setting | Bucket | Notes / Default |
|---|---|:---:|---|
| 103 | Provider type / reimbursements | C | Default Contractor |
| 104 | Contractor variables | B | Reimbursements field exists |
| 105 | Team members work individually/with teams | A | Built |
| 106 | Default provider pay | B | Default **40%** (Multipliers tab) |
| 107 | Provider overridden time handling | C | Reset |
| 108 | Provider My Drive | C | Default Yes |
| 109 | Provider file uploads | B | Default Yes |
| 111 | Disable provider help center tab | C | Default No |
| 112 | Provider pay basis | A | Original total |
| 113 | Apply discounts to flat/hourly pay | A | Built |
| 114 | Provider profile editing | A | Built |
| 115 | Provider password reset | A | Built |
| 116 | Provider self-settings management | B | Expand scope |
| 117 | Reason required for settings modification | C | Default No |
| 118 | Admin approval for settings request | C | Default No |
| 119 | Active bookings during account changes | B | Move to unassigned |
| 120 | Provider editable settings (which) | C | Selected fields |
| 122 | Provider own ratings visibility | A | Built |
| 123 | Customer email visible to provider | B | Default No (gate it) |
| 124 | Customer phone visible to provider | B | Default Yes |
| 125 | Customer name/photo visible to provider | B | Default Yes |
| 126 | Provider pairing | C | Override global |
| 127 | Divide job length by number of providers | A | Built |
| 128 | Provider availability management | A | Built |
| 129 | New provider schedule default | C | Pick custom |
| 130 | Default provider schedule | C | Sun–Sat 8–6 template |
| 131 | Provider schedule editing | A | Built |
| 132 | Active bookings during schedule changes | B | Move + notify |
| 134 | Clock in/out feature | A | Toggle (built) |
| 135 | Tracking type (GPS path) | C | Default Yes |
| 136 | Distance unit | B | Default Kilometers |
| 137 | Disable auto clock-in | B | Default Yes |
| 138 | Automatic clock-outs | B | Default No |
| 139 | Auto clock-out distance | C | Default 500m |
| 140 | Booking completion trigger | C | On job length |
| 141 | Pair/team clock-out method | A | Individually (built) |
| 142 | Provider re-clock-in | C | Default Yes |
| 143 | Time adjustments update booking | C | Default No |
| 144 | Disable provider override popup | C | Default No |
| 145 | Team tracking method | B | Everyone individually |
| 146 | Pair/team customer notifications | C | Consolidated |
| 147 | On The Way reminder | B | Default 10 min before |
| 148 | Clock-in reminder | B | Default 10 min after |
| 149 | Auto-send provider schedule | C | Default No |
| 150 | Provider self-signup | B | Default No (toggle) |
| 151 | Digital signature | A | Built |
| 152 | Feedback feature | C | Default No |
| 153 | Late arrival message | A | Admin only (built) |
| 154 | Late arrival message text | A | Template (built) |
| 155 | Late arrival button name | B | Editable label |
| 156 | Provider booking notes | A | Built |
| 157 | Show payment method to provider | B | Default No |
| 158 | ⭐ Show booking price to provider | B | **Decision: hide (spec) or show (current)?** |
| 159 | Hide provider payments from providers | A | Show all (built) |

## ⚙️ Tab: Scheduling — ⚙️ System / 🧑‍💼 Admin

| # | Setting | Bucket | Notes / Default |
|---|---|:---:|---|
| 175 | Recurring booking scheduling method | A | Just one appointment |
| 176 | Recurring bookings blocked into future | B | Default 3 |
| 177 | Show all upcoming before confirmation | A | No (matches) |
| 178 | Apply same provider when added from cron | C | Default No |
| 179 | New recurring booking based on | C | Last booking |
| 180 | Provider availability based on form selections | A | No (matches) |
| 181 | Max time per team/provider per booking | A | 0/disabled (matches) |
| 182 | Provider availability check for recurring | C | First appointment |
| 183 | Assign providers based on job lengths | A | No (matches) |
| 184 | Spots availability check for recurring | C | First appointment |
| 185 | Skip holidays | A | Closures tab exists |
| 186 | Users blocked from booking on holidays | A | Built |
| 187 | Check spots based on provider availability | A | No (matches) |
| 188 | ⭐ Provider assignment method | C | **Decision: auto-accept (spec) or accept/decline (current)?** |
| 189 | Providers see & accept unassigned | A | Built |
| 190 | Providers see unassigned even if N/A | C | Default Yes |
| 191 | Notify all providers of unassigned | A | Built |
| 192 | Check working hours before notification | C | Default Yes |
| 193 | Allow grab if unavailable/overlap | C | Default Yes |
| 194 | Override per-provider unassigned visibility | C | Default Yes |
| 195 | If provider not available at acceptance | C | Deny |
| 196 | Waiting list | A | Built |
| 197 | Default update behavior for recurring | C | All future |

## ⚙️ Tab: Payments — 🧑‍💼 Admin / ⚙️ System

| # | Setting | Bucket | Notes / Default |
|---|---|:---:|---|
| 160 | Minimum gift card amount | B | Default $150 |
| 161 | Edit gift card below minimum | C | Default No |
| 162 | Maximum gift card limit | B | Default None |
| 163 | Credits to referred person | B | Default $15 |
| 164 | ⭐ Credits to referrer | B | **Decision: $15 or $10?** (built $10) |
| 165 | Card hold description | C | Editable descriptor text |
| 166 | Charge booking description | C | Editable |
| 167 | Separate charge description | C | Editable |
| 168 | Charge invoice description | C | Editable |
| 169 | Payment processor | A | Stripe enabled |
| 170 | Connected processor | A | Stripe |
| 172 | 3DS / SCA | A | Enabled (built) |
| 173 | Billing address associated with card | B | Default Disabled |
| 174 | Provider payment accounts | C | Stripe Connect payouts |

## ⚙️ Tab: Notifications — 🧑‍💼 Admin / ⚙️ System

| # | Setting | Bucket | Notes / Default |
|---|---|:---:|---|
| 220 | Notification email sender | A | info@teamcleano.com |
| 221 | Notification display name | A | Cleano |
| 222 | Admin notification email | B | |
| 223 | Customer reply-to email | B | Set Reply-To header |
| 224 | Notification channels | A | Email + SMS |
| 225 | Master template for customer emails | B | Add editor |
| 226 | Master template for other emails | B | Add editor |

## ⚙️ Tab: Website & Content — 🧑‍💼 Admin / 🛒 Customer

| # | Setting | Bucket | Notes / Default |
|---|---|:---:|---|
| 198 | Services list | C | Build service catalog |
| 199 | Services actions (add/edit/bulk) | C | |
| 200 | Job openings | A | Careers built |
| 201 | Website theme | C | Theme selection |
| 202 | Website actions (preview/customize) | C | |
| 204 | Design Forms & Website submenu | C | |
| 205 | Embed booking form | C | iframe/script generator |
| 206 | Generate embed code for industry | C | Default No |
| 207 | Embed login form | C | |
| 208 | Embed signup form | C | |
| 209 | Embed send gift card form | C | |
| 210 | Embed lead/contact form | C | |
| 211 | Embed live reviews | C | |
| 212 | Primary / custom domain | C | Connect domain |
| 214 | Customer portal languages (EN + FR) | C | Build French / i18n |
| 217 | Translation tool | C | |
| 218 | FAQs | C | FAQ module |
| 219 | Visible FAQ examples | C | |

*(Provider/customer default-language rows 213, 215, 216 = English, already effectively set.)*

---

## ❌ Cut — BookingKoala-Internal (Not Applicable)

These were BookingKoala billing/branding **you**, not features of your product. Removed per your approval:

| # | Setting | Why cut |
|---|---|---|
| 5 | Subscription plan ($197/mo) | BookingKoala charging Cleano — not your product |
| 6 | Subscription actions | Same |
| 7 | Saved business cards | BookingKoala billing cards |
| 9 | Affiliate dashboard | BookingKoala affiliate program |
| 10 | Affiliate earnings stats | Same |
| 11 | Referral performance (affiliate) | Same |
| 59 | Multiple time zones | Single-region business |
| 110 | Provider speed tag | BookingKoala-specific UI gimmick |
| 121 | Provider tutorial video | BookingKoala's Vimeo |
| 133 | Provider scheduling tutorial | BookingKoala's Vimeo |
| 171 | Available processors (Square/PayPal/Authorize) | Stripe only |
| 203 | Preview website URL | BookingKoala-hosted link |

---

## The Plan

**Phase 0 — Settings spine (foundation):** central settings reader/writer over the existing `AppSetting` store, with defaults, validation, and **audit logging** (old/new value + actor + timestamp). Lay out the 9 tabs above.

**Phase 1 — Bucket B (~45 quick wires):** move hardcoded values into Settings and add controls. Fast, because the behavior already works. This is where the client sees the biggest visible jump ("now I can change everything").

**Phase 2 — Bucket C (~79 builds):** real features, prioritized P1/P2/P3 (cancellation logic, customer-facing reviews/FAQ/French, provider GPS, embeds, custom domain, auto-assign).

**Decisions still needed** (they become the defaults): rows **37, 41, 158, 164, 188** — cancellation fee/timing, price-to-provider, referrer credit, assignment method.

*Statuses reflect a code audit as of June 16, 2026.*
