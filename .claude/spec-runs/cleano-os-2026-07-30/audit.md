# Cleano OS — Spec Audit (Phase 2)
Run: 2026-07-30 · Spec: Cleano_OS_Additional_Software_and_CRM_Updates.pdf · 208 requirements audited by 7 parallel agents, every finding cited file:line.

**Bucket totals:** ✅ BUILT 30 · ⚠️ PARTIAL 55 · ❌ MISSING 110 · 🔍 VERIFY 2 · ⛔ CONFLICT 11
**By priority:** P0 (99 incl. global): ✅16 ⚠️30 ❌48 ⛔4 🔍1 · P1 (95): ✅11 ⚠️20 ❌58 ⛔5 🔍1 · P2 (14): ✅3 ⚠️5 ❌4 ⛔2

---

## P0 — Feature 1: Secure Saved Payment Method

| ID | Status | Evidence / Gap |
|---|---|---|
| CLN-P0-1-01 | ⚠️ PARTIAL | Client-side gate only: `src/app/(book)/book/page.tsx:220` requires `stripeCardReady`; server `submitBooking.ts:69-71` makes card/PI optional and `:364-368` stamps `depositPaid: true` from an unverified client-supplied PI id — direct server-action call books with no card |
| CLN-P0-1-02 | ✅ BUILT | Stripe SetupIntents `src/app/api/stripe/setup-intent/route.ts:41-45`; add-card token flow `add-card/[token]/actions/createSetupIntent.ts:34-38` + `AddCardForm.tsx:110`; deposit PI `setup_future_usage:"off_session"` `charge-deposit/route.ts:23-31` |
| CLN-P0-1-03 | ✅ BUILT | `ClientPaymentMethod` stores brand/last4/exp only (`prisma/schema.prisma:314-319`); repo-wide grep found no PAN/CVV storage; Stripe Elements only |
| CLN-P0-1-04 | ❌ MISSING | Customers have no card-removal surface; the only removal path is admin `removeClientPaymentMethod` (`clientPaymentMethods.ts:262-341`) which allows removing the last card with a warning only — no upcoming/unpaid-booking check |
| CLN-P0-1-05 | ⚠️ PARTIAL | Add-card flows validate via Stripe (`finalizeCardSetup.ts:30-32`), but the customer cannot self-initiate — link minted only by OWNER/ADMIN (`clientPaymentMethods.ts:54-56`); no add-first-then-remove sequencing |
| CLN-P0-1-06 | ✅ BUILT | Webhook `handleSetupIntentSucceeded` sets client + Stripe default (`webhook/route.ts:183-193`); token flow same (`finalizeCardSetup.ts:52-61`) |
| CLN-P0-1-07 | ⛔ CONFLICT | No per-booking card link exists (Job has no payment-method column); all charge paths read current `client.defaultPaymentMethodId` at charge time (`chargeJob.ts:145,155`, `cardHoldActions.ts:54-68`, `markNoShow.ts:45-51`, `requestCancellation.ts:71-77`) — after replacement ALL upcoming bookings charge the new default, opposite of spec |
| CLN-P0-1-08 | ❌ MISSING | `removeClientPaymentMethod` detaches immediately (`clientPaymentMethods.ts:281-293`); no settlement/connected-booking gate (searched for upcoming/unpaid/settled checks) |
| CLN-P0-1-09 | ⚠️ PARTIAL | Admin sees brand/last4/expiry/Default/Expired (`ClientPaymentMethods.tsx:209-235`, `isExpired` server-computed `clientPaymentMethods.ts:32-50`); no linked-to-upcoming-booking flag (not derivable — see 1-07) |
| CLN-P0-1-10 | ✅ BUILT | Only last4/brand/exp stored or rendered; full PAN/CVV never reach the server (`AddCardForm.tsx:110`; invariant comment `ClientPaymentMethods.tsx:343-345`) |
| CLN-P0-1-11 | ⚠️ PARTIAL | Customer emailed on DECLINE at charge time (`webhook/route.ts:102-111`, `email.ts:873-906`); nothing proactive — no cron checks expMonth/expYear vs upcoming bookings |
| CLN-P0-1-12 | ⚠️ PARTIAL | Admin emailed on decline (`webhook/route.ts:94-101`) and card added (`:197-202`); reactive only, no expiry-before-booking notification |
| CLN-P0-1-13 | ⚠️ PARTIAL | Deposit confirm in UI fails on bad card (`Step5Review.tsx:254-277`), but zero server enforcement — `submitBooking.ts` never verifies card/PI with Stripe (`:364-368`) |
| CLN-P0-1-14 | ⚠️ PARTIAL | Fragments: webhook ActivityLog rows (`webhook/route.ts:269-274`), charge logs (`chargeJob.ts:122-131`); admin add/remove/set-default write NO history; made-default/replaced never recorded per client |

## P0 — Feature 2: Masked Cleaner-to-Client Calling

| ID | Status | Evidence / Gap |
|---|---|---|
| CLN-P0-2-01 | ⚠️ PARTIAL | Phone affordance exists but is a plain `tel:` link exposing the REAL number — `cleaners/my-jobs/[jobId]/page.tsx:427-446`, gated by `provider.showCustomerPhone` default TRUE (`registry.ts:382-388`); no masked call button |
| CLN-P0-2-02 | ❌ MISSING | No in-software calling; searched twilio/TwiML/Dial/conference/voiceUrl/callSid/proxy — SMS only (`src/lib/sms.ts` raw REST, no twilio SDK in package.json) |
| CLN-P0-2-03 | ⚠️ PARTIAL | Customer app never renders cleaner phone; SMS bridge originates from Cleano number (`sms.ts:100-107`); but no call path exists so this holds for messaging only |
| CLN-P0-2-04 | ⚠️ PARTIAL | Single shared Cleano number (TWILIO_FROM_NUMBER/MESSAGING_SERVICE_SID, `sms.ts:44-50`) used for SMS bridge only; no temporary/per-job masked numbers, no calling |
| CLN-P0-2-05 | ❌ MISSING | Twilio Messages REST + inbound SMS webhook only; no Voice API/TwiML/Proxy code anywhere |
| CLN-P0-2-06 | ❌ MISSING | No call action exists to enforce (chat analog exists at `jobChatActions.ts:53-102`) |
| CLN-P0-2-07 | ❌ MISSING | No pre-booking calling-window logic; no call settings in `registry.ts` |
| CLN-P0-2-08 | ❌ MISSING | No calling-access expiry logic |
| CLN-P0-2-09 | ❌ MISSING | No admin setting for calling window |
| CLN-P0-2-10 | ❌ MISSING | No Call/CallLog model in prisma/schema.prisma |
| CLN-P0-2-11 | ❌ MISSING | No admin call log; ActivityLog records SMS attempts only (`sms.ts:64-79`); no duration/answered/missed/declined data |
| CLN-P0-2-12 | ⛔ CONFLICT | Spec: cleaners never access the real number. Codebase deliberately shows it — client phone + `tel:` link on cleaner job detail (`page.tsx:88,427-446`) behind `provider.showCustomerPhone` default TRUE ("Default true = current behavior", `registry.ts:379-388`) |
| CLN-P0-2-13 | ❌ MISSING | No calling of any kind |
| CLN-P0-2-14 | ❌ MISSING | No call→missed→chat handoff (job chat is on the same page at `page.tsx:518` but no flow) |

