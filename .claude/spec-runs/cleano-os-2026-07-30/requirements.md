# Cleano OS — Additional Software & CRM Updates — Requirements Extraction
Source: `Cleano_OS_Additional_Software_and_CRM_Updates.pdf` (8 pages, 19 features: 9 "Software Updates" + 10 "CRM Development Changes")
Extracted: 2026-07-30. ID scheme: `CLN-<P0|P1|P2>-<feature#>-<bullet#>`.
**Total: 208 atomic requirements** (207 feature bullets after splits + 1 global implementation note).

Type ∈ functional, data, ui, permission, integration, security, compliance, negative-constraint, migration.

---

## Feature 1 — Secure Saved Payment Method for Upcoming Bookings (P0)
Area: Customer Side / Booking / Payments / Admin Side

| ID | Priority | Requirement | Type |
|---|---|---|---|
| CLN-P0-1-01 | P0 | Require every customer to have a valid payment method saved when completing a booking | functional |
| CLN-P0-1-02 | P0 | Save payment methods securely through the payment processor (tokenized) | integration |
| CLN-P0-1-03 | P0 | Never store full card numbers, CVV codes, or other sensitive card data inside Cleano OS | negative-constraint |
| CLN-P0-1-04 | P0 | After a booking is confirmed, prevent the customer from removing their only payment method while they have an upcoming or unpaid booking | negative-constraint |
| CLN-P0-1-05 | P0 | Allow the customer to replace a payment method by first adding a new valid card | functional |
| CLN-P0-1-06 | P0 | When a replacement card is added, make it the default for future bookings | functional |
| CLN-P0-1-07 | P0 | Keep the previous card securely linked to already-confirmed upcoming bookings where required for payment protection | data |
| CLN-P0-1-08 | P0 | Allow the previous card to be removed only after connected bookings are completed or cancelled and all charges, adjustments, cancellation fees, or balances are settled | functional |
| CLN-P0-1-09 | P0 | Allow admin to see card brand, last four digits, expiry date, default status, and whether the card is linked to an upcoming booking | ui |
| CLN-P0-1-10 | P0 | Never show admin the full card number or CVV | negative-constraint |
| CLN-P0-1-11 | P0 | Notify the customer if a saved card expires or becomes invalid before an upcoming booking | functional |
| CLN-P0-1-12 | P0 | Notify admin if a saved card expires or becomes invalid before an upcoming booking | functional |
| CLN-P0-1-13 | P0 | Prevent confirmation of a new booking with an expired or invalid card | negative-constraint |
| CLN-P0-1-14 | P0 | Keep a payment-method history showing when a card was added, made default, replaced, and which bookings were connected to it | data |

## Feature 2 — Masked Cleaner-to-Client Calling (P0)
Area: Cleaner Side / Client Side / Admin Side / Job Details / Phone Integration

| ID | Priority | Requirement | Type |
|---|---|---|---|
| CLN-P0-2-01 | P0 | Add a Call Client button inside each assigned job on the cleaner side | ui |
| CLN-P0-2-02 | P0 | Allow cleaners to call clients directly through the software without seeing the client's real phone number | functional |
| CLN-P0-2-03 | P0 | Prevent clients from seeing the cleaner's personal phone number | negative-constraint |
| CLN-P0-2-04 | P0 | Display and use a temporary or masked Cleano phone number | functional |
| CLN-P0-2-05 | P0 | Connect calls through Twilio or an equivalent phone provider | integration |
| CLN-P0-2-06 | P0 | Only allow the cleaner assigned to a job to call that client | permission |
| CLN-P0-2-07 | P0 | Make calling available within a configurable period before the scheduled booking | functional |
| CLN-P0-2-08 | P0 | Automatically expire calling access after completion or a defined period | functional |
| CLN-P0-2-09 | P0 | Allow admin to configure the calling-access window | functional |
| CLN-P0-2-10 | P0 | Attach every call to the specific booking | data |
| CLN-P0-2-11 | P0 | Show admin a call log with cleaner name, client name, booking number, date, time, duration, and status such as answered, missed, failed, or declined | ui |
| CLN-P0-2-12 | P0 | Prevent cleaners from copying, revealing, or accessing the client's actual phone number | negative-constraint |
| CLN-P0-2-13 | P0 | Support mobile and desktop where technically available | ui |
| CLN-P0-2-14 | P0 | If the client does not answer, allow the cleaner to open the job-specific chat immediately | functional |

