# Bookmops: launch status and full feature list

Status as of October 1, 2026. Target: public launch on **October 10, 2026**.

This document has two parts:

1. **What is left before October 10**, checked phase by phase against the launch plan (`docs/product/Road_to_October_10.pdf`).
2. **Everything the product does today**, grouped by who uses it.

Every item was checked against the code on `main` (commit `9026ec6`), not against older status notes. "Unverified" means the code is in place but nobody has proven it against the live service yet.

---

## Part 1. What is left before October 10

### The short version

- **Most of the code is written.** Very little of it has been proven live. The assistant, email, subscriptions and payments all wait on keys or settings outside the code (see "Needs setup outside the code" below).
- **Four code gaps should be fixed before launch:**
  - A self-serve signup sends no welcome email.
  - An expired trial is shown as "payment failed".
  - The Meta pixel has no paid-conversion event.
  - A known security issue: a customer account can be claimed by email address alone.
- **The full funnel test (Oct 1-4) and final QA (Oct 5-8) have not started.**
- **The customer mobile app is not built.** It is a placeholder screen, and it is not part of the October 10 web launch.

### Phase by phase

| Dates | Phase | Status | What is still missing |
|---|---|---|---|
| Sept 2-5 | Email joins the conversation | Code done, never run live | Set up Resend inbound and the AI key. Run one real email end to end. Each business must forward its mailbox to its inbound address, because replies go to the business's own Reply-To. |
| Sept 5-8 | The assistant books | Mostly done | The assistant offers **open days, not time slots**. It checks closed dates and lead time only, not crew capacity. Booking links use the standard service list, not each workspace's own services. Unverified live (needs the AI key). |
| Sept 8-10 | Automatic follow-ups and live test | Code done, live test not done | The follow-up sequence (for example day 3, 10 and 30) runs daily. The full live test (SMS and email, first contact to booking to follow-up) has never run. HubSpot-style **tasks are not built**. Only "assign a conversation to a person" exists. |
| Sept 11-15 | Cleaner experience polish | Mostly done, late | Web portal and Bookmops Pro screens are complete. Not yet tested on a real phone by the client, and no client approval is on record. |
| Sept 16-21 | Customer experience polish | Partly done | **Customers cannot reschedule or cancel a single visit themselves.** Both are requests an admin must approve. That is by design today, but the plan says "rescheduling and cancellation", so it needs a decision. Cancelling a whole recurring service does work. No dedicated desktop and mobile pass is on record. |
| Sept 22-25 | Pricing locked | Done (Sept 30) | Starter $49/mo (5 cleaners), Professional $149/mo (20 cleaners), Organization by quote. USD. Yearly plans pay for 10 months. The launch offer charges 9 months on yearly plans until Jan 1, 2027. 30-day trial, no card. Needs a written client sign-off. |
| Sept 22-28 | Subscriptions | Code done, never run live | Checkout, plan changes, billing portal, webhooks and the payment-failed email all exist. Still needed: live platform Stripe keys, the webhook secret, a real test subscription, and Stripe retry settings. A trial converts only if the owner adds a card. There is **no lockout**, by decision: owners see a banner and a daily pop-up. |
| Sept 26-30 | Public website | Mostly done | Single landing page with features, pricing, FAQ and signup, plus /privacy and /support. Product images are built mock-ups, not real screenshots. Gaps: no paid-conversion pixel event, no sitemap or robots file, and the support and privacy contact emails are placeholders. The pixel does nothing until its ID is set. |
| Oct 1-4 | Whole funnel test | Not started | Ad, website, pricing, signup, onboarding, payment, emails, texts and internal alerts, tested as a new customer would. |
| Oct 5-8 | Final QA and ops checklist | Not started | Retest admin, cleaner and customer portals, the assistant and subscriptions. Confirm the 7 cron jobs, email authentication (SPF, DKIM, DMARC) and Twilio credit. |
| Oct 9-10 | Soft launch and go live | Not started | Depends on everything above. |

### Code gaps to fix before launch

