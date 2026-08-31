# Settings — Redesign Inventory

Everything inside the admin **Settings** area, tab by tab, so each can be
redesigned and handed back for implementation.

**Route:** `/settings` · **Files:** `src/app/(app)/settings/`

---

## Shell (frame around every tab)

`SettingsClient.tsx` + `page.tsx`

- **Page header:** eyebrow "Admin" → display title "Settings" → subtitle
  "Manage your account and application configuration."
- **Layout:** two columns — left sidebar (220px) + right content panel.
- **Left sidebar:** rounded `primary-5` container; one button per tab (lucide
  icon + label). Active tab = solid teal `--primary` bg, white text, weight 600.
- **Right panel:** renders the active tab.
- **Access:** Profile + Availability show for everyone; all other tabs are
  `adminOnly` (OWNER/ADMIN). 26 tabs total, in this order:
  1. Profile · 2. Availability · 3. Closed Dates · 4. Tax · 5. Pricing Rules ·
  6. Job Types · 7. Payment Types · 8. Inventory Rules · 9. Kit Templates ·
  10. Checklist Templates · 11. Training · 12. Documents · 13. Multipliers ·
  14. Roles · 15. Suppliers · 16. Inventory Locations · 17. Service Areas ·
  18. General · 19. Customer · 20. Provider · 21. Payments & Fees ·
  22. Scheduling · 23. Calendar Labels · 24. Website & FAQ · 25. Retention ·
  26. Notifications.

### Shared primitives (used by almost every tab) — `tabs/_shared.tsx`
- **SectionCard** — card with icon bubble + title + optional description +
  optional actions slot; wraps tab content.
- **Field** — label + input + optional hint, stacked.
- **Feedback** — success (teal tint) / error (red tint) message strip.
- **themedInputClass / themedSelectClass** — teal-tinted input/select styling.
- Also reused: `components/ui/` **Input** (variant="form"), **Button**
  (action/ghost), **IconButton**, **Modal**, **PremiumSelect**, **DatePicker**,
  **TimePicker**, **Checkbox**; `common/ConfirmDeleteModal`; `csv/ImportCsvButton`.

**Common pattern:** most tabs = one or more SectionCards of Fields + a Feedback
strip + a single "Save" button (shows "Saving…" while pending). CRUD tabs add a
list/table + "New …" button + an edit Modal + ConfirmDeleteModal.

---

## 1. Profile  *(everyone)*

Employee dashboard. Has internal sub-tabs:
- **Profile:** hero of 3 tiles (30-day rating, pay multiplier, tier). Two
  SectionCards — profile info (Name, Email, Phone fields + read-only Role) and
  Change password (3 show/hide password inputs, min-8 + match validation).
- **Performance:** 3 SectionCards — current rating, 90-day SVG trend chart, last
  10 ratings (stars + date + client + notes).
- **My Income:** YTD earnings grid (gross/net/taxes/deductions/adjustments/
  reimbursements/hours/jobs) + mini grid (pending/withdrawn/paid periods) +
  "Download tax summary" PDF button.
- **Notifications:** checkbox list of ~15 personal notification types (new job,
  reminders, pay, ratings, documents, training, etc.) + save.

## 2. Availability  *(everyone)*

SectionCard (Calendar icon). 7 day rows (`cl-avail-row`): day label + "Available"
checkbox + start TimePicker + "to" + end TimePicker (pickers disabled when day
off). Footer: "Recurring weekly" checkbox + "Effective from" / "Effective to"
DatePickers. Validation: end > start. Save button. Loading state.

## 3. Closed Dates

SectionCard (CalendarOff). **Builder:** Date (DatePicker) + "Entire day" / "Time
range" toggle (→ From/To TimePickers when range) + "Reason (shown to your team)"
input + "Add closure" button. **List:** closure rows (date + "Entire day" or time
range + reason + Trash IconButton), sorted by date/time. Empty state. Save button.