## Feature 3 — Expand Job-Specific Cleaner and Client Chat (P0)
Area: Cleaner Side / Client Side / Admin Side / Jobs / Calendar

| ID | Priority | Requirement | Type |
|---|---|---|---|
| CLN-P0-3-01 | P0 | Give every booking its own private chat thread | data |
| CLN-P0-3-02 | P0 | Allow the cleaner to access chat from the assigned job | ui |
| CLN-P0-3-03 | P0 | Allow the client to access the same chat from booking details | ui |
| CLN-P0-3-04 | P0 | Keep all messages connected to the specific booking | data |
| CLN-P0-3-05 | P0 | Allow text, photos, arrival updates, access updates, and job-related questions | functional |
| CLN-P0-3-06 | P0 | Provide quick messages: "I am on my way"; "I have arrived"; "I am having trouble accessing the property"; "I am running approximately 15 minutes late"; "Could you confirm the parking instructions?" | functional |
| CLN-P0-3-07 | P0 | Display message timestamps and the sender's name or role | ui |
| CLN-P0-3-08 | P0 | Show unread-message notifications on cleaner, customer, and admin sides | functional |
| CLN-P0-3-09 | P0 | Prevent cleaners from starting unrelated conversations outside assigned bookings | negative-constraint |
| CLN-P0-3-10 | P0 | Keep chat visible after completion for admin records | data |
| CLN-P0-3-11 | P0 | Allow admin to access the full chat from Jobs, booking details, and Calendar | ui |
| CLN-P0-3-12 | P0 | Add a visible Chat button or tab inside each booking | ui |
| CLN-P0-3-13 | P0 | Allow admin to read and join any cleaner-client conversation, with admin messages clearly labelled | functional |
| CLN-P0-3-14 | P0 | Allow admin to disable messaging for a specific booking or user | permission |
| CLN-P0-3-15 | P0 | Keep a permanent history for complaints, disputes, access issues, quality reviews, and payment disputes | data |
| CLN-P0-3-16 | P0 | Do not allow cleaners or clients to edit or permanently delete sent messages | negative-constraint |
| CLN-P0-3-17 | P0 | Allow admin to hide inappropriate messages from the interface while preserving the original in audit history | functional |
| CLN-P0-3-18 | P0 | If SMS delivery is enabled, allow client replies by text to return to the same booking conversation | integration |
| CLN-P0-3-19 | P0 | Continue showing only masked contact information to the cleaner | negative-constraint |

## Feature 4 — Admin-Controlled FAQ System (P1)
Area: Customer Side / Public Website / Admin Settings / Content Management