## P0 — Feature 3: Job-Specific Cleaner/Client Chat

| ID | Status | Evidence / Gap |
|---|---|---|
| CLN-P0-3-01 | ✅ BUILT | `JobChatMessage` keyed by required jobId (`schema.prisma:1259-1274`, @@index([jobId,createdAt])) — the job IS the thread |
| CLN-P0-3-02 | ✅ BUILT | `cleaners/my-jobs/[jobId]/page.tsx:516-522` renders JobChatThread; non-assigned cleaners redirected (`:78-86`) |
| CLN-P0-3-03 | ✅ BUILT | `(customer)/(secured)/bookings/[id]/page.tsx:258-263` renders same thread; ownership enforced (`clientId` check ~:90) |
| CLN-P0-3-04 | ✅ BUILT | Required jobId FK on every message; participants resolved per job (`jobChatActions.ts:53-102`) |
| CLN-P0-3-05 | ⚠️ PARTIAL | Text only — `body` field only (`schema:1264`); no photo/attachment upload in JobChatThread composer (`:246-281`); "On my way" is a separate SMS/status feature that does not post into chat |
| CLN-P0-3-06 | ❌ MISSING | No quick-message templates; searched all five spec phrases — only the standalone OnMyWayButton |
| CLN-P0-3-07 | ✅ BUILT | Sender name + role pill (Cleaner/Client/Admin) + per-message time + day dividers (`JobChatThread.tsx:212-236`, ROLE_LABEL :62-66) |
| CLN-P0-3-08 | ⚠️ PARTIAL | Read-state per role tracked (`schema:1265-1267`, `jobChatActions.ts:143-157`); thread polls 4s while open — but NO unread badges/notifications for job chat on any side (sidebar badges poll the separate admin↔employee chat); customer SMS notify key `cust.chat.new_message` is proposed + SMS default false (`catalog.ts:718`) |
| CLN-P0-3-09 | ✅ BUILT | `resolveParticipant` allows cleaner posts only on assigned jobs (`jobChatActions.ts:71-74,187-193`); threads exist only per job |
| CLN-P0-3-10 | ✅ BUILT | No status gating on admin chat panel (`JobDetailView.tsx:1219-1238`); no purge job touches chat. Caveat: cascade on permanent job delete (risk) |
| CLN-P0-3-11 | ✅ BUILT | Jobs/booking detail: `JobDetailView.tsx:1227-1233`; Calendar → popup → "Open job details" → chat panel (`CalendarJobActions.tsx:127-131,427-436`) — indirect (two clicks) |
| CLN-P0-3-12 | ✅ BUILT | Cleaner "Message client." (`page.tsx:516-522`), client "Message your cleaner" (`page.tsx:244-263`), admin "Job chat" card (`JobDetailView.tsx:1219-1238`) |
| CLN-P0-3-13 | ✅ BUILT | Admin roles can view+post any job thread (`jobChatActions.ts:32-39,96-99`); ADMIN senderRole + "Admin" pill (`:202-213`, `JobChatThread.tsx:62-66,228-232`) |
| CLN-P0-3-14 | ❌ MISSING | No per-booking/per-user chat disable; no chatDisabled/mute field on Job/Client/User; `sendJobChatMessage` has no such check |
| CLN-P0-3-15 | ✅ BUILT | No auto-purge anywhere (`job-sweep.ts` clean); deletion only via explicit admin permanent job delete cascade (flagged as risk) |
| CLN-P0-3-16 | ✅ BUILT | Only mutations: create + read-receipt updateMany (`jobChatActions.ts:150,202`); no edit/delete action, route, or UI exists — server actions are the only mutation surface |
| CLN-P0-3-17 | ❌ MISSING | No hide/moderation for job chat — no hidden/deletedAt column (`schema:1259-1274`), no admin action (soft-delete exists only for the separate GroupMessage) |
| CLN-P0-3-18 | ⚠️ PARTIAL | Real signature-verified inbound webhook appends client SMS as CLIENT message (`twilio/inbound/route.ts:55-127`). Gaps: thread picked by MOST chat messages not recency (`:94-98`) — can misfile replies; outbound leg gated on `cust.chat.new_message` (proposed, SMS default false) so bridge is inert until enabled |
| CLN-P0-3-19 | ⛔ CONFLICT | Chat itself masks numbers (`jobChatActions.ts:225-243`), but the surrounding job page shows the client's REAL phone to cleaners by default — same conflict as 2-12 |

## P0 — Feature 10: Unified CRM Inbox

| ID | Status | Evidence / Gap |
|---|---|---|
| CLN-P0-10-01 | ❌ MISSING | Sidebar "Messages" (`Sidebar.tsx:86-96`) = internal admin↔employee chat only (`admin/chat/page.tsx:20-30`); no customer-comms Inbox entry |
| CLN-P0-10-02 | ⚠️ PARTIAL | Inbound SMS real (`twilio/inbound/route.ts:55-127`) but lands in per-job chat; no inbound email ingestion anywhere (Resend outbound only); no branch model exists (0 hits in schema) |
| CLN-P0-10-03 | ❌ MISSING | Email logs on /admin/logs, job chat on job pages, notes on contact timeline — no combined view |
| CLN-P0-10-04 | ❌ MISSING | No customer conversation model: ChatConversation is per-employee internal; JobChatMessage per-job; EmailLog flat with no contact/conversation FK |
| CLN-P0-10-05 | ❌ MISSING | No thread-list UI; no branch/unread/status/assignment fields on any customer-comms model |
| CLN-P0-10-06 | ❌ MISSING | No free-form email/SMS composer; closest: job-chat SMS bridge + templated transactional emails |
| CLN-P0-10-07 | ⚠️ PARTIAL | SMS replies re-thread to job chat (`twilio/inbound:94-113`); email reply ingestion entirely absent |
| CLN-P0-10-08 | ❌ MISSING | Single global sender (TWILIO_FROM_NUMBER, one Resend from-address); no sender selection, no branch model |
| CLN-P0-10-09 | ⚠️ PARTIAL | Transactional flows work in-app; but no ad-hoc composer → non-templated communication still requires external tools |
| CLN-P0-10-10 | ❌ MISSING | No inbox → no filters (/admin/logs filters an audit log, not conversations) |
| CLN-P0-10-11 | ❌ MISSING | No message-content or booking-number search over comms |
| CLN-P0-10-12 | ❌ MISSING | No conversation assignment/status enum; Contact.ownerId is CRM owner, not conversation assignment |
| CLN-P0-10-13 | ⚠️ PARTIAL | ContactActivity NOTE visually distinct from EMAIL/SMS/CALL (`ContactDetailView.tsx:21-24,282-302`); but no inbox context — notes never appear alongside actual messages |
| CLN-P0-10-14 | ❌ MISSING | Email attachments only for invoice PDFs (`email.ts` ~1452); inbound MMS dropped (no NumMedia/MediaUrl handling); no image approval flow |
| CLN-P0-10-15 | ⚠️ PARTIAL | Failures recorded (EmailLog FAILED; `sms.ts:63-80`) + /admin/logs retry — but `retryEmail.ts:26-33` reconstructs only BOOKING_CONFIRMATION; no proactive alerts; no SMS resend |
| CLN-P0-10-16 | ⚠️ PARTIAL | EmailLog/ActivityLog/ChatMessage persist; but `JobChatMessage`→Job onDelete Cascade (`schema:1271`) and `ContactActivity`→Contact Cascade (`schema:2137`) — permanent job delete destroys chat history |
| CLN-P0-10-17 | ❌ MISSING | Coarse role gates only (Roles enum, requireAdmin); no inbox view/send/assign/close/archive permissions; no branch access |