## 4. Tax

SectionCard (Percent). 2-col Field grid: GST Rate (%) number, QST Rate (%)
number, GST Number text, QST Number text. Feedback + Save.

## 5. Pricing Rules

Four SectionCards:
- **Per-Unit Pricing** (BedDouble): Base service price, Per Bedroom, Per Full
  Bathroom, Per Half Bathroom (all number) + live example price.
- **Add-Ons** (Sparkles): inline-editable rows (Name text, Price $ number, Room
  select [Kitchen/Bathroom/Bedroom/Living/Laundry/Outdoor/Whole-home], Trash) +
  per-add-on service-type filter toggles (Standard/Deep/Move-in-out/
  Post-construction/Airbnb) + "Add Add-On" + empty state.
- **Move-in / Move-out** (Truck): large-home threshold (sqft), rate at/above,
  rate below + computed examples.
- **Post-construction** (HardHat): package price, package hours, extra-hour rate
  + computed example.
Feedback + Save.

## 6. Job Types

SectionCard (Briefcase). Inline-editable rows: name input + "Active" checkbox +
Trash. "Add Job Type" + empty state. Feedback + Save.

## 7. Payment Types

SectionCard (CreditCard). 5 label rows (uppercase monospace key + text input):
CASH, CHEQUE, E_TRANSFER, CREDIT_CARD, OTHER. Feedback + Save.

## 8. Inventory Rules

SectionCard (Boxes). Product table: Product (name+unit) | Usage/Job (number) |
Refill Threshold (number) | Stock (read-only) | Actions (per-row Save, Clear if
rule exists). ImportCsvButton. Empty state. Feedback.

## 9. Kit Templates

SectionCard (Package). Kit cards (title, inactive badge, description, product×qty
tags, Edit/Delete icons). ImportCsvButton + "New Kit". **Modal:** Name,
Description, Active checkbox, Products section (PremiumSelect + qty + remove rows,
"Add Product"). ConfirmDeleteModal. Empty state.

## 10. Checklist Templates

SectionCard (ListChecks). Template cards (title, inactive/job-type/add-on/standard
badges, description, item count, Edit/Delete). "New Template". **Modal:** Name,
Description, Job Type (PremiumSelect), Add-On Name (text, case-sensitive hint),
Active, Checklist Items (reorderable rows: ▲▼ + Title + Description + Required
checkbox + remove, "Add Item"). Scrollable (70vh). ConfirmDeleteModal.

## 11. Training

SectionCard + "New Module". Module rows (▲▼ reorder, title, description,
Required/Inactive/quiz-count badges, "Video set" + duration + completed/total
stats link, Edit/Delete). **Create/Edit Modal:** Title, Description, Video URL,
Duration (sec), Order, Required + Active checkboxes, **Quiz builder** (question
cards: question text + remove; options with correct-answer toggle + text +
remove; "Add Option"; "Add Question"). **Stats Modal:** employee progress table
(Employee | Status | Video % | Quiz %). ConfirmDeleteModal. Validation (title,
≥2 options, a correct answer marked).

## 12. Documents

SectionCard + "New Document". Document rows (title + version badge, "File" badge
if PDF, description, due date w/ Clock, signed/total link, pending count, Assign/
Remind/Delete actions). **Create Modal:** Title, Description, Version, Due Date
(DatePicker), Text vs File-URL toggle (→ textarea or URL input), "Assign to"
PremiumSelect (All / Specific roles → role checkboxes / Specific users →
checkbox list). **Assign Modal** (same assign UI). **Signature Status Modal**
(Employee | Status [Signed/Pending] | Signed At). ConfirmDeleteModal (cascade
warning).

## 13. Multipliers

SectionCard (Star). 13 rating rows (4.0→5.0 in 0.1 steps): star + rating label +
multiplier number input. Feedback + Save.

## 14. Roles  *(read-only)*

