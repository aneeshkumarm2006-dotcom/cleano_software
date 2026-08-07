# Cleano: Work Summary for Client Review

**Part A** covers the **20 fixes from your latest list** — the most recent round of work, and the one that needs your sign-off before it goes live.

**Part B** (further down) is the earlier summary of **Notifications**, **Rag Wash credits** and **Inventory rules**, kept as-is for reference.

---

# Part A — Your latest list of 20 fixes

Everything below is built, tested and ready to deploy. Two things need a decision from you before we push: the **pay change in fix 1**, which moves real money, and the **two things we deliberately did not build**, both flagged in their own sections.

## The money items

### 1. Pay multiplier now actually changes cleaner pay

This was the headline problem: you had a **Pay Rate Multipliers** table in Settings, and it did nothing. Pay was driven by a separate rating ladder buried in the code that nobody could see or change.

There are now no two systems. A cleaner's rate is:

> **their tier's base rate × their rating multiplier**

Base rates are Trainee 30%, Standard 40%, Field Lead 46%. The multiplier is the one you set in Settings, per 0.1 rating step from 4.0 to 5.0. This reproduces your own worked example exactly: 40% × 1.13 = 45.2%, so **$45.20 on a $100 job**.

Details worth knowing:

- **A cleaner needs 5 ratings before any multiplier above 1.00 applies** — all three tiers, not just Standard. Without that, a brand-new Field Lead with one 5-star rating would jump straight to 57.5% on day one.
- **The rating average is all-time**, matching what the profile page and the pay tier already showed. Ratings you have excluded never count, anywhere.
- **Manual payouts still override everything.** If you type a cleaner a fixed amount, or the job is flat-rate or hourly, no multiplier touches it. This used to be quietly multiplied too.
- **The multiplier can be seen, not just felt.** The cleaner's pay modal now says whether their rating is boosting this job, and why not when it isn't ("2 of 5 ratings", "fixed amount", "hourly"). The admin breakdown shows `40.00% × 1.13 = 45.20% (rating 4.52)` with the ratings it came from.
- **Both ends are clamped.** Settings only accepts 0.50–2.00, and the computed rate can never exceed the job price — so a typo like `113` instead of `1.13` cannot become a payroll incident.

**⚠️ What this costs you — measured against your live data, read-only:**

| | |
|---|---|
| Last pay period (Jul 27 – Aug 2, 19 jobs, 11 cleaners) | **$2,047.53 → $2,047.53 — no change** |
| Cleaners already past the 5-rating gate today | **One** |
| Asia Smellie (Standard, 5 ratings, 5.00 average) | **45% → 50%** — a $100 job pays her $50.00 instead of $45.00 |
| Same period if every participant were past the gate | **+$68.15 (+3.3%)** |

Nothing moved in that period because none of its eleven cleaners has five ratings yet. Asia simply did not work those dates — **her next percentage-paid job moves the day this deploys.** Two more are close (4.80 and 4.50 averages).

The structural point: the ceiling rises for every tier — Standard 45% → 50%, Field Lead 46% → 57.5%, Trainee 30% → 37.5% at a 5.0-star average. The +3.3% is what that grows into as ratings accumulate. **We would like your explicit sign-off on this before deploying.**

Two side effects that will *look* like problems but are corrections:

- **Profit on BookingKoala-imported jobs will drop** in the Finances view, because it now uses the real payout instead of the provider payment recorded in the old CSV (about 26% of price). The jobs were always costing this; the report was wrong.
- **Field Lead weekly bonuses may go up**, because a rating you had already thrown out was still dragging the group average down and costing leads money. That was a bug.

### 10. Custom extra charges are actually billed

An admin's $25 custom extra charge billed **$0**. Four different parts of the system each believed something different about where add-ons lived: the job saver thought they didn't exist, the receipt thought they were inside the total, the invoice thought they were on top of it. So an invoice could disagree with the job it came from.

There is now **one calculation** that every screen uses. It knows that a web booking's price already contains its add-ons, and that an admin-typed price does not, and it prices each correctly. The job total, the receipt, the invoice and the pay breakdown can no longer drift apart.

One consequence worth flagging: an admin who **retypes the price on a web booking** takes authorship of that number, and the job is priced like any other admin job from then on. Leaving the price alone preserves the customer's original total exactly.

### 7. Add-on quantities

Customers can now book **two of the same add-on** — a stepper on the booking page, a stepper in the admin job modal, and quantities carried through the review screen, the confirmation, the receipt, the invoice and the customer portal. Repeating the same add-on is capped at 20 and coalesced into one line, so nobody can push fifty rows through the booking form.