## P0 — Feature 11: Communication Attached to Contact Profile

| ID | Status | Evidence / Gap |
|---|---|---|
| CLN-P0-11-01 | ⚠️ PARTIAL | "Communications" tab exists (`ContactDetailView.tsx:19,46,116,382-387`) but shows only manually-logged ContactActivity EMAIL/SMS/CALL rows, not actual messages |
| CLN-P0-11-02 | ⚠️ PARTIAL | Auto-attached: BOOKING/CANCEL/LIFECYCLE events (`crm.ts:189-282` from `submitBooking.ts:594`, `cancelRecurringService.ts:142`); real EmailLog/SMS/job chats/calls never attached to Contact |
| CLN-P0-11-03 | ⚠️ PARTIAL | Chronological timeline with type icon/title/preview/actor/date (`ContactDetailView.tsx:282-302`); no direction, recipient, delivery status, or related-booking link |
| CLN-P0-11-04 | ❌ MISSING | No thread views from profile; EmailLog/JobChatMessage have no contactId FK |
| CLN-P0-11-05 | ❌ MISSING | JobChatThread renders only on job/booking pages, never contact profile; no call records exist |
| CLN-P0-11-06 | ❌ MISSING | Profile composer only *logs* records (`logContactActivity`, `contactActions.ts:156`); nothing invokes sendEmail/sendSms |
| CLN-P0-11-07 | ❌ MISSING | Only "Log activity" + "Book a job" (a stub: `alert("Book a job — flow not wired yet")`, `ContactDetailView.tsx:94`) |
| CLN-P0-11-08 | ⚠️ PARTIAL | Contact designed to span lifecycle (unique leadId+clientId, `schema:2109-2115`; `syncContactFromClient` `crm.ts:134-159`); but nothing creates/links Contacts at lead capture or booking — conversion never touches Contact |
| CLN-P0-11-09 | ⚠️ PARTIAL | Client upserted by email (`submitBooking.ts:195-232`) so no duplicate Client; but the lead's Contact is never linked (clientId never set on conversion) — duplicate CRM contacts possible, caught only by heuristic detector |
| CLN-P0-11-10 | ❌ MISSING | Conversion only sets Lead.status=CONVERTED + convertedJobId (`submitBooking.ts:551-560`); no history merge |
| CLN-P0-11-11 | ⚠️ PARTIAL | Admin-gated merge exists (`contactActions.ts:192-260`, UI DuplicatesView) but does NOT re-parent — losers' activities/links/bookings stay on archived records |

## P0 — Feature 12: CRM Tasks Section

| ID | Status | Evidence / Gap |
|---|---|---|
| CLN-P0-12-01 | ❌ MISSING | No Tasks nav item (`Sidebar.tsx` ~:96) and no `src/app/admin/tasks/`; no task feature in src |
| CLN-P0-12-02 | ❌ MISSING | No Task/Todo/FollowUp/Reminder model in schema |
| CLN-P0-12-03 | ❌ MISSING | No task list/calendar (admin calendar is the jobs calendar) |
| CLN-P0-12-04 | ⛔ CONFLICT | Closest analog Alert (`schema:968-991`) has no due date/time, status workflow, conversation link, or creator — a dismissible notification (isRead/isDismissed), not a task record |
| CLN-P0-12-05 | ❌ MISSING | No matching status enum; ComplaintStatus exists but Complaint is dead code (never written) |
| CLN-P0-12-06 | ❌ MISSING | No Low/Normal/High/Urgent enum; AlertSeverity=INFO/WARNING/CRITICAL; ComplaintPriority=LOW/MEDIUM/HIGH/URGENT but model unused |
| CLN-P0-12-07 | ⚠️ PARTIAL | Fragments: `createAlert.ts:21` exists but zero UI callers; overdue highlight only for Contact.nextStep (`ContactsPageClient.tsx:568-570,622`); no assignment/reminders/filters/completion history |
| CLN-P0-12-08 | ❌ MISSING | No unanswered-message auto-task; cron covers unassigned bookings/clock-in/reminders only |
| CLN-P0-12-09 | ⚠️ PARTIAL | Poor reviews → CRITICAL alert (`submitRating.ts:162-193`) + weekly poor-rating email (`cron/notifications:472-510`); failed payment → email only (`chargeJob.ts:254-292`); complaints → AlertType exists, no creation path; all other triggers MISSING; all produce dismissible alerts/emails, not tasks |
| CLN-P0-12-10 | ❌ MISSING | No threshold config (15m/30m/1h/4h/1 business day) anywhere; cron windows hardcoded |
| CLN-P0-12-11 | ❌ MISSING | No auto-close-on-reply; alerts manually dismissed only |
| CLN-P0-12-12 | ❌ MISSING | No action-completion gating (no tasks) |
| CLN-P0-12-13 | ❌ MISSING | No reopen/re-task logic |
| CLN-P0-12-14 | ❌ MISSING | Dashboard tiles are ops counts (`dashboard/page.tsx:269-275`); sidebar badges = employee-chat unread + pending requests only |

## P0 — Feature 13: Unanswered Conversation Detection

| ID | Status | Evidence / Gap |
|---|---|---|
| CLN-P0-13-01 | ⚠️ PARTIAL | `lastSenderRole` computed only for internal employee↔admin chat (`admin/chat/actions.ts:219`; ChatSenderRole=EMPLOYEE\|ADMIN only); JobChatMessage has per-message readByAdminAt but no conversation-level awaiting computation |
| CLN-P0-13-02 | ❌ MISSING | No "Awaiting Reply" flag on any conversation model |
| CLN-P0-13-03 | ⚠️ PARTIAL | Admin employee-chat list shows relative time + unread badge (`AdminChatClient.tsx:269,296-297`) — internal chat only; job chat shows no waiting duration |
| CLN-P0-13-04 | ❌ MISSING | No branch model, no business-hours setting (only hardcoded booking window 09:00-19:00, `book/types.ts:136-137`); no response-target config |
| CLN-P0-13-05 | ❌ MISSING | No business-hours-aware timing anywhere |
| CLN-P0-13-06 | ❌ MISSING | No urgent-keyword list; chat send paths do no content inspection |
| CLN-P0-13-07 | ❌ MISSING | No keyword-triggered task/alert |
| CLN-P0-13-08 | ⚠️ PARTIAL | Escalation schema exists but dead: `AlertRoutingRule.escalateToRole/escalateAfterHours` (`schema:1013-1014`) + settings UI; `notifyByRule` (`createAlert.ts:137-232`) never called; no cron evaluates escalation; nothing measures wait time |
| CLN-P0-13-09 | ❌ MISSING | No response-time metrics (0 grep hits); analytics covers jobs/revenue/ratings/alerts only |

