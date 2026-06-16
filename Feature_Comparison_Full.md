# Cleano Software — Full Feature Comparison (1:1 with Spec)

**Prepared for:** Client Review
**Date:** June 16, 2026
**Scope:** Every one of the **226 settings** in the master settings document, compared line-by-line against what the platform does today.

---

## Legend

| Status | Meaning |
|:---:|---|
| ✅ | **Done** — built and working |
| 🟡 | **Partial** — foundation exists; needs finishing or a settings screen |
| 🔴 | **To Build** — not yet started |

**Audience** of each section: 🧑‍💼 Admin · 🛒 Customer · 🧹 Cleaner · ⚙️ System

> Note: Many rows are admin *configuration switches*. In several cases the **behavior** already works correctly but there is **no settings screen** to change it (it's hardcoded) — those are marked 🟡.

---

## Summary at a Glance

| Section | Audience | ✅ | 🟡 | 🔴 | Total |
|---|---|:---:|:---:|:---:|:---:|
| 4. Account / Subscription / Cards / Invoices | 🧑‍💼 | 4 | 2 | 2 | 8 |
| 5. Affiliate / Rewards | 🧑‍💼 | 0 | 1 | 2 | 3 |
| 6. General Store Settings | 🧑‍💼 | 1 | 4 | 12 | 17 |
| 7. Calendar / Cancellation / Refund / Chat | 🧑‍💼🛒 | 7 | 11 | 17 | 35 |
| 8. Customer Settings | 🛒 | 5 | 14 | 20 | 39 |
| 9. Provider Settings | 🧹 | 16 | 23 | 18 | 57 |
| 10. Admin & Payment Gateways | 🧑‍💼⚙️ | 5 | 5 | 5 | 15 |
| 11. Scheduling | ⚙️🧑‍💼 | 11 | 4 | 8 | 23 |
| 12. Services / Website / Translation / Notifications | 🧑‍💼🛒 | 7 | 7 | 15 | 29 |
| **TOTAL** | | **56** | **71** | **99** | **226** |

**In plain terms:** ~25% fully done, ~31% partly done, ~44% to build. But **Done + Partial = 56%** already has a working foundation. The bulk of "To Build" is **admin settings screens** and **website/marketing features** (embeds, FAQ, French, social sharing), not core engine work — payments, scheduling, and time-tracking engines are already live.

---

## 4. Account, Subscription, Cards & Invoices — 🧑‍💼 Admin

| # | Setting | Spec Value | Status | Notes |
|---|---|---|:---:|---|
| 1 | Profile photo upload | Max 300×300 | 🟡 | Profile editing exists; photo upload to verify |
| 2 | Admin name | Nettoyage Cleano | ✅ | |
| 3 | Account email | contactcleano@gmail.com | ✅ | |
| 4 | Account phone | 514-649-4430 | ✅ | |
| 5 | Subscription plan | Premium $197/mo | 🔴 | No subscription/billing module |
| 6 | Subscription actions | Cancel, manage cards, plans | 🔴 | |
| 7 | Saved cards (business) | Masked cards | 🟡 | Customer card-on-file exists; business billing cards do not |
| 8 | Invoices | Monthly, viewable | ✅ | List, view, PDF download |

## 5. Affiliate / Rewards Dashboard — 🧑‍💼 Admin

| # | Setting | Spec Value | Status | Notes |
|---|---|---|:---:|---|
| 9 | Affiliate dashboard | Links, referrals, payouts | 🟡 | Basic referral codes only; no affiliate dashboard |
| 10 | Affiliate earnings stats | Paid/unpaid balances | 🔴 | |
| 11 | Referral performance | By date range | 🔴 | |

## 6. General Store Settings — 🧑‍💼 Admin

| # | Setting | Spec Value | Status | Notes |
|---|---|---|:---:|---|
| 12 | Business name | Nettoyage Cleano | 🔴 | No settings field |
| 13 | Logo upload | Max 225×50 | 🔴 | |
| 14 | Store currency | CAD | 🟡 | Works, but hardcoded (no setting) |
| 15 | Store email | info@teamcleano.com | 🟡 | Via env var, no UI |
| 16 | Time zone | Canada/Eastern | 🔴 | Hardcoded |
| 17 | Time format | 12-hour | 🔴 | Hardcoded |
| 18 | Date format | MM/DD/YYYY | 🔴 | Hardcoded |
| 19 | Phone number (business) | 514-649-4430 | 🔴 | No setting |
| 20 | Phone number format/mask | 999-999-9999 | 🔴 | Raw text today |
| 21 | Country code option | No | 🔴 | |
| 22 | Accepted payment forms | Card only | 🟡 | Payment labels exist; no card-only enforcement |
| 23 | Form types offered | Booking forms | ✅ | Booking form live |
| 24 | Calendar color management | By booking type | 🔴 | |
| 25 | Remember last selected filters | No | 🔴 | |
| 26 | Rename Service Fee | No | 🔴 | |
| 27 | Location management | Name based | 🟡 | Inventory/sales-area locations exist; service-area naming partial |
| 28 | Show location name at end of address | No | 🔴 | |

## 7. Calendar, Cancellation, Quote, Payment & Chat — 🧑‍💼 Admin / 🛒 Customer

| # | Setting | Spec Value | Status | Notes |
|---|---|---|:---:|---|
| 29 | Default booking view | Calendar | ✅ | |
| 30 | Default calendar period | Month | ✅ | Month/week/day exist |
| 31 | Provider display position | Side | 🟡 | Calendar shows providers; position not configurable |
| 32 | Month view booking display | Names | ✅ | |
| 33 | Multiple bookings on one date | Side by side | 🟡 | Verify rendering |
| 34 | Hide provider non-working hours | No | 🔴 | |
| 35 | Rescheduling fee | No | 🔴 | No reschedule-fee logic |
| 36 | Reschedule fee override | Unchecked | 🔴 | |
| 37 | Cancellation fee | $25 | 🟡 | **Built as $20** — decision needed |
| 38 | Pay cancellation fee to provider | Disabled | 🔴 | No payout split |
| 39 | Override category cancellation settings | Yes | 🔴 | |
| 40 | Stop adding bookings when recurring canceled midway | Yes | 🟡 | Recurring-cancel model exists |
| 41 | Cancellation fee timing | 24h before | 🟡 | **Built as 48h** — decision needed |
| 42 | Cancellation reasons | Yes | 🟡 | Free text; no predefined list |
| 43 | Cancellation reason required | Yes | 🟡 | |
| 44 | Cancellation comment box | No | 🔴 | |
| 45 | Cancellation reason visibility | Both admin & customer | 🔴 | No role-aware display |
| 46 | Allow customer to modify quote | Yes | 🔴 | Read-only quotes today |
| 47 | Price adjustment note | No | 🔴 | |
| 48 | Time adjustment note | No | 🔴 | |
| 49 | Charge unassigned booking | No | 🔴 | No assignment check before charge |
| 50 | Auto-charge completed bookings | No | 🔴 | Manual charging only (matches "No") |
| 51 | Refund when pre-charged → cash/check | Yes | 🟡 | Manual refund works; auto-detect missing |
| 52 | Refund difference when total decreases | Yes | 🟡 | Partial refund works; no refund-log audit |
| 53 | Handle totals after prior refunds | Do not consider refund | 🟡 | |
| 54 | Refund extra charges w/ existing refund records | Yes | 🟡 | |
| 55 | Declined pre-payment handling | Add booking, notify admin | ✅ | |
| 56 | Individual charge notifications for bulk/invoice | No | 🔴 | No suppression flag in bulk charge |
| 57 | Card hold | No | ✅ | Hold place/capture/release built |
| 58 | Invoice card-hold behavior | Capture | ✅ | |
| 59 | Multiple time zones | No | 🔴 | Single timezone (matches "No") |
| 60 | Chat feature | Yes | ✅ | Cleaner↔admin; customer chat not included |
| 61 | Multiple appointments per booking spot | No | 🔴 | |
| 62 | Blocked customer message | Custom text | 🔴 | No block status/message |
| 63 | Deactivated provider message | Custom text | 🔴 | Notification exists; no enforcement message |

## 8. Customer Settings — 🛒 Customer

| # | Setting | Spec Value | Status | Notes |
|---|---|---|:---:|---|
| 64 | Show assigned provider to customer | Yes | 🟡 | Names shown; no field-level control |
| 65 | Provider details visible (first name, last initial, ratings, jobs) | Limited | 🟡 | No granular field control |
| 66 | Provider ratings display threshold | ≥4 | 🟡 | Ratings exist; threshold filter missing |
| 67 | Where provider details enabled | Front + back end | 🔴 | |
| 68 | Show provider count in booking summary | Yes | 🔴 | Shows names, not count |
| 69 | Live reviews | Yes | 🔴 | No approved-review display |
| 70 | Live reviews threshold | ≥5 | 🔴 | |
| 71 | Live review name display | First + last initial | 🔴 | |
| 72 | Same-day bookings | No (2-day cutoff) | 🟡 | No booking cutoff logic |
| 73 | Payment summary visibility | Customer backend | 🟡 | Pricing visible; no dedicated summary |
| 74 | Primary phone required | Yes | 🔴 | Not enforced on booking form |
| 75 | Disable secondary email/phone | No | 🟡 | Fields exist; no toggle |
| 76 | Customer service ratings | Yes | ✅ | Post-job rating flow |
| 77 | Industries customers can rate | Selected | 🔴 | No per-industry control |
| 78 | External review sharing | No | 🔴 | |
| 79 | Recurring signup discount after 4/5+ rating | 0.00% | 🟡 | Rating notif exists; no discount logic |
| 80 | Customer job media visibility | Yes | 🔴 | Photos in admin only |
| 81 | Reminder notifications for unassigned bookings | Yes | 🟡 | Provider-side only |
| 82 | Customer self-rescheduling | Yes | ✅ | |
| 83 | Reschedulable service categories | Selected | 🔴 | No per-category control |
| 84 | Customer postpone bookings | Yes | ✅ | |
| 85 | Postpone pre-charged bookings | No | 🔴 | No prepaid block |
| 86 | Customer self-cancellation | Yes | ✅ | |
| 87 | Recurring cancellation options (single/from-point/entire) | All three | 🟡 | Model exists; scope options missing |
| 88 | Customer cancellable services | Selected | 🔴 | No per-category control |
| 89 | Admin confirmation before cancellation leaves dashboard | Yes (recurring) | 🟡 | Partial gating |
| 90 | Refund pre-charged customer cancellation | Yes | 🟡 | Infra exists; rule not wired |
| 91 | Provider cancellation payment if customer resumes | Keep payment | 🔴 | No resume logic |
| 92 | Facebook share coupon | Yes | 🔴 | |
| 93 | Facebook coupon content | $15 off | 🔴 | |
| 94 | Twitter referral description | $15 link | 🟡 | Referral codes exist; no social share |
| 95 | Unconfirmed booking display | Pending | ✅ | |
| 96 | Tooltip | Off | 🔴 | |
| 97 | FAQ/Support URL | teamcleano.com/contact | 🔴 | |
| 98 | Customer My Drive | No | 🔴 | (matches "No") |
| 99 | Customer invoice downloads | Booking/gift card/invoice | 🟡 | Invoice PDF yes; gift-card no |
| 100 | Customer gift card updates | No | 🔴 | |
| 101 | Card added by customer → all bookings | Yes | 🔴 | Applied to card jobs only |
| 102 | SMS notification opt-in default | Checked | 🟡 | Channel exists; default not set |

## 9. Provider (Cleaner) Settings — 🧹 Cleaner

| # | Setting | Spec Value | Status | Notes |
|---|---|---|:---:|---|
| 103 | Provider type / reimbursements | Contractor | 🟡 | No contractor/employee type enum |
| 104 | Contractor variables | Add variable | 🟡 | Payout reimbursements field exists |
| 105 | Team members work individually/with teams | Yes | ✅ | Multi-cleaner jobs |
| 106 | Default provider pay | 40% | 🟡 | Pay multiplier exists; no 40% default config |
| 107 | Provider overridden time handling | Reset | 🔴 | No override-time field |
| 108 | Provider My Drive | Yes | 🟡 | No dedicated drive |
| 109 | Provider file uploads | Yes | 🟡 | Chat uploads only |
| 110 | Provider speed tag | No | 🔴 | |
| 111 | Disable provider help center tab | No | 🔴 | |
| 112 | Provider pay basis | Original total | ✅ | |
| 113 | Apply discounts to flat/hourly pay | Yes | ✅ | |
| 114 | Provider profile editing | Yes | ✅ | |
| 115 | Provider password reset | Yes | ✅ | |
| 116 | Provider self-settings management | Yes | 🟡 | Availability only |
| 117 | Reason required for settings modification | No | 🔴 | |
| 118 | Admin approval for settings request | No | 🔴 | |
| 119 | Active bookings during account changes | Move to unassigned | 🟡 | Manual move exists; no auto-trigger |
| 120 | Provider editable settings (industries, pricing…) | Selected | 🟡 | Limited fields |
| 121 | Provider tutorial video | Vimeo | 🔴 | |
| 122 | Provider own ratings visibility | Yes | ✅ | |
| 123 | Customer email visible to provider | No | 🟡 | Not shown, but no explicit gate setting |
| 124 | Customer phone visible to provider | Yes | 🟡 | Shown; not configurable |
| 125 | Customer name/photo visible to provider | Yes | 🟡 | Name yes; no photo field |
| 126 | Provider pairing | Yes (override global) | 🟡 | Multi-cleaner yes; no formal pairing |
| 127 | Divide job length by number of providers | No | ✅ | Team split logic present |
| 128 | Provider availability management | All locations | ✅ | |
| 129 | New provider schedule default | Pick custom | 🔴 | |
| 130 | Default provider schedule | Sun–Sat 8–6 | 🔴 | No default template |
| 131 | Provider schedule editing | Yes | ✅ | |
| 132 | Active bookings during schedule changes | Move to unassigned, notify | 🟡 | Partial |
| 133 | Provider scheduling tutorial | Vimeo | 🔴 | |
| 134 | Clock in/out feature | Yes | ✅ | |
| 135 | Tracking type (GPS path) | Yes | 🟡 | Lat/long fields exist; provider GPS path missing |
| 136 | Distance unit | Kilometers | 🔴 | |
| 137 | Disable auto clock-in | Yes | 🟡 | Manual clock-in (matches intent) |
| 138 | Automatic clock-outs | No | 🟡 | AUTO_CLOCK_OUT referenced |
| 139 | Auto clock-out distance | 500m | 🔴 | |
| 140 | Booking completion trigger | On job length | 🔴 | Completion is manual |
| 141 | Pair/team clock-out method | Individually | ✅ | |
| 142 | Provider re-clock-in | Yes | 🔴 | Re-clock-in is blocked |
| 143 | Time adjustments update booking | No | 🔴 | No time-adjust logic (matches "No") |
| 144 | Disable provider override popup after clock-out | No | 🔴 | No popup exists |
| 145 | Team tracking method | Everyone individually | 🟡 | |
| 146 | Pair/team customer notifications | Single consolidated | 🔴 | Possible duplicates |
| 147 | On The Way reminder | 10 min before | 🟡 | Constant exists; flow to verify |
| 148 | Clock-in reminder | 10 min after | 🟡 | |
| 149 | Auto-send provider schedule | No | 🔴 | (matches "No") |
| 150 | Provider self-signup | No | 🟡 | Signup exists; no disable toggle |
| 151 | Digital signature | No | ✅ | DocumentSignature model exists |
| 152 | Feedback feature | No | 🔴 | (matches "No") |
| 153 | Late arrival message | Admin only | ✅ | |
| 154 | Late arrival message text | Template | ✅ | |
| 155 | Late arrival button name | "Late Arrival Message" | 🟡 | Not configurable |
| 156 | Provider booking notes | Yes | ✅ | |
| 157 | Show payment method to provider | No | 🟡 | Shown only in withdraw flow |
| 158 | Show booking price to provider | No | 🟡 | **Currently shown — opposite of spec** |
| 159 | Hide provider payments from providers | No (show all) | ✅ | Providers see earnings |

## 10. Admin Settings & Payment Gateways — 🧑‍💼 Admin / ⚙️ System

| # | Setting | Spec Value | Status | Notes |
|---|---|---|:---:|---|
| 160 | Minimum gift card amount | $150 | 🟡 | Tiers exist; min not enforced |
| 161 | Edit gift card below minimum | No | 🔴 | No edit logic |
| 162 | Maximum gift card limit | No | 🟡 | Tiers cap at $400 |
| 163 | Credits to referred person | $15 | ✅ | |
| 164 | Credits to referrer | $15 | 🟡 | **Built as $10** — decision needed |
| 165 | Card hold description | Custom text | 🔴 | Hardcoded descriptor |
| 166 | Charge booking description | Custom text | 🔴 | Hardcoded |
| 167 | Separate charge description | Custom text | 🔴 | |
| 168 | Charge invoice description | Custom text | 🔴 | |
| 169 | Payment processor | Enabled | ✅ | |
| 170 | Connected processor | Stripe | ✅ | |
| 171 | Available processors | Stripe/Square/PayPal/Authorize | 🟡 | Stripe only |
| 172 | 3DS / SCA | Enabled | ✅ | |
| 173 | Billing address associated with card | Disabled | ✅ | Not required (matches "Disabled") |
| 174 | Provider payment accounts | Enabled | 🟡 | Payout tracking; no Stripe Connect linking |

## 11. Scheduling Settings — ⚙️ System / 🧑‍💼 Admin

| # | Setting | Spec Value | Status | Notes |
|---|---|---|:---:|---|
| 175 | Recurring booking scheduling method | Just one appointment | ✅ | Generated at booking |
| 176 | Recurring bookings blocked into future | 3 | 🟡 | Horizon to verify |
| 177 | Show all upcoming bookings before confirmation | No | ✅ | Matches "No" |
| 178 | Apply same provider when added from cron | No | 🟡 | No cron-created recurring yet |
| 179 | New recurring booking based on | Last booking | 🔴 | Generated upfront, not from last |
| 180 | Provider availability based on form selections | No | ✅ | Matches "No" |
| 181 | Max time per team/provider per booking | 0 (disabled) | ✅ | Matches "disabled" |
| 182 | Provider availability check for recurring | First appointment | 🔴 | No recurring availability check |
| 183 | Assign providers based on job lengths | No | ✅ | Matches "No" |
| 184 | Spots availability check for recurring | First appointment | 🔴 | |
| 185 | Skip holidays | No | ✅ | Blocked-dates system |
| 186 | Users blocked from booking on holidays | Customer | ✅ | |
| 187 | Check spots based on provider/team availability | No | ✅ | Matches "No" |
| 188 | Provider assignment method | Accepted automatically | 🔴 | Uses accept/decline invites |
| 189 | Providers see & accept unassigned bookings | Yes | ✅ | Available-jobs folder |
| 190 | Providers see unassigned even if not applicable | Yes | 🟡 | No applicability filter |
| 191 | Notify all providers of new unassigned booking | Yes | ✅ | |
| 192 | Check working hours before unassigned notification | Yes | 🔴 | No working-hours check |
| 193 | Allow provider to grab if unavailable/overlap | Yes | 🟡 | No conflict validation |
| 194 | Override per-provider unassigned visibility | Yes | 🔴 | No per-provider setting |
| 195 | If provider not available at acceptance | Deny | 🔴 | No availability check at accept |
| 196 | Waiting list | Yes | ✅ | |
| 197 | Default update behavior for recurring bookings | All future | 🔴 | No bulk recurring edit |

## 12. Services, Website, Domains, Translation & Notifications — 🧑‍💼 Admin / 🛒 Customer

| # | Setting | Spec Value | Status | Notes |
|---|---|---|:---:|---|
| 198 | Services list | (empty) | 🟡 | Add-ons exist; no full catalog |
| 199 | Services actions (add/edit/bulk) | Yes | 🟡 | |
| 200 | Job openings | 2 positions | ✅ | Careers + applications |
| 201 | Website theme | Simple | 🟡 | Public landing pages; no theme system |
| 202 | Website actions (preview/customize) | Yes | 🔴 | |
| 203 | Preview website URL | bookingkoala link | 🔴 | |
| 204 | Design Forms & Website submenu | Yes | 🔴 | |
| 205 | Embed booking form | iframe/link | 🔴 | |
| 206 | Generate embed code for industry | No | 🔴 | |
| 207 | Embed login form | link | 🔴 | |
| 208 | Embed signup form | link | 🔴 | |
| 209 | Embed send gift card form | link | 🔴 | |
| 210 | Embed lead/contact form | link | 🔴 | |
| 211 | Embed live reviews | Available | 🔴 | |
| 212 | Primary domain | Custom domain | 🔴 | No custom-domain config |
| 213 | Provider app languages | English | ✅ | English only (matches) |
| 214 | Customer portal languages | English + French | 🔴 | No French / i18n |
| 215 | Default provider app language | English | ✅ | |
| 216 | Default customer portal language | English | ✅ | (French still to build) |
| 217 | Translation tool | Yes | 🔴 | |
| 218 | FAQs | 20 active | 🔴 | No FAQ module |
| 219 | Visible FAQ examples | Themes/accounts | 🔴 | |
| 220 | Notification email sender | info@teamcleano.com | ✅ | Via env config |
| 221 | Notification display name | Cleano | ✅ | |
| 222 | Admin notification email | info@teamcleano.com | 🟡 | |
| 223 | Customer reply-to email | info@teamcleano.com | 🟡 | Verify Reply-To header |
| 224 | Notification channels | Email + SMS | ✅ | Resend + Twilio |
| 225 | Master template for customer emails | Enabled | 🟡 | Templates exist; no editor |
| 226 | Master template for other emails | Enabled | 🟡 | |

---

## ⚠️ Decisions Needed From You

1. **Cancellation fee** — built as **$20 / 48h**, spec says **$25 / 24h**. Which is correct? *(rows 37, 41)*
2. **Referrer credit** — built as **$10**, spec says **$15**. Which is correct? *(row 164)*
3. **Booking price visible to cleaners** — currently **shown**, spec says **hide**. Confirm. *(row 158)*
4. **French portal** — launch requirement or later phase? *(row 214)*
5. **Services catalog** — no services configured yet; we need the final list + prices. *(rows 198–199)*
6. **Provider assignment** — spec wants **auto-accept**; we currently use **accept/decline invites**. Confirm desired model. *(row 188)*
7. **Branding** — payment descriptors and some links still reference the old platform; confirm customer-facing wording. *(rows 165–168, 203)*

---

## How We Suggest Proceeding

1. **You review** and confirm the 7 decisions above + mark any rows as "not needed."
2. We convert agreed rows into a **phased plan** (Phase 1 = launch-critical, Phase 2/3 = enhancements).
3. We start with **🟡 Partial items** — many are quick because the groundwork already exists.

*Statuses reflect a code audit as of June 16, 2026 and may be refined as edge cases are verified together.*