## Booking and customers

### 2. Multiple saved addresses

Customers had **one** address field, and every new booking overwrote it — so booking a second property permanently erased the first, and the portal's "Default address" box with it.

- Customers now have a proper **address book**: add, edit, delete, set default, from their account page.
- Addresses carry **apartment / unit number, city, postal code, and access notes** (door codes, gate codes, buzzer numbers, parking). `/book` never captured a unit number at all before, which is why cleaners arrived at buildings they could not get into.
- **Access notes are shown only to the assigned cleaner** on the job page — never to a customer, never on an unclaimed job. Every change to them is recorded in the activity log (that they changed, never the code itself).
- **Picking a saved address re-runs the coverage check.** If the saved address is in a different postal code, the zone and travel fee move with it, rather than quoting one place and cleaning another.
- Deleting an address **cannot damage a booked job**: completed jobs and sent invoices keep the address they were served at.

**Decision taken:** the invoice's "Bill to" block still uses the customer's billing address, because invoices can be consolidated across several jobs. We added a separate **Service address** block that prints the job's address when an invoice resolves to exactly one job.

### 9, 15, 17 — BookingKoala imports and add-on presentation

- **9. Imported add-ons become real rows** instead of a line of text. Anything the importer can't price is created at $0 and flagged "needs review" in the import summary plus an admin alert — so nothing is lost and you price it later.
- **15. Billing text is out of cleaner- and customer-visible notes.** Imported jobs carried "Final amount CAD: …", the cleaner's payout and transaction IDs in the notes field. That is hidden on screen now, and a one-time cleanup script strips it from the stored notes at deploy — keeping the genuine "Add-ons: …" text and preserving every original in an admin-only log first. **Worth knowing:** the old cleanup script matched **0 of the 205 affected jobs**; it had never done anything.
- **17. Add-on icons and pop-ups.** Each add-on can carry an icon and an optional message shown before it's added ("we'll need a photo to price this"). A photo the customer supplies at that point becomes a job photo the cleaner can see.

### 12, 13, 18, 20 — the quick ones

- **12.** Referral rewards on the customer's account page now read the amounts from Settings. They were hardcoded to "$15 off / $10 credit" and could disagree with what was actually paid.
- **13.** Job details opens at the top instead of halfway down the page.
- **18.** The price column is readable — dark and bold instead of grey.
- **20.** "usually $10 less" removed from the flexible-time option.

## Cleaner workflow

### 6. Clock back into a job

A cleaner who left and came back had no way to record it. Worse, the clock lived on the **job** rather than on the person, which caused two real bugs on every two-cleaner job: the first to clock in **locked their teammate out**, and the first to clock out **completed the job for the whole crew**.

Work is now recorded as **sessions** — one per stretch, per cleaner, per job.

- Clock in, out, and back in as many times as the day needs. Hours are the **sum of the sessions**, not first-in to last-out: 9–11 plus 3–4 is three hours, not seven.
- **A job only finishes when the last cleaner finishes.** The customer's "rate your clean" email fires once, at that point — not when the first person leaves, and not twice after someone returns.
- **Coming back at 6pm is not a late arrival.** Lateness, penalties and strikes are measured on the first session only.
- Breaks are allocated to the session they fall inside, so one cleaner's lunch can never be deducted from their teammate's time.
- Admins can **edit or delete an individual session** from the job page, with the change and the removed times written to the job log. Editing the old combined clock is refused with an explanation, because that value is calculated now and an edit would silently revert.
- Everything that predates this keeps reporting exactly as it did — no historical hours move.

### 5. Checklists generate themselves

The checklist only appeared if somebody pressed "Generate Checklist". It now builds itself the moment an assigned cleaner **opens the job**, from the templates matching that job's type and add-ons. If you change the job afterwards, the checklist refreshes — unless the cleaner has already started ticking, in which case their progress is kept and the screen says the job changed.

### 8. Job preview before claiming

Cleaners can see what a job actually involves — property details, add-ons, scope, estimated pay — **before** committing to it. The customer's identity and contact details stay hidden until it's claimed.

### 4. The 10-minute pending hold is gone

An admin-assigned cleaner was shown a countdown threatening to release the job, and the nightly sweep stamped those assignments "EXPIRED". Neither was true — the cleaner stayed assigned either way. Direct assignments no longer expire, and the countdown is gone. What survives is the useful half: **a one-time alert to you** when an assigned cleaner hasn't confirmed. Genuine last-minute broadcast offers (first to accept wins) still expire, correctly.