## P1 — Feature 4: Admin-Controlled FAQ System

| ID | Status | Evidence / Gap |
|---|---|---|
| CLN-P1-4-01 | ❌ MISSING | No FAQ page/route/link in customer portal (searched (customer) tree + PortalNav) — only public `(public)/faq/page.tsx` |
| CLN-P1-4-02 | ✅ BUILT | Standalone `/faq` (`page.tsx:11`) + iframe embed snippet in `WebsiteTab.tsx:175,202` |
| CLN-P1-4-03 | ✅ BUILT | `/faq` whitelisted public in `src/proxy.ts:18` |
| CLN-P1-4-04 | ✅ BUILT | Native `<details>/<summary>` accordion (`faq/page.tsx:52-80`); responsive 720px container + clamp() heading |
| CLN-P1-4-05 | ❌ MISSING | No search input; page is a zero-interactivity server component |
| CLN-P1-4-06 | ❌ MISSING | Flat `{question,answer}[]` shape, no category field (`registry.ts:156-170,472-489`); none of the 10 spec categories exist |
| CLN-P1-4-07 | ✅ BUILT | Settings → "Website & FAQ" tab (`SettingsClient.tsx:262`, `WebsiteTab.tsx:21-166`), OWNER/ADMIN-gated via requireAdmin (`updateAppSetting.ts:19-27`) |
| CLN-P1-4-08 | ⚠️ PARTIAL | Add/edit/delete exist (`WebsiteTab.tsx:31-39`); duplicate, reorder, draft, publish/unpublish do not — no status field, every save immediately live |
| CLN-P1-4-09 | ❌ MISSING | No category concept at all |
| CLN-P1-4-10 | ❌ MISSING | No visibility field; no customer-platform FAQ surface exists to target |
| CLN-P1-4-11 | ❌ MISSING | Single-language only (0 hits for french/locale/i18n in FAQ code) |
| CLN-P1-4-12 | ❌ MISSING | No preview — saves write straight to the live setting |
| CLN-P1-4-13 | ❌ MISSING | Zero design controls — all styling hardcoded inline (`faq/page.tsx:14-83`) |
| CLN-P1-4-14 | ❌ MISSING | Hardcoded "Cleano" text wordmark (`:23-32`); no logo selection; no CTA at bottom |
| CLN-P1-4-15 | ✅ BUILT | Embed-code generator for /faq (+/book,/gift-card,/reviews,/login) off configured custom domain (`WebsiteTab.tsx:170-208`) |
| CLN-P1-4-16 | ✅ BUILT | `force-dynamic` page reads setting per request (`faq/page.tsx:3-4,12`); cache busted on save (`settings/index.ts:142`) |
| CLN-P1-4-17 | ❌ MISSING | No FAQ analytics — no tracking, no FAQ model in schema, no analytics surface |
| CLN-P1-4-18 | ⛔ CONFLICT | UI claims "Changes are audit-logged" (`WebsiteTab.tsx:72`) but ActivityLog writes only when a def has `audit`/`sensitive` (`settings/index.ts:144-160`) and `content.faqs` has NO audit flag (`registry.ts:472-489`) — FAQ edits silently not logged |

## P1 — Feature 5: Side Menu — Seven Dropdown Sections

| ID | Status | Evidence / Gap |
|---|---|---|
| CLN-P1-5-01 | ⛔ CONFLICT | Nav already has exactly seven groups (`Sidebar.tsx:73-142`) but named Overview/Operations/Staff/Inventory & Supplies/Sales & Marketing/Finance/Admin — not the spec's seven; flat labeled groups, everything always rendered |
| CLN-P1-5-02 | ❌ MISSING | No dropdown behavior (static NAV array `:298-320`; NavLink.tsx is dead code) |
| CLN-P1-5-03 | ❌ MISSING | No expand/collapse/accordion; only state is mobileOpen/badges (`:166-172`) |
| CLN-P1-5-04 | ❌ MISSING | Zero localStorage/sessionStorage in Sidebar — no section memory |
| CLN-P1-5-05 | ⚠️ PARTIAL | Current-page highlight exists (`isActive :240-248`, also/exclude handling); section headers are non-interactive labels — no selected-section highlight concept |
| CLN-P1-5-06 | ❌ MISSING | No chevron icons on section headers (lucide imports contain no ChevronDown/Right) |
| CLN-P1-5-07 | ⛔ CONFLICT | `<md` = off-canvas hamburger (`:253-260,272-275`), md+ = fixed 240px; no icon-only rail exists — a different pattern than spec's "collapse into icons" |
| CLN-P1-5-08 | ✅ BUILT | Full current nav inventoried (`Sidebar.tsx:73-142`, 7 groups / 33 items); orphan pages NOT in nav: /admin/training, /admin/promo-codes, /admin/recurring, /admin/contacts/duplicates, /admin/inventory/kits |
| CLN-P1-5-09 | ⚠️ PARTIAL | Layout admits OWNER/ADMIN/OPS_MANAGER/FIELD_LEAD (`layout.tsx:25`, `role-routing.ts:14`); page-level gates redirect non-OWNER/ADMIN — but Sidebar renders full NAV to every role (`isAdmin` prop accepted `:56`, never used `:161-165`); no hide-section-when-inaccessible mechanism |
| CLN-P1-5-10 | ⛔ CONFLICT | Spec's Dashboard/Sales/Operations/Customers/Team/Finance/Settings vs actual names — only Operations and Finance match; contents differ substantially |
| CLN-P1-5-11 | ⛔ CONFLICT | Mapping: ~17 spec subsections exist as pages; ~11 exist only as Settings tabs (Suppliers, Checklists, Availability, Notifications, Services, Pricing, Locations, FAQ, Roles, Website Design, Integrations-ish); do NOT exist anywhere: Tasks, Hot Leads (as named), Follow-ups, Customer Accounts, Reviews admin page, Complaints, Field Leads, Groups, Payroll, Refunds, Deposits, Add-ons tab |

## P1 — Feature 6: Back Button on Booking Steps