| ID | Priority | Requirement | Type |
|---|---|---|---|
| CLN-P1-4-01 | P1 | Create an FAQ page inside the customer side of Cleano OS | ui |
| CLN-P1-4-02 | P1 | Create a public FAQ version that can be embedded or implemented independently on Cleano websites | functional |
| CLN-P1-4-03 | P1 | Allow potential clients to browse without creating an account or booking | functional |
| CLN-P1-4-04 | P1 | Make the public FAQ mobile responsive with expandable accordion-style questions | ui |
| CLN-P1-4-05 | P1 | Add a keyword search bar | functional |
| CLN-P1-4-06 | P1 | Organize questions into categories: Booking, Pricing, Payments, Cleaning Services, Add-ons, Rescheduling and Cancellations, Cleaner Arrival and Access, Supplies and Equipment, Recurring Services, Customer Accounts | data |
| CLN-P1-4-07 | P1 | Add FAQ management under admin settings | ui |
| CLN-P1-4-08 | P1 | Allow admin to add, edit, delete, duplicate, reorder, draft, publish, and unpublish questions and answers | functional |
| CLN-P1-4-09 | P1 | Allow admin to create, reorder, and manage categories | functional |
| CLN-P1-4-10 | P1 | Allow each item to be shown on the public website only, customer platform only, or both | functional |
| CLN-P1-4-11 | P1 | Add separate English and French fields where required | data |
| CLN-P1-4-12 | P1 | Allow preview before publishing | functional |
| CLN-P1-4-13 | P1 | Add a design editor controlling page title, intro text, fonts, heading sizes, text sizes, colours, border style, corner radius, spacing, category layout, and open/close icons | ui |
| CLN-P1-4-14 | P1 | Allow logo selection and a contact or booking call-to-action at the bottom | ui |
| CLN-P1-4-15 | P1 | Provide embed code, widget, API connection, or standalone page URL | integration |
| CLN-P1-4-16 | P1 | Automatically update the website FAQ when admin publishes changes | functional |
| CLN-P1-4-17 | P1 | Add analytics for most-viewed questions, popular searches, searches with no results, and questions opened most often | functional |
| CLN-P1-4-18 | P1 | Preserve edits in an admin activity log | data |

## Feature 5 — Convert the Side Menu Into Seven Dropdown Sections (P1)
Area: Admin Side / Navigation / User Interface

| ID | Priority | Requirement | Type |
|---|---|---|---|
| CLN-P1-5-01 | P1 | Redesign the admin side menu so only seven main sections are visible by default | ui |
| CLN-P1-5-02 | P1 | Make every main section a dropdown, with all existing pages organized as subsections | ui |
| CLN-P1-5-03 | P1 | Allow sections to expand and collapse and optionally collapse the previously open section | ui |
| CLN-P1-5-04 | P1 | Remember the most recently opened section during the active session | functional |
| CLN-P1-5-05 | P1 | Highlight the selected main section, subsection, and current page | ui |
| CLN-P1-5-06 | P1 | Display a dropdown arrow or similar icon beside each main section | ui |
| CLN-P1-5-07 | P1 | Allow the side menu to collapse into icons on smaller screens | ui |
| CLN-P1-5-08 | P1 | Preserve all current pages and functionality | migration |
| CLN-P1-5-09 | P1 | Continue enforcing role-based permissions and hide an entire main section when a user has no access to any subsection | permission |
| CLN-P1-5-10 | P1 | Use these seven main sections: Dashboard, Sales, Operations, Customers, Team, Finance, Settings | ui |
| CLN-P1-5-11 | P1 | Suggested subsections — Dashboard: Overview; Reports; Notifications; Tasks · Sales: Leads; Hot Leads; Quotes; Follow-ups; Sales Pipeline · Operations: Calendar; Jobs; Bookings; Inventory; Suppliers; Checklists · Customers: Customer List; Customer Accounts; Reviews; Complaints; Customer Communication · Team: Cleaners; Field Leads; Availability; Groups; Applications; Training · Finance: Payments; Payroll; Cleaner Payouts; Refunds; Deposits; Invoices · Settings: Services; Pricing; Add-ons; Locations; Notifications; FAQ Management; Integrations; User Roles and Permissions; Website Design Settings | ui |

## Feature 6 — Back Button on Every Booking Step (P1)
Area: Public Website / Customer Side / Booking Flow