### 3. Service category permissions

You can now restrict an employee to specific service categories.

- **Leaving an employee's list empty means "all categories"** — so nobody's access changes on the day this deploys. You opt *in* to restricting someone.
- **Cleaners are blocked**: a restricted cleaner doesn't see and can't claim work outside their categories.
- **Admins are only warned.** You can always assign whoever you want; the override is written to the job log.
- **Worth knowing:** 44% of your existing jobs carry free-text job types from BookingKoala ("House", "Apartment", "Move In & Out", "Deep Cleaning") that had no category at all. We taught the system to recognise them. Anything still unrecognised stays visible to everyone rather than silently disappearing from every restricted cleaner's board.

### 19. Cleaner availability when booking

Availability conflicts are checked and shown while you're building the team on a job, not after.

## Admin

### 11. Sidebar notification badges

Every attention queue now has a count in the sidebar: portal requests, job applications, quotes, your own unsigned documents, new leads, pay periods awaiting approval, and pending inventory requests. One batched request every 30 seconds, replacing a poller that fired every 5. The counts clear when you action the thing — resolving it *is* marking it read.

### 16. Void cheque / direct deposit upload

Cleaners upload their own void cheque from their Documents page; you see it on their employee record.

**Decision taken — how we handled the privacy:** every other upload in the system lands on a public link that anyone with the URL can open forever. Banking details cannot work that way. These files are stored privately and are **refused without a signature**. Only an Owner or Admin can open one, through a link that expires in five minutes, and **every view is logged**. Ops Managers and Field Leads cannot see them at all. Replacing a cheque **adds a new file rather than overwriting** — so a change of banking details is never silent.

### 14. Inventory Rules settings removed

Covered in Part B, section 3, along with the decision about the approval gate.

---

## Two things we deliberately did not build

Both are contained pieces of work. Say the word and we'll add either.

**1. No "required photos" on checklist items (fix 5).** Your scope note implies checklist items that can't be ticked without a photo. Clock-out is gated on required *items* being complete, not on photos being attached. Building the photo gate means a new field on checklist items, an upload on the cleaner's checklist, and a rule about what happens when the photo fails to upload on a bad connection — enough that it should be a decision, not an assumption.

**2. No approval step before a cleaner's reported usage updates stock (fix 14).** Explained in Part B, section 3. Short version: your brief said stock should be reviewed "where needed", and we read that as a review **trail** rather than a **gate** — because a gate would hold a cleaner's clock-out until an admin was awake to approve it, usually late in the evening. Every deduction is recorded three ways and is fully correctable after the fact.

---

## Before this goes live

1. **Sign off on the pay change in fix 1** — it is the only item that moves money.
2. We run the database migrations, then deploy the code, then run two one-time scripts (the notes cleanup, and an optional backfill of historical clock sessions).
3. One separate, later step: **dropping the old Inventory Rules table.** It is deliberately not bundled in — it destroys data that cannot be reconstructed, so it goes out on its own, after a backup point, once everything above is confirmed working.

**Testing done:** 850 automated checks across all 20 items, all passing; the whole app type-checks and builds clean; code-quality warnings are *below* where they started.

---
---

# Part B — Earlier work: Notifications, Rag Wash credits, Inventory rules

This section summarises the earlier round of work, along with items that still need your confirmation before we can finish them.

---

## 1. Notifications

### What is done

We built a central **Notification Catalog** so every email, app push, or SMS in the system is governed by a single switch you can toggle from the admin panel. Around **75 of the 120 catalog entries** are now wired end to end. The categories below are live in production code.

**Booking lifecycle**
- New booking confirmation (customer)
- New booking alert (admin), with a flag for referral bookings
- Booking modified (admin and customer)
- Booking canceled (admin, customer, and assigned cleaners)
- Cancellation request raised (admin)
- Reschedule request raised (admin)
- Customer "request resolved" email when admin approves or denies a cancel or reschedule request, with the admin note included
- After 5pm same day rules wired for the late cancellation variants

**Payments**
- Booking charged (customer)
- Card declined (customer and admin)
- New card added (admin)
- Fees charged (customer)
- Prepaid bookings confirmation (customer)
- Tip received (admin, customer thank you, provider)
- Refund issued (customer)