1. **Signup sends no email.** `get-started/actions.ts` creates the workspace and stops. The owner gets no welcome email and Bookmops gets no "new signup" alert.
2. **Expired trials say "payment failed".** The daily job marks an expired trial as past due. The banner then reads "Your last payment didn't go through", to someone who never added a card.
3. **No paid-conversion tracking.** The pixel fires `StartTrial` and `CompleteRegistration` at signup. Nothing fires when someone actually pays, and there is no server-side Conversions API.
4. **Customer account takeover risk.** `linkClientAccount` links a new login to an existing customer by email alone, without checking the email first. Someone could register with a known customer's email and see their bookings.
5. **Billing emails can be switched off.** The trial-ending and payment-failed emails go through each workspace's own notification switches, so an owner can mute them.
6. **No sitemap or robots file** for the public site.
7. **Placeholder support details** on /privacy and /support (`_site/contact.ts`): the contact emails and the "two business days" response promise.

### Needs setup outside the code

| Service | What to do |
|---|---|
| Anthropic | Add `ANTHROPIC_API_KEY` in Vercel. The assistant cannot reply without it. |
| Resend | Verify the inbound domain and the sending domain. Set `RESEND_INBOUND_SECRET`, `INBOUND_EMAIL_DOMAIN` and `EMAIL_FROM`. |
| DNS | Add SPF, DKIM and DMARC records. DMARC was lost in the August nameserver move. |
| Twilio | Point the inbound URL at `/api/twilio/inbound` (it pointed at Octopods on Sept 10). Top up the balance (last seen $14.57). Buy numbers for the masking pool if masking will be used. |
| Stripe (Bookmops' own account) | Live keys, the subscription webhook and `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET`, retry settings, and one real test subscription. |
| Meta | Set `NEXT_PUBLIC_META_PIXEL_ID`. |
| Vercel | Root Directory is `apps/web`. All 7 crons enabled (two run every 5 and 15 minutes, which needs a paid plan). `CRON_SECRET` and `SECRETS_KEY` are set. |
| Apple and Google (Bookmops Pro) | TestFlight, App Review submission, review demo account, store listing and screenshots, APNs and FCM keys through EAS. There is no iOS submit config in `eas.json` yet. |

### Decisions needed from the client

- Written sign-off on pricing and the launch offer.
- Website copy and screenshots.
- The support and privacy mailboxes, and the response-time promise.
- Approval of the cleaner and customer interfaces.
- Whether customers get true self-serve reschedule and cancel, or keep "request, admin approves".
- Scope of the HubSpot connector. It is planned for after October 10.

### Other open items, lower priority

- Phone-number masking has never run against Twilio. It is off by default.
- From the Awer list: `chargeJob` charges before tax, and `assignKit` hard-blocks on low stock.
- The tenant-isolation layer review is still unchecked in the cutover log.
- Production data cleanup is still outstanding: stale open sessions, jobs stuck "in progress", duplicate empty workspaces.
- The announcements action treats a missing role as "employee". This is low severity.
- Quotes cannot be sent to a customer with a price yet. The price stays in an internal note.
- Two Contacts buttons are placeholders: "Save view" and "Book a job".
- Plan features are not enforced, except the cleaner cap per plan. Every other feature on the pricing page is open to every plan.

---

## Part 2. Full feature list

"Live" means built and wired end to end. Partial and placeholder items are labelled.

### 1. Admin web portal (owners, admins, managers)

The menu is built per role. Owners and admins see everything. Ops managers and field leads see a reduced set. Red counters show what needs attention.

**Overview**
- **Dashboard:** home page with a setup checklist and a guided tour.
- **Notifications:** events admins should know about, such as time-log change requests and clocks nobody stopped.
- **Analytics:** 10 tabs (overview, KPIs, graphs, budget, targets, inventory, employees, payments, alerts, marketing). Owner and admin only.
- **KPIs:** customer retention (retained, cancelled, paused, reactivated) by month, quarter or year.
- **Calendar:** company calendar, plus a view per cleaner.

**Operations**
- **Contacts:** one CRM list with lifecycle stages, bulk edits, and a duplicate finder and merge. "Save view" and "Book a job" are placeholders.
- **Jobs:**
  - list, detail, create and edit
  - recurring series, crew assignment, checklists, photos and notes
  - charge, refund, card holds and no-show fees
  - CSV export, archive and delete
- **Issues:** problems cleaners report from the field.
- **Requests:** customer cancel and reschedule requests waiting for an admin decision.
- **Wait lists:** customers waiting for a date.
- **Documents:** documents to sign, and a void-cheque upload.
- **Clients:** profiles, addresses, saved cards, "send add-card link", login invites, and CSV and BookingKoala imports.
- **Web bookings:** bookings made through the online booking page.
- **Messages:** direct and group chat with staff.

**Staff**
- **Employees:**
  - roster, pay rates and tiers
  - ratings, strikes and documents
  - passwords and bulk actions
  - the cleaner cap per plan is enforced here
- **Availability:** every cleaner's availability in one view.
- **My Team:** a field lead's own group.
- **Time tracking:** clock-in and clock-out records and edits.
- **Job applications:** applicant inbox. Invite applicants to the applicant portal, then hire.
- **Training and docs:** modules, quizzes and progress tracking.
- **Announcements:** with read tracking and reactions.

**Inventory and supplies**
- **Inventory:**
  - products, cleaner inventory and "needs attention"
  - activity, requests and supplier comparison
  - forecast and kits
- **Wash payouts:** rag and pad wash credits per job.

**Sales and marketing**
- **Leads:** hot leads, including abandoned bookings. Convert a lead to a job.
- **Sales leads:** sales map, landing pages with visit counts, campaigns and commissions.
- **AI conversations:** the inbox of texts and emails the assistant handled or handed to a person. Admins can start an outbound text.
- **Lead source and CPA:** the funnel per channel. Ad spend is entered by hand.
- **Quotes:** request inbox and a form builder. Partial: a priced quote cannot be sent to the customer yet.
- **Gift cards and promo codes.**

**Finance**
- **Payouts:** weekly pay periods and cleaner withdrawal requests.
- **Finances:** bookkeeping, income statement, tax calculator, P&L and budget dashboard.
- **Invoices:** create, send, track and download as PDF.
- **Bulk charge:** charge many cards at once, with a preview.

**Admin**
- **Property engine:** custom fields. Partial: only contacts use them so far.
- **Logs:** every email, charge and admin action, with email retry.
- **Settings**, in 8 groups:
  - **You:** profile, availability.
  - **Operations:** closed dates, job types, booking page, checklists, service areas.
  - **Money:** tax, pricing rules, payment types, multipliers, budgets, the workspace's own Stripe key.
  - **Inventory:** kits, suppliers, locations.
  - **Team:** training, documents, roles.
  - **Configuration:** general, customer, provider, scheduling, website and FAQ, retention, notifications, AI assistant, connectors (Twilio, number pool, BookingKoala).
  - **Bookmops account:** plan and billing.

### 2. Cleaner web portal

- **Dashboard:** today's view, with a prompt to install the portal as a phone app.
- **My jobs:** job detail, clock in and out with breaks, checklist, photos, inventory report.
- **Available jobs:** claim open jobs, with a calendar view.
- **Calendar and availability:** own schedule, weekly hours and days off.
- **My pay:** earnings, pay periods, withdrawals.
- **My inventory:** check supplies out and back, and rag wash.
- **Training, quizzes, documents and e-signing.**
- **Messages, group chat and announcements.**
- **My standing (strikes) and settings.**
- **Switched-off accounts** see an "account deactivated" screen.

### 3. Customer web

- **Online booking page:**
  - service-area check, open days and closed days
  - add-ons, photo upload and promo codes
  - card deposit
  - abandoned-booking capture
  - the `?service=` link pre-selects a service
- **Customer portal:**
  - upcoming bookings
  - booking detail with activity, rating, and reschedule or cancel requests
  - cancel a recurring service, with a save offer
  - account: addresses, saved cards, referral code
  - help (FAQ)
  - login and password flows
- **Public pages:**
  - FAQ, real reviews, rate a job from a link
  - buy and redeem gift cards
  - join the waitlist, request a quote, add a card from a link
  - sales landing pages
  - careers form, and an invite-only applicant portal

### 4. Bookmops' own site and console

- **Marketing site at `/`:** features, how it works, pricing cards, FAQ, signup. Also /privacy and /support.
- **Signup:** self-serve for Starter and Professional. Creates the workspace and starts a 30-day trial with no card. Larger companies send a request instead.
- **Plan and billing:**
  - Stripe Checkout, plan changes with proration, the billing portal
  - trial-ending email 7 days out, payment-failed email
  - owner banner and daily pop-up; no lockout
- **Internal console for Bookmops staff:**
  - money overview and a daily to-do queue
  - workspaces, trials and billing
  - requests from large companies
  - staff access and an audit log
  - a live database-isolation health check
  - "Sign in as this customer" is a placeholder

### 5. AI receptionist and messaging

- **Reply engine:** answers from each workspace's real services, prices, policies, FAQs and business facts, using Claude. **Off by default** for each workspace.
- **Hand-off:** when unsure, it stays silent and hands the conversation to a person, with an email to admins. It goes quiet once staff reply.
- **Channels:**
  - Incoming SMS through Twilio. A known client's text goes to that job's chat; everything else goes to the assistant.
  - Incoming email through Resend. Partial: it needs inbound setup.
- **Lead capture:** every new inquiry becomes a lead.
- **Follow-ups:** a configurable sequence (for example day 3, 10 and 30) by SMS or email, run daily.
- **Team inbox:**
  - three panes, with Open and Closed views and assignment to a person
  - a "new message" button to start a conversation
- **Phone-number masking:** cleaner and customer can call and text without seeing each other's number. Off by default; needs a number pool.
- **Job chat:** between cleaner and client, with an SMS bridge.

### 6. Payments

- **Each workspace's own Stripe account:** its key is stored encrypted. This is not Stripe Connect.
- **Card handling:** saved cards, deposits, charges, refunds, card holds, no-show fees, tips and bulk charge.
- **Documents:** receipts, monthly statement PDFs, invoices with PDF, and cleaner invoices.
- **Credits:** gift cards, promo codes and referral credits.

### 7. Automations (cron jobs)

| Job | When | What it does |
|---|---|---|
| reminders | Daily | Day-before reminders by email and SMS, AI lead follow-ups, returns expired masking numbers to the pool. |
| notifications | Every 5 minutes | Marks past jobs complete, flags clocks nobody stopped, and sends time-window alerts to admins, customers and cleaners. |
| job-reminders | Every 15 minutes | Push to the crew about an hour before each job. |
| subscriptions | Daily | Trial-ending email, marks expired trials past due. |
| weekly | Mondays | Creates pay periods, sends each cleaner a performance email, sends admins the rag-wash summary. |
| monthly | 1st of the month | Monthly statement PDF to each active client. |
| api-retention | Daily | Clears old records from the phone API. |

### 8. Notifications

- **Email:** 86 kinds, covering the booking lifecycle, payments, ratings, payouts, gift cards, quotes, statements, applicants, billing and AI hand-off.
- **Notification catalog:** 80 types, each switchable per recipient and per channel (email, SMS, push).
- **SMS through Twilio:** confirmation, on the way, reminder, cancellation, chat relay, AI replies.
- **Push to Bookmops Pro:** jobs, reminders, chat, announcements, decisions and urgent issues.

### 9. Bookmops Pro mobile app (iOS and Android)

Every screen uses the real `/api/v1`. Sample data appears only in development builds.

- **Cleaners and field leads:**
  - Today, Jobs, Available, Pay and More
  - job detail, clock in and out (works offline), checklist, photos, issues, "on my way"
  - claim jobs, pay and withdrawals
  - kit, availability, calendar, office chat, training, documents, strikes
- **Managers, admins and owners:**
  - Home, Schedule, Approvals (time, withdrawals, kit), Messages
  - alerts, office inbox, issues, job detail and crew changes, team today
  - admins use these screens with full permissions
- **Shared:** sign-in, password change, account deletion, announcements, team chat with report and block.
- **Store status:** the App Store listing exists, an iOS build has reached Apple processing, and the review demo workspace script exists. TestFlight and submission status are unverified.

### 10. Customer mobile app

Placeholder. One welcome screen; designs exist. Not part of the October 10 launch.

### 11. Multi-tenancy and security

- **Company per subdomain:** each company has its own subdomain, and sign-in routes each person to their role's area.
- **Data isolation:** row-level security in Postgres, forced on and failing closed, plus a database client locked to one company.
- **Roles:** owner, admin, ops manager, field lead, employee, client, applicant. Checked on the server.
- **Sessions:** switching someone off or changing a password ends their sessions immediately.
- **Protection:** public forms and the phone API are rate-limited. Stripe and Twilio secrets are encrypted at rest. Twilio and Resend webhooks are signature-checked.

### 12. Marketing and tracking

- **Meta pixel:** on Bookmops' own site only, never on company subdomains. Fires PageView, CompleteRegistration and StartTrial.
- **Search engines:** page titles and descriptions on public pages. No sitemap or robots file yet.
- **Not installed:** no other analytics (no Google Analytics or PostHog).

---

## Related documents

- Launch plan: `docs/product/Road_to_October_10.pdf`
- Redesign (October 2026): `docs/design/redesign-2026-10/README.md` and the live canvas https://claude.ai/artifact/WQMH5Wh2XYXggya4utY5gs
- Monorepo and mobile API: `docs/architecture/MONOREPO.md`, `docs/architecture/API_V1.md`