| ID | Priority | Requirement | Type |
|---|---|---|---|
| CLN-P1-6-01 | P1 | Add a visible Back button on each of the five booking steps | ui |
| CLN-P1-6-02 | P1 | Allow customers to return to the previous step without restarting | functional |
| CLN-P1-6-03 | P1 | Preserve service selection, property information, add-ons, date and time, contact information, frequency, discounts, and pricing calculations | functional |
| CLN-P1-6-04 | P1 | When an earlier answer changes, automatically recalculate affected price, duration, availability, or service requirements | functional |
| CLN-P1-6-05 | P1 | Show the current step, such as Step 2 of 5 | ui |
| CLN-P1-6-06 | P1 | Allow completed steps in the progress bar to be clicked when doing so does not create booking errors | ui |
| CLN-P1-6-07 | P1 | On the first step, allow Back to return to the main service or booking landing page | ui |
| CLN-P1-6-08 | P1 | Test on mobile, desktop, and tablet | ui |
| CLN-P1-6-09 | P1 | Ensure browser-back behaviour does not duplicate bookings, lose data, or create payment errors | functional |

## Feature 7 — Payment Methods Under the Customer Account (P1)
Area: Customer Side / Account / Payments

| ID | Priority | Requirement | Type |
|---|---|---|---|
| CLN-P1-7-01 | P1 | Add a Payment Methods subsection under Account | ui |
| CLN-P1-7-02 | P1 | Display card brand, last four digits, expiry date, and default status only | ui |
| CLN-P1-7-03 | P1 | Allow customers to add a new card, update an expired card, choose a default card, and replace the current card | functional |
| CLN-P1-7-04 | P1 | Do not allow deletion of the only valid card while there is an upcoming or unpaid booking | negative-constraint |
| CLN-P1-7-05 | P1 | When deletion is blocked, explain that the card is connected to an upcoming booking and that a new payment method must be added first | ui |
| CLN-P1-7-06 | P1 | When a replacement card is added, explain which upcoming bookings remain connected to the old card and which use the new default card | ui |
| CLN-P1-7-07 | P1 | Allow a customer to select a payment method for a specific booking where permitted | functional |
| CLN-P1-7-08 | P1 | Record all changes in admin activity history | data |
| CLN-P1-7-09 | P1 | Notify admin when a card fails, expires, or is replaced before an upcoming job | functional |

## Feature 8 — Standardize the Font Across the Entire Software (P1)
Area: Admin Side / Cleaner Side / Customer Side / Public Booking Pages / UI Design

| ID | Priority | Requirement | Type |
|---|---|---|---|
| CLN-P1-8-01 | P1 | Remove the generic italicized AI-style font from every part of the software | ui |
| CLN-P1-8-02 | P1 | Use the same font currently used for the main Dashboard title as the global software font | ui |
| CLN-P1-8-03 | P1 | Apply it consistently to admin, cleaner, customer, booking, login, account, dashboards, side menus, dropdowns, page titles, buttons, forms, tables, calendars, jobs, profiles, reports, settings, notifications, chats, inboxes, FAQ pages, payment pages, and mobile navigation | ui |
| CLN-P1-8-04 | P1 | Remove unnecessary italic styling; reserve italics only for intentional emphasis | ui |
| CLN-P1-8-05 | P1 | Use regular font weight for body text and the Dashboard title style for main page titles | ui |
| CLN-P1-8-06 | P1 | Create a typography system for main page title, section heading, subsection heading, body text, labels, input text, button text, table headings, table content, helper text, error messages, success messages, and navigation text | ui |
| CLN-P1-8-07 | P1 | Keep sizes and weights consistent across all pages and readable on mobile | ui |
| CLN-P1-8-08 | P1 | Ensure the font change does not break page layout, button sizing, table widths, dropdown alignment, or responsiveness | ui |
| CLN-P1-8-09 | P1 | Apply the change globally through the design system so new pages inherit it automatically | ui |

## Feature 9 — Move Hot Leads From Operations to Sales (P2)
Area: Admin Side / Side Menu / Sales Pipeline