**Account lifecycle**
- Password reset email (both customer and provider variants)
- Password changed confirmation
- Email verification
- Signup welcome (customer and provider variants)
- Admin signup review when a new provider applies

**Invoices**
- Invoice sent
- Invoice paid
- Invoice overdue
- Invoice voided

**Documents and compliance**
- Provider document uploaded
- Admin signature request
- Document signed confirmation

**Unassigned bookings folder**
- New unassigned booking (admin)
- Booking moved to unassigned (admin)
- Cleaner grabbed an unassigned booking (admin)
- Unassigned booking modified (admin)

**Recurring bookings**
- Recurring booking confirmation (customer), reusing the booking confirmation template with a recurring flag

**Ratings, clock in/out, checklist**
- Rate us email (customer)
- New review notification (admin)
- New review for provider
- Clocked in (admin)
- Clocked out (admin)
- Checklist completed (admin)

**Cron driven reminders** (run automatically every 5 minutes, plus a 9am daily job)
- Unassigned booking deadline approaching (admin)
- Cleaner not clocked in (admin)
- Cash or cheque collection reminder (admin)
- Poor rating twice a week (admin)
- 48 hour customer reminder
- Customer never found provider (admin)
- "Leave a tip" prompt (customer)
- Provider job reminder

**Reliability features added under the hood**
- A **catalog defaults fallback** so emails do not silently disappear when the database row for a switch is missing. The system uses the catalog default and still respects any explicit override you set in admin.
- An **EmailLog notificationKey** column so cron driven reminders are idempotent. Even if a cron job runs twice, the same reminder will not be sent twice.
- Time aware helpers like `isAfter5pmDayBefore` so the late cancellation rules behave correctly.

### What needs your clarification (about 22 questions)

The remaining catalog rows (around 45 entries) cover features where the business rule is not yet clear, or where the integration is not yet in place. Please confirm the intent so we can wire each one.

1. **Google Calendar sync**: should customers and cleaners receive `.ics` attachments, or do you want a real two way sync with Google Calendar?
2. **Gift cards**: do you want a gift card purchase flow? If yes, what is the redemption flow?
3. **Stripe Connect for cleaners**: are cleaner payouts supposed to flow through Stripe Connect (instant payouts) or stay on the current manual ledger?
4. **"On the way" notification**: should the cleaner press a button in the mobile app to notify the customer they are on the way, or should this be GPS triggered?
5. **Accept and decline workflow for cleaners**: when a cleaner is assigned, should they have a chance to accept or decline the job before it is locked in?
6. **Card hold lifecycle**: do you want pre authorisation holds at booking time, captured on completion, with notifications for hold placed, hold released, and capture failed?
7. **3DS authentication**: should we send the customer an email if their card requires 3DS challenge and the booking is on hold until they complete it?
8. **Cash or cheque fee**: is there a surcharge for cash or cheque payment that we should mention in the booking confirmation?
9. **Separate charge per cleaner**: in multi cleaner jobs, do you want one combined charge or one charge per cleaner?
10. **Quotes**: do you want a "request a quote" flow that is separate from a confirmed booking, with its own email lifecycle?
11. **Bulk charge**: is there a workflow where the admin charges a list of past bookings in one batch?
12. **Reschedule fee**: should the customer pay a fee if they reschedule, and should the email mention it?
13. **Customer to cleaner chat**: should customers be able to chat directly with the cleaner once a booking is confirmed, with email fallback?
14. **Subscription plan limits**: do plans cap monthly bookings? If yes, what is the email when a customer hits the cap?
15. **Monthly statement**: do you want an automatic monthly breakdown of bookings and payments sent to each customer?
16. **No show fee**: what is the policy and the notification?
17. **Cleaner late penalty**: if a cleaner is over X minutes late, what happens and who gets notified?
18. **Re assignment flow**: if a cleaner cancels last minute, do we auto suggest replacements or just notify the admin?
19. **Customer rating thresholds**: which star rating triggers a "we want to make it right" follow up to the customer?
20. **Provider performance reports**: do you want a weekly report email to each cleaner with their hours, jobs, and ratings?
21. **Marketing emails**: are promotional emails in scope, or only transactional?
22. **SMS channel**: the catalog supports SMS as a channel. Which notifications should also send by SMS, and using which provider (Twilio, MessageBird, other)?

---

## 2. Rag Wash credit system

### What is done

We built a complete projection and credit system for rags used per job.

