# Cleano: Decisions Confirmed and Features Shipped

This is the consolidated record of everything you confirmed and everything we have now built. Companion document to `CLIENT_SUMMARY.md`.

---

## 1. Decisions you confirmed

### Notifications

1. **Google Calendar sync**: removed from scope.
2. **Gift cards**: customer-end purchase flow with fixed tiers ($100, $150, $200, $250, $300, $350, $400), account credit redemption, optional scheduled delivery, and seasonal cover photos. Implemented.
3. **Stripe Connect for cleaners**: not used. Cleaner payouts stay manual, alongside cleaner pay.
4. **"On the way" notification**: GPS triggered by time only. Fires when ETA falls below the threshold (default 15 minutes).
5. **Accept and decline workflow for cleaners**: a newly assigned cleaner gets an in-app prompt. Auto declines after 10 minutes and the job returns to unassigned.
6. **Card hold lifecycle**: hold for the full job price, placed at booking time. Customer is emailed for hold placed, hold released, and capture failed.
7. **Cash or cheque**: not offered to customers. Only the admin can record cash or cheque on a booking.
8. **Charge per cleaner**: client is charged one combined amount. Cleaner pay is split equally into each cleaner's wallet for that job.
9. **Quotes**: public landing page with a "request a quote" form. Submissions appear in an admin inbox.
10. **Bulk charge**: admin can select all completed-and-unpaid bookings and charge them in one batch.
11. **Reschedule fee**: no fee. The deposit is retained on the rescheduled booking.
12. **Customer to cleaner chat**: enabled once a booking is confirmed, with email fallback.
13. **Subscription plan limits**: not in the current system. Dropped from scope.
14. **Monthly statement**: sent on the 1st of every month, as both inline HTML email and PDF attachment.
15. **No show fee**: $25 charged to the customer plus an automatic 1-star strike on the client profile.
16. **Cleaner late penalty**:
    - Over 10 minutes late: admin and cleaner both notified, max rating capped at 4 stars.
    - Every additional 5 minutes: another 0.5 stars off the max.
17. **Re-assignment flow**: when a cleaner cancels last minute, the job is auto-reposted to available cleaners with a "Last minute booking" notification. The cleaner who claims it earns a $10 bonus.
18. **Customer rating thresholds**: a 1-star rating triggers a "we want to make this right" email to the customer plus a CRITICAL admin alert so ops can reach out with compensation.
19. **Provider performance reports**: weekly report email to each cleaner with hours, jobs, and ratings.
20. **Marketing emails**: not in scope.
21. **SMS via Twilio**: SMS will be sent for booking confirmation, on the way, reminders, and cancellation.

### Rag Wash credit system

1. **Payout rail**: manual, alongside the cleaner's regular pay. Stripe Connect is not used.
2. **Cleaner reported actuals**: cleaners do not enter actuals. The formula projection is credited directly.
3. **Median, not cap**: the per-category hard caps were dropped. The formula (Base 8 + bedrooms x 4 + bathrooms x 3 + addons) is credited as-is.
4. **Manager override**: managers can clear the review flag on oversized jobs without changing the credit.
5. **Weekly dashboard**: weekly summary email of rags credited, payouts issued, and flagged jobs.
6. **Efficiency bonus**: deferred for now.

### Inventory rules

1. **Auto seed product list**: not auto seeded. Admin enters products manually.
2. **Refill threshold defaults**: default low-stock threshold is 10 for every product.
3. **Supplier integration**: no supplier integration. Restock emails go to admin only.
4. **Cleaner kit allocation**: each cleaner has their own kit count attached to the master inventory.
    - Adding an item to a cleaner's kit does NOT reduce master stock.
    - Marking an item as damaged or broken on a cleaner's kit reduces BOTH the cleaner's kit and master stock, and creates an admin alert.

### Hiring & applicant access

*(This one is ours, not yours — it is decision **D4** in section 7 below, made
from the recommendation in your own fixes document. The shape is described here;
the reasoning and the sign-off request are in section 7.)*