| ID | Priority | Requirement | Type |
|---|---|---|---|
| CLN-P2-9-01 | P2 | Remove Hot Leads from Operations and add it under the Sales dropdown | ui |
| CLN-P2-9-02 | P2 | Preserve all existing leads, notes, assigned users, follow-up dates, lead sources, statuses, and activity history | migration |
| CLN-P2-9-03 | P2 | Do not create a duplicate Hot Leads page | negative-constraint |
| CLN-P2-9-04 | P2 | Update internal links, dashboard widgets, notifications, and shortcuts to open the new Sales location | functional |
| CLN-P2-9-05 | P2 | Preserve existing user permissions | permission |
| CLN-P2-9-06 | P2 | Confirm reports and automations connected to Hot Leads continue working | migration |

---

# CRM Development Changes

## Feature 10 — Unified CRM Inbox (P0)
Area: Admin Side / CRM / Inbox / Customer Profiles / Company Communications

| ID | Priority | Requirement | Type |
|---|---|---|---|
| CLN-P0-10-01 | P0 | Add an Inbox section to the admin side menu | ui |
| CLN-P0-10-02 | P0 | Connect the Inbox to company email addresses, SMS numbers, and branch phone numbers | integration |
| CLN-P0-10-03 | P0 | Allow staff to view incoming and outgoing email, SMS, job-specific chat, and internal notes where applicable | functional |
| CLN-P0-10-04 | P0 | Group messages into conversation threads by customer, lead, or contact | functional |
| CLN-P0-10-05 | P0 | Show contact name, phone number, email, branch, assigned user, last message, last activity time, unread count, and conversation status | ui |
| CLN-P0-10-06 | P0 | Allow users to send email and SMS directly from the Inbox | functional |
| CLN-P0-10-07 | P0 | Route customer replies back to the same conversation | functional |
| CLN-P0-10-08 | P0 | Send messages from the correct company number or email and allow authorized users to select the sender for their branch | functional |
| CLN-P0-10-09 | P0 | Remove the need to use Gmail, Outlook, Twilio, or another system for normal customer communication | functional |
| CLN-P0-10-10 | P0 | Add filters for all messages, unread, email, SMS, job chats, assigned to me, unassigned, open, closed, branch, location, and date | ui |
| CLN-P0-10-11 | P0 | Add search by customer name, phone, email, message content, or booking number | functional |
| CLN-P0-10-12 | P0 | Allow assignment to an employee and statuses: Open, Pending, Waiting for Customer, Resolved, Closed | functional |
| CLN-P0-10-13 | P0 | Allow private internal notes clearly distinguished from customer-facing messages | functional |
| CLN-P0-10-14 | P0 | Allow attachments in email and approved images through SMS where supported | functional |
| CLN-P0-10-15 | P0 | Show failed-delivery alerts and allow resending | functional |
| CLN-P0-10-16 | P0 | Store communication history permanently unless an authorized admin deletes or archives it | data |
| CLN-P0-10-17 | P0 | Add permissions for viewing inboxes, sending messages, assigning conversations, closing conversations, archiving, and branch access | permission |

## Feature 11 — Attach All Communication to the Contact Profile (P0)
Area: CRM / Contact Profile / Customer Profile / Lead Profile / Communication History

| ID | Priority | Requirement | Type |
|---|---|---|---|
| CLN-P0-11-01 | P0 | Add a Communication History section to every contact profile | ui |
| CLN-P0-11-02 | P0 | Attach all emails, SMS messages, calls, chats, and internal notes to the correct contact | data |
| CLN-P0-11-03 | P0 | Display communication chronologically with type, direction, sender, recipient, date, time, preview, delivery status, and related booking | ui |
| CLN-P0-11-04 | P0 | Allow full email and SMS threads to be opened directly from the contact profile | ui |
| CLN-P0-11-05 | P0 | Include job-specific cleaner-client chats and masked call records | data |
| CLN-P0-11-06 | P0 | Allow admin to send a new email or text directly from the contact profile | functional |
| CLN-P0-11-07 | P0 | Add quick actions for Send Email, Send Text, Call, Create Task, Add Note, Create Booking, and Create Quote | ui |
| CLN-P0-11-08 | P0 | Keep communication history when a lead converts into a customer | data |
| CLN-P0-11-09 | P0 | Do not create duplicate contacts when an existing lead books | negative-constraint |
| CLN-P0-11-10 | P0 | Merge lead history into the customer profile on conversion | functional |
| CLN-P0-11-11 | P0 | Allow authorized admins to merge duplicate contacts while preserving messages, notes, bookings, and tasks | functional |