| ID | Status | Evidence / Gap |
|---|---|---|
| CLN-P1-6-01 | ⚠️ PARTIAL | Wizard is exactly 5 steps (`book/page.tsx:23-29`); "← Back" renders on steps 2-5 (`step > 0` gate `:735`, button `:744`); step 1 has no Back at all |
| CLN-P1-6-02 | ✅ BUILT | `back()` decrements step index (`:235-238`); no state reset |
| CLN-P1-6-03 | ✅ BUILT | Single `draft` BookingDraft in parent (`:47-48`); controlled steps via `patch()` (`:193-195`) — everything survives back navigation |
| CLN-P1-6-04 | ⚠️ PARTIAL | Price re-quotes on field changes (`:152-191`), sidebar recomputes live (`:313-335`); availability re-fetches + slot re-validated (`Step3Schedule.tsx:60-125`); add-ons re-filter per service (`Step2Property.tsx:41-42`). Gap: no duration concept exists in the flow |
| CLN-P1-6-05 | ✅ BUILT | "Step {n} of 5" + 5-item progress list with done/active states (`:533-553`). Caveat: aside hidden <700px (`customer.css:467-471`) — phones see only "Step N" eyebrow |
| CLN-P1-6-06 | ❌ MISSING | Progress items are plain `<li>/<span>` with no onClick/href (`:537-553`) |
| CLN-P1-6-07 | ❌ MISSING | No back-to-landing on step 1; header link goes to /login or portal (`:636-650`) |
| CLN-P1-6-08 | ⚠️ PARTIAL | Responsive breakpoints coded (980/700/600px, `customer.css:442-487`); no automated cross-device tests exist (no spec files/playwright config in root) |
| CLN-P1-6-09 | ⚠️ PARTIAL | Double-click ref guard (`:69-72,241-242`) + server idempotency returning recent identical job (`submitBooking.ts:295-320`). Gaps: no popstate handling/draft persistence — browser Back exits wizard, discards answers; $20 deposit confirmed BEFORE submitBooking (`:246-264`) → charged-deposit-no-booking window |

## P1 — Feature 7: Customer Payment Methods

| ID | Status | Evidence / Gap |
|---|---|---|
| CLN-P1-7-01 | ❌ MISSING | Account page has no Payment Methods section (`account/page.tsx` + `AccountForm.tsx`: profile/referral/share/help only) |
| CLN-P1-7-02 | ❌ MISSING | No customer-side card display anywhere (admin DTO is admin-gated) |
| CLN-P1-7-03 | ⚠️ PARTIAL | Add/update only via admin-emailed one-time `/add-card/[token]` link (minted by OWNER/ADMIN, `clientPaymentMethods.ts:351-405`); new card auto-defaults; no self-serve add, no view, no choose-default, no replace flow |
| CLN-P1-7-04 | ❌ MISSING | No customer deletion exists; admin path has no upcoming/unpaid block (warning string only, `clientPaymentMethods.ts:329-331`) |
| CLN-P1-7-05 | ❌ MISSING | No deletion-blocked UI/message (no deletion flow to attach it to) |
| CLN-P1-7-06 | ❌ MISSING | No such UI — and the message would be false today (charges follow new default; see 1-07) |
| CLN-P1-7-07 | ❌ MISSING | No per-booking payment-method selection (Job has no pm field; no action/UI accepts one) |
| CLN-P1-7-08 | ⚠️ PARTIAL | ActivityLog infra records charges/refunds/webhooks; card add/remove/set-default actions write no entries |
| CLN-P1-7-09 | ⚠️ PARTIAL | Admin notified on failure + card added; no expiry notification; none tied to upcoming-job timing |

## P1 — Feature 8: Global Font Standardization

| ID | Status | Evidence / Gap |
|---|---|---|
| CLN-P1-8-01 | ❌ MISSING | Fraunces serif-italic accents pervasive (`globals.css:1600,2819,3120,3696,4059,4362,5134,5340`; `customer.css:108`) + ~10 italic empty-state styles + scattered Tailwind `italic` in cleaner pages; no cleanup done |
| CLN-P1-8-02 | ❌ MISSING | Dashboard title = `.display` Montserrat 700 (`dashboard/page.tsx:248-250`, `globals.css:1101-1106`); body forced to TT Norms Pro via `!font-tt-norms-pro` (`layout.tsx:72`); customer/cleaner = Manrope; other admin titles use Fraunces `.admin-page-title` (`globals.css:696-701`) |
| CLN-P1-8-03 | ❌ MISSING | Fonts diverge per surface; `.admin-font` Montserrat opt-in applied to only ~10 pages; Manrope double-loaded (next/font + CDN) with next/font variable never attached to `<html>` |
| CLN-P1-8-04 | ❌ MISSING | Italics used for placeholders/empty states/decorative accents; none removed |
| CLN-P1-8-05 | ⚠️ PARTIAL | Body atoms regular-weight; but two competing main-title styles coexist (`.display` Montserrat 700 vs `.admin-page-title` Fraunces 400) |
| CLN-P1-8-06 | ⚠️ PARTIAL | Partial atom set exists (`.eyebrow/.display/.subtitle/.title-sm/.section-title/.label`, banners, `.atable`; DESIGN-SYSTEM.md) — three parallel systems, no single documented scale |
| CLN-P1-8-07 | ⚠️ PARTIAL | Red flags: global `.text-xs` line-height override 0.7rem; `.text-xxs` 8.96px and `.text-xxxs` 6.72px in use — sub-9px type below mobile-readable sizes (`globals.css` ~318-340) |
| CLN-P1-8-08 | 🔍 VERIFY | Regression-only requirement — is a visual QA pass across tables/dropdowns/buttons the acceptance gate for the font change? |
| CLN-P1-8-09 | ⚠️ PARTIAL | @theme tokens exist (`globals.css:279-311`) but three competing application mechanisms + 30+ mostly-unused @font-face weights + dead @theme entries; new pages inherit TT Norms Pro unless `.admin-font` is remembered |

## P1 — Feature 14: Email Marketing Campaigns

| ID | Status | Evidence / Gap |
|---|---|---|
| CLN-P1-14-01 | ⚠️ PARTIAL | Sales section has "Campaigns" manager (`sales/CampaignManager.tsx`) but it is an ad-spend/budget tracker — no email marketing subsection anywhere |
| CLN-P1-14-02 | ❌ MISSING | Create/edit exists only for ad-spend campaigns; no design/schedule/send/review — no send action, scheduler, or recipient model |
| CLN-P1-14-03 | ⚠️ PARTIAL | CampaignStatus = DRAFT/ACTIVE/PAUSED/COMPLETED (`schema:1640`); spec's Scheduled/Sent/Cancelled don't exist |
| CLN-P1-14-04 | ❌ MISSING | MarketingCampaign has name/status/dates/budget only — no subject, preview text, sender, reply-to, audience, branch |
| CLN-P1-14-05 | ❌ MISSING | No test-send/duplication/cancel-before-send (campaigns never send) |
| CLN-P1-14-06 | ❌ MISSING | Admin role gate only; no campaign permission tiers or approval flow |
| CLN-P1-14-07 | ❌ MISSING | EmailLog stores kind/recipient/subject/status but NOT body/HTML and has no campaignId — exact sent email not viewable |

## P1 — Feature 15: Drag-and-Drop Email Builder