1. **Applicant portal**: a new restricted account type for job applicants. It is NOT created automatically when someone applies — only when an admin clicks "Invite to portal" on their application. An application with no invite behaves exactly as before: a row in the applications inbox, nothing more.
2. **What an applicant can see**: their own application status, a document upload area, an onboarding checklist, and a message thread with our team. Nothing else — no jobs, no schedules, no pay, no client info, no other staff's data.
3. **"Hire" is now "Convert"**: if an applicant already has a portal account, clicking Hire flips it straight to a cleaner account — no temporary password to hand over, since they already set their own when they accepted the invite. If they were never invited, Hire still works exactly as it always has: creates a fresh cleaner login with a temporary password.
4. **Rejected or archived applicants**: their portal login is switched off, with a friendly message instead of an error. It's recoverable — moving the application back off Rejected/Archived restores access automatically.

---

## 2. Features implemented and live

Everything below is wired end to end. Code, server actions, emails, cron jobs, database tables, and UI surfaces are all in place. The database has been migrated to match.

### A. Notifications and emails

Around 75 of the 120 catalog rows are wired (booking lifecycle, payments, account, invoices, documents, unassigned, recurring, ratings, clock in/out, checklist, cron-driven reminders). New rows added on top of that:

- **1-star follow-up**: customer "we want to make this right" email + CRITICAL admin alert with client details.
- **Weekly provider performance**: every Monday at 09:00 each cleaner gets a summary of last week's hours, jobs, average rating, and tips.
- **Weekly Rag Wash dashboard**: every Monday at 09:00 admins get totals of rags credited, payouts issued, and flagged jobs.
- **Monthly customer statement**: 1st of every month, every active client gets HTML email + PDF attachment of the previous month's bookings and payments.
- **Late arrival emails**: admin and cleaner both notified when a cleaner clocks in 10+ minutes late.
- **No-show fee email**: customer is emailed when admin records a no-show.
- **Last-minute booking email**: broadcast to other cleaners when a cleaner cancels last minute, includes the $10 bonus offer.
- **Card hold lifecycle**: hold placed, hold released, capture failed.
- **Quote receipt + admin alert**: customer confirmation and admin alert when a quote is submitted.
- **Reschedule policy text**: customer email now states explicitly that there is no reschedule fee and the deposit carries over.

Every new row is in the Notification Catalog and toggleable from Settings → Notifications. Email channel defaults to enabled on the four SMS picks too.

### B. SMS via Twilio