## Feature 12 — CRM Tasks Section (P0)
Area: Admin Side / CRM / Tasks / Contacts / Inbox

| ID | Priority | Requirement | Type |
|---|---|---|---|
| CLN-P0-12-01 | P0 | Add a dedicated Tasks section to the admin side menu | ui |
| CLN-P0-12-02 | P0 | Connect tasks to a contact, lead, customer, booking, quote, conversation, or complaint | data |
| CLN-P0-12-03 | P0 | Provide list and calendar views | ui |
| CLN-P0-12-04 | P0 | Include task title, description, contact, assigned employee, due date, due time, priority, status, related booking or conversation, creation date, and creator | data |
| CLN-P0-12-05 | P0 | Use statuses: Not Started, In Progress, Waiting for Customer, Completed, Cancelled | data |
| CLN-P0-12-06 | P0 | Use priorities: Low, Normal, High, Urgent | data |
| CLN-P0-12-07 | P0 | Allow manual task creation, individual or team assignment, reminders, overdue highlighting, filters, sorting, completion notes, and completion history | functional |
| CLN-P0-12-08 | P0 | Automatically create a task when a customer message remains unanswered beyond a configurable period | functional |
| CLN-P0-12-09 | P0 | Automatically create or flag tasks for customer questions, missed lead follow-ups, unanswered quotes, incomplete booking requests, failed payment methods, complaints, poor reviews, cleaner access issues, callback requests, and scheduled follow-up dates | functional |
| CLN-P0-12-10 | P0 | Allow unanswered-message thresholds such as 15 minutes, 30 minutes, one hour, four hours, or one business day | data |
| CLN-P0-12-11 | P0 | Automatically close an unanswered-message task once the contact receives a reply | functional |
| CLN-P0-12-12 | P0 | Do not automatically close other follow-up tasks until the required action is completed | negative-constraint |
| CLN-P0-12-13 | P0 | If a new reply arrives after closure, reopen the conversation and create a new task | functional |
| CLN-P0-12-14 | P0 | Show open and overdue task counts on the Dashboard and a notification badge in the side menu | ui |

## Feature 13 — Unanswered Conversation Detection (P0)
Area: CRM / Inbox / Tasks / Notifications

| ID | Priority | Requirement | Type |
|---|---|---|---|
| CLN-P0-13-01 | P0 | Detect when the most recent message was sent by the customer | functional |
| CLN-P0-13-02 | P0 | Flag the conversation as Awaiting Reply until a Cleano employee responds | functional |
| CLN-P0-13-03 | P0 | Display how long the customer has been waiting | ui |
| CLN-P0-13-04 | P0 | Allow response-time targets by branch, message type, business hours, and customer type | functional |
| CLN-P0-13-05 | P0 | Do not count time outside business hours unless enabled | functional |
| CLN-P0-13-06 | P0 | Allow urgent keywords to increase priority: Cancel, Complaint, Damage, Late, No Show, Refund, Locked Out, Cleaner Did Not Arrive | data |
| CLN-P0-13-07 | P0 | Create an urgent task when a configured keyword is detected | functional |
| CLN-P0-13-08 | P0 | Notify the assigned user when a conversation is waiting too long and escalate to a manager after a configurable period | functional |
| CLN-P0-13-09 | P0 | Add dashboard reporting for average response time, unanswered conversations, overdue conversations, messages by branch, and messages answered by employee | functional |

## Feature 14 — Email Marketing Campaigns (P1)
Area: Admin Side / CRM / Marketing / Email Campaigns