- **Projection logic**: for each job we compute `Base 8 plus bedrooms times 4 plus bathrooms times 3 plus addons`. Add ons follow your multiplier rules.
- **Caps**: the projection is capped per category so a single job cannot drain the stock.
- **Add on multipliers**: oven, fridge, inside cabinets, windows, and other add ons each contribute the agreed extra count.
- **Credit ledger**: `User.ragCredits` and `User.padCredits` track every cleaner's running balance. Each completed job posts the awarded credits.
- **Auto allocation on completion**: when a job is marked complete, the projected count is allocated automatically. We removed the older "manual refill" flow per your earlier request.
- **Claim flow**: cleaners see their current balance in the mobile app and can claim a payout.
- **Admin oversight**: the admin sees a list of payout requests, can approve or reject, and can see which jobs contributed to the balance.
- **Flagged jobs**: any job where projected versus capped versus actual diverges by more than the threshold is flagged for review in the admin UI.

### What is not done and needs clarification

1. **Stripe instant payout**: the payout row is currently created in **PENDING** state, but we have not connected it to a real Stripe transfer. We need confirmation that Stripe Connect Express is the chosen rail, plus the cleaner onboarding flow.
2. **Cleaner reported actuals**: today we use the projected (or capped) count as the credited count. Do you want the cleaner to input the actual rags and pads used at checkout, with admin review when there is a delta?
3. **Manager override**: should managers be able to override the cap for special cases (very large home, post construction) without flagging the job?
4. **Weekly dashboard**: do you want a weekly summary email of total rags used, payouts issued, and flagged jobs?
5. **Efficiency bonus**: if a cleaner consistently uses fewer rags than projected, do you want to issue a bonus credit?

---

## 3. Inventory rules

### What is done

- **Product category** field added to every product (cleaning, paper, dispenser refill, equipment, other) so the inventory page can filter and group by category.
- **Post job inventory survey**: when a cleaner closes out a job, they enter spray bottles used, mop heads used, and disposable items used. The numbers post directly to the inventory ledger.
- **Spray conversion**: spray usage is recorded at **1.25 ml per spray**, matching the value you provided.
- **Capped credits**: the credit applied for each item is capped per category so a single job cannot create an unrealistic credit.
- **Combined restock notification**: when stock crosses the per product threshold, a single combined "restock needed" email is sent to admin instead of one email per item.
- **Inventory UX improvements**: filter by category, search by name, paginated list, "back to inventory" link fixed to its own row.
- **Transaction reliability**: the inventory checkout transaction now uses `maxWait: 10s, timeout: 30s` so it does not fail under load.
- **Inventory Rules settings removed**: the Settings tab where someone typed in a "usage per job" number for each product is gone. Stock is deducted from what the cleaner actually reports at clock out, which is how you asked for it to work. Anywhere the old typed-in number was used (the supply forecast, the calendar's "missing equipment" warning, the required-equipment list on a job) now uses the real average from the last 30 days of completed jobs, so those figures keep themselves up to date. A side effect worth knowing: products nobody had written a rule for used to be invisible in the forecast entirely. They now appear.

### A decision we made deliberately

**There is no approval step before a cleaner's reported usage updates stock.** The brief said stock should be reviewed "where needed", and we read that as a review trail rather than a gate. Every deduction is recorded three ways: the products used on that job, an inventory change entry naming who and when, and an entry in the job log. You can see all of it on the job page and under Inventory to Activity, and correct anything that looks wrong.

We chose not to build a hard approval gate because it would hold a cleaner's clock out until an admin was available to approve it, usually late in the evening. If you would rather have the gate, it is a contained piece of work and we can add it.

### What is not done and needs clarification

1. **Auto seed product list**: should we pre seed the 12 products from your inventory document, or do you want to enter them manually from the admin panel?
2. **Refill threshold defaults**: each product needs a default "notify at" count. What are the defaults you want for each of the 12 products?
3. **Supplier integration**: do you want the restock notification to also raise a purchase order with a specific supplier, or only email admin?
4. **Cleaner specific kit allocation**: should each cleaner be issued their own kit count and replenished individually, or is inventory shared across the team?
5. **Damaged or lost item flow**: when a cleaner reports a damaged item, should it deduct from inventory and create an admin alert?

---

## Where to test

A short test plan for the 75 wired notifications was shared earlier. Each one can be triggered from the admin panel or by running the matching cron path locally with the `CRON_SECRET` bearer token.

If you can answer the 22 plus 5 plus 5 clarification points above, we can finish the remaining 45 notification rows, complete the Stripe payout side of Rag Wash, and seed your real inventory rules.