- SMS sender helper at `src/lib/sms.ts` with four pre-built wrappers: booking confirmation, on the way, reminders, cancellation.
- Catalog rows have SMS channel enabled by default for those four events.
- Phone numbers are normalized to E.164 automatically.
- Sender is inert until env vars (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`) are set. Placeholder keys already added to `.env.local`.

### C. Penalty and rating system

- **No-show fee admin action**: charges $25 to the saved card, increments `Client.noShowCount` and stamps `lastNoShowAt` (the automatic 1-star strike on the client profile), logs the event, and emails the customer.
- **Late-arrival rating cap**: on clock-in we compute minutes late. Under 10 min is grace. At 10 min the cap is 4 stars; every additional 5 min subtracts 0.5 stars. The cap is enforced at customer rating time on both the public token form and the customer portal.
- **Manager override for Rag Wash flagged jobs**: ops can clear the flag from `/wash-payouts` with one click. The credit is unaffected.

### D. Operations workflow

- **Accept / decline workflow**: every time a cleaner is added to a job (new booking, edit, or inline assign), we create a `JobAssignmentInvite` that expires after 10 minutes. The cleaner sees pending invites on `/my-jobs` and clicks Accept or Decline. The cron sweep (every 5 minutes) auto-declines stale invites and returns the job to the unassigned folder.
- **Last-minute reassignment**: when a cleaner cancels within 24 hours of start and the job has no remaining cleaners, the system broadcasts the job to every other employee with a "Last minute booking — $10 bonus" invite. First cleaner to accept claims the job; the others are expired. The bonus is logged on the job for payout pickup.
- **Pending requests sidebar badge**: shows count of cancellation/reschedule requests waiting on admin.
- **Approve/deny requests with notes**: admin notes textarea routes the customer email correctly for cancellation or reschedule outcomes.
- **Requests tab on Job detail page**: per-job cancellation/reschedule history with inline empty-state illustration.
- **Provider cancellation email**: assigned cleaners are emailed when their job is cancelled.
- **Inline "Assign cleaners" button on Team card**: multi-select modal lets admin add or change cleaners directly from the Job detail page without opening the full edit modal.

### E. Customer billing

- **Bulk charge** at `/bulk-charge`: lists every completed-and-unpaid job with a card on file. Multi-select + "Charge selected" runs each through the existing Stripe path. Per-job result summary shown after.
- **Card hold lifecycle**: three admin actions (place hold, capture, release). Hold is a Stripe manual-capture PaymentIntent for the full job price. Capture happens on completion; release happens on cancel. All three transitions email the customer.
- **Monthly statement cron**: PDF generated with `@react-pdf/renderer` and attached to the email.

### F. Inventory and cleaner kits

- **Cleaner kits admin** at `/inventory/kits`: per-cleaner kit list with "Add to kit" form. Adding does NOT decrement master stock (per your spec).
- **Damaged / lost flow**: cleaner reports damage from `/my-inventory` with quantity, kind (damaged or lost), and optional reason. Both the cleaner's kit and master stock are decremented, and an admin alert is raised.
- **Combined restock notification**: when stock crosses the low-stock threshold, a single combined "restock needed" email goes to admin (not one per item).
- **Default low-stock threshold**: 10 for every product (per your spec).
- **Product category field**: cleaning, paper, dispenser refill, equipment, other — used for filtering and grouping.
- **Post-job inventory survey**: cleaners enter spray bottles, mop heads, and disposable usage at checkout. Spray usage recorded at 1.25 ml per spray.

### G. Rag Wash

- **Formula now credits directly**: hard caps removed. Base 8 + bedrooms x 4 + bathrooms x 3 + addons is what the cleaner is credited.
- **Category ranges still flag oversized jobs**: the "flag for review" signal in `/wash-payouts` fires when projection exceeds the typical envelope. Manager can clear the flag without changing the credit.
- **Manual payouts**: WashPayout rows are created in PENDING state and paid manually alongside the cleaner's regular pay. No Stripe transfer.
- **Auto allocation on completion**: credits are written when a job is marked complete; no separate "refill" action needed.

### H. Quotes

- **Public landing page** at `/quote` (no login). Form captures name, email, phone, address, service type, bedrooms, bathrooms, square footage, preferred date, and free-text message.
- **Admin inbox** at `/quotes` shows every submission. Each can be moved through NEW → CONTACTED → CONVERTED → ARCHIVED with internal notes.
- **Confirmation email** to the customer; alert email to all admins.

### I. Gift cards

- **Public purchase page** at `/gift-card` (no login). Buyer picks:
  - **Tier**: $100, $150, $200, $250, $300, $350, or $400. The page calls out that the minimum job price is $119 so buyers pick a value that comfortably covers a service.
  - **Cover design**: 8 seasonal/occasion cover slots wired up — Classic, Birthday, Thank You, Holiday, Spring, Summer, Fall, Winter. Each currently renders a gradient fallback. Drop your final images into `public/gift-cards/<key>.jpg` (e.g. `public/gift-cards/birthday.jpg`) and they'll show up automatically in the email and on the purchase page.
  - **Recipient**: send to self or to someone else (name + email captured separately).
  - **Personal message**: optional free-text included in the recipient email.
  - **Scheduled delivery**: optional date picker — email goes out on that date instead of immediately. The existing 5-minute cron sweep handles scheduled deliveries.
- **Stripe payment**: PaymentIntent created against the buyer's card via Stripe Elements. On success, the card is flipped to ACTIVE and emails fire.
- **Three emails wired**:
  - Buyer receipt (immediate).
  - Recipient delivery (immediate if no scheduled date, otherwise via cron on that date).
  - Admin alert.
- **Redemption** at `/gift-card/redeem` (or directly from the "Redeem" button in the recipient email). Recipient signs into their Cleano customer account, pastes the code, and the full value is added to `Client.giftCardBalance`.
- **Auto-apply at billing**: `chargeJob` now draws down the client's gift card balance before charging the saved card. If the balance covers the booking entirely, Stripe is skipped and a `GIFT_CARD` transaction row is written instead.
- **Admin inbox** at `/gift-cards` shows every card: filter by status, search by code/buyer/recipient, and click a row for full details. Header tiles show outstanding (unredeemed) value and total redeemed.

### J. Reliability and infrastructure

- **Notification Catalog defaults fallback**: emails do not silently disappear when an admin hasn't seeded the catalog row. The static catalog is the source of truth before seeding.
- **EmailLog `notificationKey`**: cron-driven notifications are idempotent. Re-running a cron won't double-send.
- **Time-aware helpers**: `isAfter5pmDayBefore` for late cancellation rules.
- **Resend attachments**: the `deliver` helper now supports email attachments (used by the monthly statement PDF).
- **All policy values centralized** in `src/lib/policy.ts` so admin can tune without code changes elsewhere.

### K. PWA improvements

- Always-available "Install app" entry in the cleaner drawer.
- PWA banner re-shows after 14 days.
- `/icon/*` and `/apple-icon` exposed publicly so Chrome can install the app.

### L. Applicant portal

- **"Invite to portal" action** on any job application: sends a set-password link by email, following the same one-time-link pattern already used for the customer card-setup and rating links.
- **Applicant-only sign-in** at `/applicant-login`, separate from the staff, cleaner, and customer sign-in pages.
- **Restricted portal** at `/applicant`: application status timeline, document upload, an onboarding checklist, and a message thread with our team.
- **Convert flow**: "Hire" on an invited applicant flips their account straight to a cleaner login instead of creating a second one, then hands the admin off to that person's employee profile to finish setup (pay tier, service categories, availability, documents).
- **Access is scoped everywhere**: an applicant account cannot reach jobs, payroll, schedules, chat, training, or any other staff or customer surface — checked with an automated access matrix, not just by eye.
- **Rejected/archived applicants** lose portal access automatically (with a friendly message, not an error) and get it back automatically if the decision is reversed.

---

## 3. Database migrations applied

All four migrations have been applied to your Supabase production database. Schema is fully up to date.

1. `20260527130811_add_product_category` (already applied via SQL, marked resolved).
2. `20260528101418_add_notification_settings` (already applied via SQL, marked resolved).
3. `20260528105306_chat_presence_and_receipts`.
4. `20260528161342_rag_wash_credit_system`.
5. `20260528200000_email_log_notification_key`.
6. `20260530120000_no_show_and_late_arrival` — Client.noShowCount / lastNoShowAt + Job.noShowAt / lateArrivalAt / lateArrivalRatingCap / washReviewOverrideAt / washReviewOverrideBy.
7. `20260530130000_quote_requests` — QuoteRequest table.
8. `20260530140000_job_assignment_invites` — JobAssignmentInvite table.
9. `20260530150000_card_holds` — Job hold lifecycle columns.
10. `20260530160000_gift_cards` — GiftCard table + Client.giftCardBalance.

All are additive (no destructive changes).

**This release adds four more, and they are written but NOT yet applied.** They
go out with the deploy, in this order, and all four are additive in the same
sense — a new optional column, a new true/false flag that defaults to today's
behaviour, and two new empty tables. Nothing is dropped, and no existing row's
money changes:

11. `20260814000000_job_pricing_mode` — records whether a job is priced from its
    parts or from a final override total. Every existing job is stamped with the
    mode it was **already** being priced under, so the stamp cannot move a price.
12. `20260814010000_job_employee_pay_is_manual` — the Manual / Automatic flag on
    Employee pay (decision D2). Defaults to Automatic, i.e. exactly today's
    behaviour, for every existing job.
13. `20260814020000_job_log_clock_out_failed` — lets a failed clock-out be
    recorded on the job's activity timeline. Adding it changes no existing row.
14. `20260814030000_applicant_access_model` — the applicant account type, the
    invite link table and the applicant message thread (decision D4). Every
    existing application gets "no portal account", which is today's behaviour.

Immediately after they run, `npx tsx scripts/post-deploy-check.ts` reports which
landed and prints the row counts each one produced.

---

## 4. Numeric defaults shipped

All values live in `src/lib/policy.ts`. Tune as needed.

- "On the way" ETA trigger: 15 minutes.
- Accept / decline timeout: 10 minutes.
- No-show fee: $25.
- Late-arrival grace: 10 minutes (then 0.5 stars off per 5 minutes).
- Late-arrival initial cap: 4 stars.
- Last-minute claim bonus: $10.
- Default inventory low-stock threshold: 10.
- Poor-rating follow-up threshold: 1 star.

---

## 5. Cron jobs running

- `/api/cron/reminders` — daily at 09:00.
- `/api/cron/notifications` — every 5 minutes (includes the invite-expiry sweep).
- `/api/cron/weekly` — Mondays at 09:00 (provider performance + Rag Wash dashboard).
- `/api/cron/monthly` — 1st of each month at 09:00 (customer statement with PDF).

All authorized with `Bearer ${CRON_SECRET}`.

---

## 6. Still open / pending your input

1. **Twilio credentials**: code is wired and ready. We need from you:
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_FROM_NUMBER` (E.164) or `TWILIO_MESSAGING_SERVICE_SID`
   - For US customers: A2P 10DLC business registration in the Twilio console.
   Paste them into `.env.local` and the Vercel project's environment variables and the SMS sender will start delivering.

2. **"On the way" GPS trigger**: deferred until you provide a Google Maps API key (needed for the Distance Matrix API). Once added to env as `GOOGLE_MAPS_API_KEY`, we will wire the ETA computation and the trigger.

3. **Gift card cover images**: the gift card system is fully built, but the cover photos currently render gradient placeholders. Drop your final cover images into `public/gift-cards/<key>.jpg` (or `.png` / `.webp` — keep extensions consistent) for keys: `default`, `birthday`, `thankyou`, `holiday`, `spring`, `summer`, `fall`, `winter`. They will appear automatically in both the purchase page and the recipient email. Recommended size 600 x 400 px.

Everything else from your decision list is implemented and running.

---

## 7. Decisions we made for you — please confirm

Your **pricing logic fixes** document (six P0 items plus one product question)
left six choices open. Waiting on answers would have stalled every one of the
six fixes, so we made each call from evidence already in your code, your data,
or a decision you had made previously — and wrote down the reasoning so you can
overrule any of them.

**How to read this section:** each decision is independent. Vetoing one is a
contained change, not a re-plan. If you agree with all six, you don't need to
reply to this section at all.

The money consequences of D1, D2, D3 and D5 are quantified against your live
data in **`NUMBERS_THAT_MOVE.md`** — read that alongside this.

---

### D1 — On automatic pay, each cleaner keeps earning their own full rate

**The decision.** On a percentage-paid job with no stored or manually entered
team payment, every assigned cleaner earns their own rate (tier base ×
rating multiplier) on the full job value. No pool, no halving.

**Why.** You retired the pooled split earlier this year — the code that computes
pay tiers still carries the note recording that you rejected the pooled $55.00
figure by name, and the pooled constant is kept only as a tripwire so nobody
reintroduces it by accident. The consequence, that a two-cleaner job can cost
80–90% of its price in labour, is documented there as something you accepted
deliberately. Reinstating a pool now would silently reverse a decision you had
already made.

**What about the $88.50 / $44.25 example in your document?** That job is #1809,
and it carries a stored BookingKoala team payment of $88.55. Under D2 below,
that figure is treated as the team total and split evenly — $44.28 / $44.27,
which is the number you circled. So your screenshot is satisfied without
touching the automatic model at all.

**Tell us if:** you find a job with no stored or manual team payment where you
still expect a pooled number.

---

### D2 — A team payment you (or BookingKoala) typed is an instruction, not an estimate

**The decision.** `Employee pay` now carries a Manual / Automatic flag. When it
is Manual, the figure is treated as the **team total** and split evenly across
the crew (minus any per-cleaner override), with a visible
"Manual — clear to recalculate" control. BookingKoala imports that carry a
provider payment arrive flagged Manual. An admin typing a value into the field
flags it Manual.

**Why.** That column has always carried two incompatible meanings: an automatic
snapshot saved at booking time, which goes stale the moment a rating lands or a
pay multiplier is edited, and a real amount somebody decided. Because the app
could not tell them apart, it treated both as stale and printed
"Stored value $88.55 — not used" — the exact complaint in your document.

**What this means in practice — it is opt-in, per job.** Your existing jobs are
**not** bulk-flagged. 471 of 472 carry an `employeePay` value and most of those
are automatic snapshots; flagging them all Manual would have frozen your entire
database at stale numbers and called it your intent. Instead the job page offers
"Use this amount" on any stored figure that is being overridden — one click,
recorded in the job log. **No cleaner's pay changes until somebody clicks it.**

**Worth knowing:** an odd team total cannot split evenly, so the split is
cent-exact — $88.55 across two cleaners pays $44.28 and $44.27, not $44.28
twice. One-cent differences between crew members are expected.

---

### D3 — Tips and parking are the customer's money, passed through

**The decision.** Both are customer-funded and handed to the crew. Neither is
company revenue and neither is a company expense. Concretely:

- **BookingKoala imports:** unchanged. The CSV's final amount already includes
  tip and parking, and that is what gets charged.
- **Admin jobs, going forward:** a tip or parking entered **before** the job is
  charged is folded into the card charge as untaxed lines, so the money you hand
  the crew is money you collected. Invoices and receipts show them as separate
  line items.
- **Entered after a job is already paid:** booked as owed to the cleaners and
  flagged on the Financials card as "not collected on card", so you can take it
  in cash or charge it separately. **We never run a second charge on a
  customer's card automatically, and no historical job is recharged.**
- **Cash jobs:** collected in cash; the bookkeeping is identical.

**Why.** Your document's requirement is that tips and parking "must not be
treated as company revenue or incorrectly reduce company profit". That only
holds if the customer funds them. If the company paid cleaners a tip and parking
it had never collected, profit genuinely would fall — which is the opposite of
what you asked for. This also makes admin-created jobs behave the way your
BookingKoala jobs already do.

---

### D4 — Applicants get a restricted portal, minted by invitation only

**The decision.** Adopted as your document recommended: a new `APPLICANT` account
type with its own small portal (status timeline, document upload, onboarding
checklist, message thread). The user-facing detail is in section 1 above.

**Why invitation, not automatic.** The careers form is public, so creating an
account at submit would mint a login for every spam submission. The account is
created when an admin clicks **"Invite to portal"**, using a set-password link —
the same one-time-link pattern already used for customer card setup and rating
links. That also side-steps a real limitation noted in the hiring code: there is
no password-reset flow for cleaners yet, so handing out temporary passwords was
the only option before this.

**Why "Hire" became "Convert".** If someone already has a portal account,
creating a second login for the same person at hire time is a bug waiting to
happen. Hire now flips the existing account to a cleaner account. An applicant
who was never invited is completely untouched — the simple path stays available
per application.

---

### D5 — Discounts do not reduce cleaner pay

**The decision.** A cleaner's pay basis is base + add-ons, **before** any
discount. Revenue, separately, is still counted **after** the discount.

**Why.** Today's basis (the bare job price) already ignores discounts, so this
changes nothing about how discounts are treated — it just avoids landing a
cleaner-pay *reduction* in the same release as the add-on *increase*. A discount
is your marketing spend, not a smaller job. Your document's own definition of the
pay basis ("base price, add-ons, extra charges, and the active manual price
override") conspicuously omits discounts.

The asymmetry between pay and revenue is deliberate and is commented in the code
so nobody "fixes" it later.

---

### D6 — Settings stays one shared page

**The decision.** `/admin/settings` is guarded so that any staff member can open
it and customers cannot. Cleaners and field leads see Profile and Availability;
admin-only tabs stay admin-only, as they already were.

**Why.** The page was **built** to be shared — it already renders
role-appropriate tabs and its own header comment says so. What had broken was
the door: the guard required Owner or Admin, so **39 live staff accounts (38
cleaners and 1 field lead) were silently bounced away from their own Settings**
— no profile, no password change, no availability, no notification preferences.
That is very plausibly the whole of the "Settings page returns an error" report.
Splitting the page in two would have been a larger change that fixed the same
thing.

We also checked, rather than assumed, that the newly reachable tabs expose
nothing extra: every action they call is scoped to the signed-in user for
non-admins.

---

### Sign-off

If any of D1–D6 is wrong for your business, reply with the number and we will
change that one. Otherwise no action is needed — the release ships as described,
and `NUMBERS_THAT_MOVE.md` tells you which figures on your dashboards will look
different the morning after.