| ID | Priority | Requirement | Type |
|---|---|---|---|
| CLN-P1-14-01 | P1 | Add an Email Marketing subsection within CRM or Sales | ui |
| CLN-P1-14-02 | P1 | Allow admin to create, design, schedule, send, and review campaigns | functional |
| CLN-P1-14-03 | P1 | Display Draft, Scheduled, Active, Sent, and Cancelled campaigns | data |
| CLN-P1-14-04 | P1 | Include campaign name, subject line, preview text, sender name, sender email, reply-to email, audience, branch, scheduled date/time, and status | data |
| CLN-P1-14-05 | P1 | Allow test emails, draft saving, duplication of past campaigns, editing before send, and cancellation before send | functional |
| CLN-P1-14-06 | P1 | Allow campaign-creation permissions and optional manager approval | permission |
| CLN-P1-14-07 | P1 | Maintain complete campaign history and allow the exact sent email to be viewed | data |

## Feature 15 — Drag-and-Drop Email Campaign Builder (P1)
Area: CRM / Marketing / Campaign Design

| ID | Priority | Requirement | Type |
|---|---|---|---|
| CLN-P1-15-01 | P1 | Add a no-code drag-and-drop email designer inside Cleano OS | ui |
| CLN-P1-15-02 | P1 | Provide content blocks for text, headings, images, logo, buttons, dividers, spacers, columns, promotional offers, booking calls-to-action, social links, contact information, footer, and unsubscribe link | ui |
| CLN-P1-15-03 | P1 | Allow control of font, size, weight, alignment, colours, image size, padding, spacing, borders, and corner radius | ui |
| CLN-P1-15-04 | P1 | Use the Cleano font and design system by default | ui |
| CLN-P1-15-05 | P1 | Allow reusable templates and prebuilt templates for general promotions, seasonal cleaning, recurring service offers, reactivation, referrals, post-service follow-up, review requests, new branch launches, holiday messages, and booking reminders | functional |
| CLN-P1-15-06 | P1 | Allow personalization fields for first name, last name, company, branch, last service date, upcoming booking date, cleaner name, discount code, and booking link | functional |
| CLN-P1-15-07 | P1 | Provide desktop and mobile previews | ui |
| CLN-P1-15-08 | P1 | Warn when subject line, sender information, audience, or unsubscribe link is missing | functional |
| CLN-P1-15-09 | P1 | Allow direct links to the Cleano booking page and automatically add tracking parameters where supported | integration |

## Feature 16 — Email Campaign Analytics (P1)
Area: CRM / Marketing / Reports / Campaign History

| ID | Priority | Requirement | Type |
|---|---|---|---|
| CLN-P1-16-01 | P1 | Show total recipients, delivered, delivery rate, opens, open rate, unique opens, clicks, click rate, unique clicks, click-to-open rate, bounces, bounce rate, unsubscribes, spam complaints where available, and failed deliveries | data |
| CLN-P1-16-02 | P1 | Show which links received the most clicks | functional |
| CLN-P1-16-03 | P1 | Allow admin to view contacts who opened, clicked, did not open, bounced, or unsubscribed | functional |
| CLN-P1-16-04 | P1 | Allow follow-up audiences based on campaign activity | functional |
| CLN-P1-16-05 | P1 | Allow follow-up to non-openers, contacts who clicked the booking button, or contacts who have not yet booked | functional |
| CLN-P1-16-06 | P1 | Display performance over time and campaign comparisons | functional |
| CLN-P1-16-07 | P1 | Add filters for date range, branch, campaign type, audience, and sender | ui |
| CLN-P1-16-08 | P1 | Allow campaign report exports and keep analytics linked to the original campaign | functional |

## Feature 17 — Contact Segmentation and Marketing Lists (P1)
Area: CRM / Contacts / Marketing / Lists