| ID | Status | Evidence / Gap |
|---|---|---|
| CLN-P1-15-01 | ❌ MISSING | No designer; no unlayer/grapesjs/react-email/mjml in package.json; all email HTML is template-literal strings in `src/lib/email.ts` |
| CLN-P1-15-02 | ❌ MISSING | No content-block system; `layout()/h1()/p()/section()` helpers are code-only; no unsubscribe-link block exists at all |
| CLN-P1-15-03 | ❌ MISSING | No style controls — inline constants in email.ts |
| CLN-P1-15-04 | ⚠️ PARTIAL | Hardcoded emails use a consistent Cleano-branded layout (#00424a/#f5f2ed) — fixed code, not a designer default |
| CLN-P1-15-05 | ❌ MISSING | No template library; only hardcoded send functions (confirmation, reminder, receipt, save-offer, rating request, digests) |
| CLN-P1-15-06 | ❌ MISSING | No merge-field/personalization token system |
| CLN-P1-15-07 | ❌ MISSING | No desktop/mobile preview UI |
| CLN-P1-15-08 | ❌ MISSING | No pre-send validation (no send flow) |
| CLN-P1-15-09 | ⚠️ PARTIAL | One instance: save-offer click redirect appends promo param (`track/recurring/[id]/click/route.ts:24`); Contact.campaign attribution field exists but nothing populates it from email links; no generalized UTM builder |

## P1 — Feature 16: Campaign Analytics

| ID | Status | Evidence / Gap |
|---|---|---|
| CLN-P1-16-01 | ❌ MISSING | No campaign metrics; EmailStatus = PENDING/SENT/FAILED only (no BOUNCED/OPENED); single-email open/click only on RecurringCancellation |
| CLN-P1-16-02 | ❌ MISSING | No per-link click tracking (save-offer email has one tracked button) |
| CLN-P1-16-03 | ❌ MISSING | No opened/clicked/bounced/unsubscribed lists; no Resend webhook handler exists |
| CLN-P1-16-04 | ❌ MISSING | No follow-up audience creation |
| CLN-P1-16-05 | ❌ MISSING | No non-opener/clicker follow-ups (save-offer funnel tracks but never follows up) |
| CLN-P1-16-06 | ❌ MISSING | No performance-over-time/comparison views (RetentionTab covers the save-offer funnel only) |
| CLN-P1-16-07 | ❌ MISSING | No analytics filters (branch model absent entirely) |
| CLN-P1-16-08 | ❌ MISSING | No campaign export (ExportButton is jobs-only) |

## P1 — Feature 17: Contact Segmentation / Marketing Lists

| ID | Status | Evidence / Gap |
|---|---|---|
| CLN-P1-17-01 | ❌ MISSING | No marketing-list model; no static or dynamic list feature |
| CLN-P1-17-02 | ⚠️ PARTIAL | Contacts CRM has lifecycle/source/owner/search filters (`ContactsPageClient.tsx:35-92`) and Contact carries lifetimeValue/bookingsCount/tags/ratingAvg — but no city/postal/service-type/frequency/last-booking/campaign-activity/inactivity filters, nothing saveable |
| CLN-P1-17-03 | ⚠️ PARTIAL | Existing 3 filters + search combine (`:90-92`); no arbitrary AND/OR condition builder |
| CLN-P1-17-04 | ❌ MISSING | No recipient-count estimation |
| CLN-P1-17-05 | ❌ MISSING | No unsubscribe/invalid/bounce data exists to exclude; LifecycleStage.DNC is manual and unenforced |
| CLN-P1-17-06 | ❌ MISSING | No manual include/exclude (no lists) |
| CLN-P1-17-07 | ❌ MISSING | No saved lists or list↔campaign history |

## P1 — Feature 18: Consent & Unsubscribe Management

| ID | Status | Evidence / Gap |
|---|---|---|
| CLN-P1-18-01 | ❌ MISSING | Contact has NO consent/subscription fields; only analogs: LifecycleStage.DNC + `customer.smsOptInDefault` setting |
| CLN-P1-18-02 | ❌ MISSING | No consent date/source or unsubscribe date/reason anywhere |
| CLN-P1-18-03 | ❌ MISSING | grep "unsubscribe" across src + schema = 0 hits; no route, no List-Unsubscribe header; the save-offer email is arguably marketing and ships with no unsubscribe — CASL/CAN-SPAM exposure today |
| CLN-P1-18-04 | ❌ MISSING | No send-time suppression (no unsubscribe state exists) |
| CLN-P1-18-05 | ✅ BUILT | Transactional email/SMS fully operational (`src/lib/email.ts` Resend ~2700 lines; per-type admin toggles `catalog.ts` + isNotificationEnabled; per-job disable honored `cron/reminders:41`) |
| CLN-P1-18-06 | ❌ MISSING | No consent history view |
| CLN-P1-18-07 | ❌ MISSING | No re-subscribe permission/documentation flow |
| CLN-P1-18-08 | ❌ MISSING | No suppression lists; EmailStatus has no BOUNCED/COMPLAINED; no bounce webhook |

## P2 — Feature 9: Move Hot Leads to Sales

| ID | Status | Evidence / Gap |
|---|---|---|
| CLN-P2-9-01 | ⛔ CONFLICT | Nothing is labeled "Hot Leads". De-facto candidate: /admin/leads ("Leads", Flame icon, booking drop-offs) under Operations (`Sidebar.tsx:93`); a separate "Sales Leads" (/admin/sales, door-to-door map) already sits under Sales & Marketing (`:119`). Ambiguous — needs a decision |
| CLN-P2-9-02 | ⛔ CONFLICT | Lead model (`schema:2048-2078`) has NO notes, assigned-user, or follow-up-date fields — spec assumes data that doesn't exist (a nav move touches no data anyway) |
| CLN-P2-9-03 | ✅ BUILT | Exactly one leads page (`admin/leads/page.tsx` + LeadsPageClient) |
| CLN-P2-9-04 | ❌ MISSING | Move not done. Reference inventory: `Sidebar.tsx:93` (only UI link); revalidatePath in bulkSetLeadStatus/convertLeadToJob/updateLeadStatus + `lib/bulk/actions.ts:15`; no dashboard widgets/notifications/crons reference the route |
| CLN-P2-9-05 | ✅ BUILT | Permission enforced at page (`leads/page.tsx:16-17` redirects non-OWNER/ADMIN) — a nav move cannot change access |
| CLN-P2-9-06 | ✅ BUILT | No automations attached to leads (crons contain no Lead queries); only downstream consumer /admin/reports reads data not the route |

## P2 — Feature 19: CRM Follow-Up Automations

| ID | Status | Evidence / Gap |
|---|---|---|
| CLN-P2-19-01 | ❌ MISSING | No automation builder; existing automations are hardcoded crons/hooks; closest configurable: Notifications toggles + Retention save-offer config |
| CLN-P2-19-02 | ⚠️ PARTIAL | Hardcoded coverage: booking completed→rating request (`rating.ts` from clockOut/markJobComplete), recurring cancel→winback with tracking (`cancelRecurringService.ts:125`), upcoming cleaning→24h/48h reminders (crons), poor review→admin alert; NOT covered: new lead, quote sent/unanswered, inactive, campaign opened/clicked, failed-payment follow-up |
| CLN-P2-19-03 | ⚠️ PARTIAL | Hardcoded actions only: send email (Resend), send SMS (`sms.ts`), notify admin (`admin-alerts.ts`); no create-task/assign/update-status/add-to-list, none composable |
| CLN-P2-19-04 | ❌ MISSING | No configurable delays; timing fixed per cron schedule (vercel.json) or immediate inline |
| CLN-P2-19-05 | ⚠️ PARTIAL | One hardcoded stop: save-offer redemption stops funnel; EmailLog.notificationKey idempotency; no generic stop-when-responds/books |
| CLN-P2-19-06 | ⚠️ PARTIAL | ContactActivity timeline + EmailLog queryable per recipient; no automation-enrollment history view |
| CLN-P2-19-07 | ⚠️ PARTIAL | Per-notification channel toggles + save-offer toggle; no pause/edit/duplicate of automations as entities |
| CLN-P2-19-08 | ❌ MISSING | No automation reporting; only retention KPI + raw EmailLog counts |

## Global

| ID | Status | Evidence / Gap |
|---|---|---|
| CLN-GLOBAL-01 | 🔍 VERIFY | Process constraint on the build pass (add-only; permissions/records/automations/booking data intact) — not auditable against current code; carried as an acceptance criterion into every work package. ~~One decision needed: apply the pending `rating-exclusion` migration first?~~ **Resolved 2026-07-30:** `npx prisma migrate status` → 57 migrations, "Database schema is up to date". `20260728000000_rating_exclusion` and `20260728010000_align_schema_drift` are both applied. No pending-migration blocker. |

---

# Work log

## 2026-07-30 — WP-1: P0 payment hardening (no migration)

Scoped from a threat model of the public booking flow. Verified: `npx tsc --noEmit` clean, `npm run build` exit 0.

### Requirements moved

| ID | Was | Now | What changed |
|---|---|---|---|
| CLN-P0-1-01 | ⚠️ | ✅ | A verified deposit is now mandatory server-side in `submitBooking`, not just gated in the browser |
| CLN-P0-1-13 | ⚠️ | ✅ | An expired/invalid/absent card can no longer confirm a booking — the deposit intent must verify against Stripe |
| CLN-P0-1-14 | ⚠️ | ⚠️ | Added: card added / made default / removed / link sent. Still missing: which bookings a card was connected to (blocked on CLN-P0-1-07) |
| CLN-P1-7-08 | ⚠️ | ✅ | All admin payment-method changes now write `ActivityLog` |

### Defects found and fixed (none were in the spec)

1. **Free bookings.** `submitBooking` is public and unauthenticated and every deposit field was optional — omitting them created real `SCHEDULED` jobs, plus a full recurring series on a recurring frequency, for free. The verified deposit now stands in for authentication in the guest flow.
2. **Unverified deposit intent.** `depositPaid: true` and `depositPaymentIntentId` were stamped from a client-supplied string with no Stripe contact. That id is the **refund target** (`issueRefund.ts:52-55`), so a forged id let a refund be issued against a stranger's charge, and a gift-card intent could be laundered into a "paid" booking. Now verified on 12 properties: existence under our key, `succeeded`, `amount_received`, currency, deposit metadata, email binding, livemode, not-refunded, age, customer match, prior use.
3. **Client record poisoning.** `stripeCustomerId` / `stripePaymentMethodId` were written straight from the request body onto any client matched by email — enough to repoint a victim's default card and silently break every future off-session charge. Both removed from the input type; values now read off the verified PaymentIntent.
4. **Add-card link hijack.** `finalizeCardSetup` proved the SetupIntent succeeded but never that it was *this* client's, while the browser supplies the id. Now requires `setupIntent.customer === client.stripeCustomerId`, plus a metadata binding stamped at mint time. Backward-compatible: `getOrCreateStripeCustomer` always persists the id before finalize runs.
5. **Promo trust + cap race.** Discount figure re-derived server-side from the catalog; `usesCount` burned via a single conditional `UPDATE` so `maxUses` holds atomically. `applyPromoCode` no longer honours soft-deleted codes.
6. **Idempotency.** The deposit intent is now the idempotency key — a retry presenting the same intent returns the job it already paid for instead of erroring or double-booking. The `deduplicated` flag was dropped from the public response (it told an unauthenticated caller whether a given email had just booked).

### Files touched

`src/app/(book)/actions/submitBooking.ts` · `src/app/(book)/actions/applyPromoCode.ts` · `src/app/(book)/book/page.tsx` · `src/app/api/stripe/charge-deposit/route.ts` · `src/app/(public)/add-card/[token]/actions/{createSetupIntent,finalizeCardSetup}.ts` · `src/app/admin/actions/clientPaymentMethods.ts` · `src/lib/stripe.ts`

### Deploy note

`charge-deposit` now stamps `kind: "booking_deposit"` and `email` on the intent, and `submitBooking` verifies them. Intents created before this ships carry neither, so both checks are written to tolerate their absence (`type: "deposit"` is still accepted; email is enforced only when present). No staged deploy required, and the tolerance closes on its own once old intents age past the 24h window.

### Outstanding

- ~~**Anti-replay index (needs migration).**~~ **DONE** — shipped in `20260730120000_booking_payment_binding` (see WP-4 below) and applied to production 2026-07-30 with a clean pre-flight. Note: the `.env` database **is** production (confirmed by Prem); its small row count is the result of an old hard-delete bug, not a separate environment.
- **Promo codes are end-to-end non-functional — awaiting a decision.** `book/page.tsx` never passes `promoCode` to `submitBooking` at all. The customer is shown a discounted total (`Step5Review.tsx:158`) and charged full price: `chargeJob.ts:37` bills `price - discountAmount` and never reads `promoDiscountAmount`. Win-back redemption tracking therefore can never fire, permanently skewing the retention KPI. Wiring the code through *without* also fixing the charge would burn promo quota for discounts never given, so both must land together.
- **Orphan-charge window.** The deposit is confirmed client-side before `submitBooking` runs, and the Stripe webhook ignores deposit intents (no `metadata.jobId`), so a failure in between leaves a charged customer with no booking and no reconciliation record.
- **No rate limiting anywhere.** `/api/stripe/charge-deposit` is unauthenticated and unmetered; lead and quote submission likewise. Separate ticket.

## 2026-07-30 — WP-2: customer payment methods, removal guards, expiry alerts (no migration)

Verified: `npx tsc --noEmit` clean, `npm run build` exit 0.

### Requirements moved

| ID | Was | Now | Evidence |
|---|---|---|---|
| CLN-P1-7-01 | ❌ | ✅ | Payment methods subsection on `/account` (`(secured)/account/PaymentMethods.tsx`, mounted from `page.tsx`) |
| CLN-P1-7-02 | ❌ | ✅ | Brand / last4 / expiry / default only — `CustomerPaymentMethod` carries nothing else |
| CLN-P1-7-03 | ⚠️ | ✅ | Self-serve add (`createMySetupIntent` + `finalizeMyCardSetup`), choose default, replace — no admin link needed |
| CLN-P0-1-05 | ⚠️ | ✅ | Customer can now add a valid card themselves before removing the old one |
| CLN-P0-1-04 | ❌ | ✅ | `getCardRemovalBlock` blocks removing the only card while bookings need one — enforced server-side in BOTH surfaces |
| CLN-P1-7-04 | ❌ | ✅ | Same guard on the customer action |
| CLN-P1-7-05 | ❌ | ✅ | The block returns the explanation ("add another card first") and the UI surfaces it verbatim |
| CLN-P0-1-11 | ⚠️ | ✅ | `cust.card.expiring` — customer warned before the booking, not after a decline |
| CLN-P0-1-12 | ⚠️ | ✅ | `admin.card.expiring` |
| CLN-P1-7-09 | ⚠️ | ⚠️ | Expiry + failure covered; "replaced" notification still not sent to admin |

### Notes

- **Admin last-card removal was unguarded.** `removeClientPaymentMethod` previously detached the card and *then* returned a warning string — the client was already left unable to be auto-charged. It now refuses up front and logs `card.remove_blocked`.
- The guard lives in `src/lib/payment-methods.ts` and is applied by both the admin and customer actions. A rule enforced in only one surface is not enforced.
- **No seeding needed for the two new notification keys.** `isNotificationEnabled` falls back to `CATALOG_DEFAULTS`, built from each catalog entry's `channels` (`src/lib/notifications/index.ts:83-111`), and both new entries set `EMAIL: true` — so they are live on deploy with no data migration.
- Expiry sweep runs in the existing notifications cron, keyed per `(key, jobId, recipient)` via `ensureNotSent`, one warning per client (earliest upcoming booking only), wrapped so it cannot take down the rest of the cron.

### WP-2 — still blocked on the per-booking card link (needs migration)

CLN-P0-1-07, CLN-P0-1-08, CLN-P0-1-09 ("linked to an upcoming booking" flag), CLN-P1-7-06, CLN-P1-7-07. All five need `Job.stripePaymentMethodId` + backfill, and they change which card five live charge paths read.

## 2026-07-30 — WP-3: correctness fixes, nav permissions, chat + booking gaps (no migration)

Verified: `npx tsc --noEmit` clean, `npm run build` exit 0.

### Requirements moved

| ID | Was | Now | Evidence |
|---|---|---|---|
| CLN-P1-4-18 | ⛔ | ✅ | `audit: true` on the `content.faqs` def — the editor's "Changes are audit-logged" promise is now true |
| CLN-P0-3-06 | ❌ | ✅ | `CLEANER_QUICK_MESSAGES` in `JobChatThread.tsx`, wired into the cleaner job page; all five spec messages verbatim, one tap to send |
| CLN-P0-3-18 | ⚠️ | ✅ | Inbound SMS now threads by newest message, not message count |
| CLN-P1-5-09 | ⚠️ | ⚠️ | Nav now filtered by real role and empty sections hidden. Still partial: this is presentation only, and the seven-section restructure (5-01…5-11) is untouched |
| CLN-P1-6-06 | ❌ | ✅ | Completed progress steps are clickable (backwards only) |
| CLN-P1-6-07 | ❌ | ✅ | Back on step 1 returns to the referring page when there is one |
| CLN-P1-6-01 | ⚠️ | ✅ | A Back control now exists on all five steps |

### Defects fixed

1. **Inbound SMS misfiling (real, ongoing).** `api/twilio/inbound` ordered candidate threads by `chatMessages: { _count: "desc" }` while its own comment said "most recent chat activity". A client's chattiest old booking captured *every* later reply permanently — so an answer to "I'm on my way" could land on a months-old job. Now ordered by the newest message, bounded to a 30-day window so a dormant thread doesn't swallow a genuinely new conversation.
2. **FAQ audit logging silently absent.** ⛔ conflict from the audit, closed.
3. **Admin nav ignored role entirely.** `Sidebar` took an `isAdmin` prop that was passed as a bare attribute — i.e. hardcoded `true` — and never read it anyway. Every admin-area role (incl. OPS_MANAGER, FIELD_LEAD) saw links to Finances, Payouts, Invoices, Settings, Clients, Contacts and more, all of which redirect them. Nav is now built from `user.role`, with the 16 OWNER/ADMIN-gated destinations verified one-by-one against each `page.tsx` guard. The misleading prop was removed so it can't later be mistaken for a permission signal.
4. **`handleSend` regression caught before it shipped.** Adding an optional override argument to the chat send handler meant `onClick={handleSend}` would have passed the click event as the message body; changed to `onClick={() => handleSend()}`.

### Worth a decision — pages with NO role gate

While mapping nav permissions, these admin pages were found to have no OWNER/ADMIN guard at all, so OPS_MANAGER and FIELD_LEAD can open them directly today: `bulk-charge`, `logs`, `promo-codes`, `gift-cards`, `quotes`, `documents`, `jobs`, `web-bookings`, `requests`, `time-tracking`, `job-applications`, `training-docs`, `wash-payouts`, `inventory/kits`, `inventory/rag-wash`, `recurring`, `calendar`, `dashboard`, `kpi`, `jobs/new`.

Some are certainly intentional (calendar, jobs, dashboard). Others — **bulk-charge** (charges customer cards) and **logs** (full audit trail) — look like they should be restricted. Nav links to them are unchanged, because tightening actual access is a product decision, not a nav fix.

## 2026-07-30 — WP-4: booking ↔ payment binding (MIGRATION `20260730120000_booking_payment_binding`)

Verified: `npx tsc --noEmit` clean, `npm run build` exit 0, migration applied and schema verified against the DB.

### Requirements moved

| ID | Was | Now | Evidence |
|---|---|---|---|
| CLN-P0-1-07 | ⛔ | ✅ | `Job.stripePaymentMethodId` pinned at confirmation in `submitBooking`; all 5 charge paths resolve through `resolveChargePaymentMethod()` |
| CLN-P0-1-08 | ❌ | ✅ | `getCardRemovalBlock` refuses a card with upcoming bookings pinned to it, even when other cards exist |
| CLN-P0-1-09 | ⚠️ | ✅ | `upcomingBookings` on the admin DTO + pill on the client card list |
| CLN-P1-7-06 | ❌ | ✅ | Customer account page states which bookings stay on each card |

### Design decisions

- **Nullable, no backfill.** NULL = "not pinned" and every charge path falls back to the client's current default — bit-for-bit the old behaviour. Backfilling would have *guessed* a card for historical jobs; leaving NULL means zero behaviour change on existing rows and correct behaviour going forward. This also removes the "partial rollout silently changes which card is charged" risk the threat model flagged.
- **Fallback when the pinned card is gone.** If the pinned card is no longer on file, resolve to the client default rather than failing the charge — pinning must not become a way to break billing.
- **Unique index doubles as the idempotency primitive.** `submitBooking` catches `P2002` on `depositPaymentIntentId` and returns the job that won the race, so a concurrent replay yields one booking, not two or an error.
- Recurring child jobs carry no deposit PI, so the UNIQUE constraint is safe for the recurring path.

### Still open in this area

`CLN-P1-7-07` (customer picks a card for a specific booking) — the column exists now, so it's UI + a server action, no migration.