SectionCard (Shield). Permission matrix table: Feature | Owner | Admin | Employee
— ~13 feature rows, green Check / faint X per cell. No save (read-only).

## 15. Suppliers

SectionCard (Truck). Expandable supplier cards (chevron, name, inactive badge,
contact·email·phone summary, Edit/Delete; expanded → product-pricing table:
Product | Price $ | Unit | Save/Clear). ImportCsvButton + "New Supplier".
**Modal:** 2-col (Name, Contact Person, Email, Phone) + Address + Notes + Active.
ConfirmDeleteModal.

## 16. Inventory Locations

SectionCard (MapPin). Location cards (title, inactive badge, address, notes,
stocked-count, "Manage Stock"/Edit/Delete). ImportCsvButton + "New Location".
**Edit Modal:** Name, Address, Notes, Active. **Stock Modal:** per-product
quantity inputs + per-row Save (scrollable 60vh). ConfirmDeleteModal.

## 17. Service Areas

SectionCard (MapPinned). Table sorted by prefix: Prefix (monospace) | Zone |
Travel Fee ($ or —) | Status (Active/Disabled toggle) | Actions (Edit/Delete).
"Add area". **Modal:** Postal prefix (2–3 chars, locked when editing), Zone name,
Travel fee (optional), Notes (textarea), Active checkbox. ConfirmDeleteModal.

## 18. General

SectionCard (Globe). Currency Field (select CAD/USD) + info text. Feedback + Save.

## 19. Customer

SectionCard (Users). Fields: New-client referral discount (USD), Referrer credit
(USD), Cancellation reasons (textarea, one per line), SMS opt-in default
(checkbox), Enable live reviews (checkbox), Review minimum star threshold (1–5),
Blocked-customer message (textarea). Feedback + Save.

## 20. Provider

SectionCard (HardHat). Show customer phone number (checkbox) + Deactivated-
provider message (textarea) + explanation text. Feedback + Save.

## 21. Payments & Fees

SectionCard (Wallet). Cancellation fee (CAD), Cancellation fee window (hours),
Gift card tiers (comma-separated text) + pricing/currency notes. Feedback + Save.

## 22. Scheduling

SectionCard (CalendarClock). No-show fee (USD), Accept/decline timeout (minutes),
Recurring weekly horizon (days), Minimum lead days — all number inputs +
explanation. Feedback + Save.

## 23. Calendar Labels

SectionCard (Tags). One Field per job type: select (Routine / Important / None) +
live preview badge. Feedback + Save.

## 24. Website & FAQ

SectionCard (Globe2). Custom domain (text). **FAQ builder:** "Add" button + FAQ
rows (question input + Trash, answer textarea) + empty state. **Embed codes:** 5
pre-formatted code blocks (booking form, gift cards, FAQ, reviews, customer
login) with the domain interpolated. Feedback + Save.

## 25. Retention

SectionCard (HeartHandshake). "Include a save offer in the check-in email"
checkbox; Offer type (% off / $ off select) + amount number (both disabled when
off); Email intro wording (textarea). Feedback + Save.

## 26. Notifications  *(auto-saves, no Save button)*

Header card (Bell) + "Refresh catalog" button. Recipient tabs (ADMIN / CUSTOMER /
PROVIDER, each with count). Category cards: header with per-channel bulk "Enable
all / Disable all" buttons; notification rows (label + "PROPOSED" amber badge +
trigger description; per-channel On/Off toggle buttons for EMAIL/SMS/APP_PUSH,
"—" if a channel is unavailable). Optimistic toggle, reverts on error. Empty
state.

---

## How to use this

Pick a tab (or cluster — e.g. all the money tabs: Pricing, Payments, Tax,
Multipliers; or all the CRUD tabs: Kits, Checklists, Suppliers, Locations).
Design against its section above — every SectionCard, field, table, and modal is
listed. Hand the design back; implementation reuses the shared primitives
(SectionCard / Field / Feedback / Modal) or custom-builds where the design needs.