| ID | Priority | Requirement | Type |
|---|---|---|---|
| CLN-P1-17-01 | P1 | Allow static and automatically updated marketing lists | functional |
| CLN-P1-17-02 | P1 | Filter by lead/customer status, branch, city, postal code, service type, cleaning frequency, last booking date, upcoming booking, completed bookings, total spending, quote status, lead source, review rating, campaign activity, recurring status, and inactivity | data |
| CLN-P1-17-03 | P1 | Allow multiple conditions to be combined | functional |
| CLN-P1-17-04 | P1 | Show an estimated recipient count before saving or sending | ui |
| CLN-P1-17-05 | P1 | Exclude unsubscribed contacts, invalid emails, and hard bounces | compliance |
| CLN-P1-17-06 | P1 | Allow manual inclusion and exclusion of contacts | functional |
| CLN-P1-17-07 | P1 | Allow lists to be saved and reused and show which campaigns were sent to each list | functional |

## Feature 18 — Email Consent and Unsubscribe Management (P1)
Area: CRM / Contacts / Marketing / Compliance

| ID | Priority | Requirement | Type |
|---|---|---|---|
| CLN-P1-18-01 | P1 | Add a marketing consent status to every contact: Subscribed, Unsubscribed, Pending, Transactional Messages Only, or Invalid Email | data |
| CLN-P1-18-02 | P1 | Record the date and source of consent, unsubscribe date, and reason where provided | data |
| CLN-P1-18-03 | P1 | Add an unsubscribe link to all marketing emails and process requests automatically | compliance |
| CLN-P1-18-04 | P1 | Immediately exclude unsubscribed contacts from future marketing campaigns | compliance |
| CLN-P1-18-05 | P1 | Continue necessary transactional messages such as booking confirmations, payment notices, appointment reminders, and service updates | functional |
| CLN-P1-18-06 | P1 | Allow admin to view consent history | ui |
| CLN-P1-18-07 | P1 | Prevent ordinary users from overriding an unsubscribe without permission and documented consent | permission |
| CLN-P1-18-08 | P1 | Add suppression lists for unsubscribes, hard bounces, spam complaints, and invalid addresses | compliance |

## Feature 19 — CRM Follow-Up Automations (P2)
Area: CRM / Automations / Marketing / Tasks

| ID | Priority | Requirement | Type |
|---|---|---|---|
| CLN-P2-19-01 | P2 | Create an automation builder with trigger, conditions, delay, action, and stop conditions | functional |
| CLN-P2-19-02 | P2 | Triggers: new lead, quote sent, quote unanswered, booking completed, booking cancelled, poor review, customer inactive for a defined period, campaign opened, campaign link clicked, upcoming recurring cleaning, and failed payment | data |
| CLN-P2-19-03 | P2 | Actions: send email, send SMS, create task, assign contact, update status, add to a list, and notify admin | data |
| CLN-P2-19-04 | P2 | Delays: immediately, after one hour, after one day, after three days, or on a specific date | data |
| CLN-P2-19-05 | P2 | Stop conditions such as stopping when the customer responds or books | functional |
| CLN-P2-19-06 | P2 | Display automation history for every contact | data |
| CLN-P2-19-07 | P2 | Allow automations to be paused, edited, duplicated, and disabled | functional |
| CLN-P2-19-08 | P2 | Add reporting for contacts enrolled, messages sent, replies, bookings generated, tasks completed, and contacts removed | functional |

## Global

| ID | Priority | Requirement | Type |
|---|---|---|---|
| CLN-GLOBAL-01 | P0 | All changes added without removing or duplicating current functionality; existing permissions, records, automations, and booking data remain intact during migration | migration |

---

**Counts:** Feature 1: 14 · F2: 14 · F3: 19 · F4: 18 · F5: 11 · F6: 9 · F7: 9 · F8: 9 · F9: 6 · F10: 17 · F11: 11 · F12: 14 · F13: 9 · F14: 7 · F15: 9 · F16: 8 · F17: 7 · F18: 8 · F19: 8 · Global: 1 = **208**
By priority: P0 = 98 (F1-3: 47, F10-13: 51) · P1 = 95 (F4-8: 56, F14-18: 39) · P2 = 14 (F9: 6, F19: 8) · Global: 1
