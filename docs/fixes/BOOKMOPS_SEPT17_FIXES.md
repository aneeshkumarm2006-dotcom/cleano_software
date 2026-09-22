# Bookmops Sept 17 fixes, working tracker

Source: `bookmopssep17_updated.pdf`, 24 items (9 P0, 15 P1). Received 2026-09-22.

**Legend:** `[ ]` not started · `[~]` in progress · `[x]` done and verified ·
`[!]` blocked on a client decision · `[=]` already shipped on an earlier list

---

## Read this first: the list is 24 items long and 11 items wide

Thirteen of the twenty four are the Sept 10 list again, item for item, and all
thirteen shipped on 2026-09-22. They are marked `[=]` below with a pointer to
where they are written up. Nothing about them needs re-doing; if any of them is
still reported as broken, that is a regression report and should be treated as
one, not as new work.

| Sept 17 | Sept 10 | Where it is written up |
|---|---|---|
| 1. Clear clock-in data on duplicate/reschedule | 1 | [Sept 10 tracker](BOOKMOPS_SEPT10_FIXES.md) |
| 2. Late-night clock-in after midnight | 2 | same |
| 3. Manual cleaner pay saving the wrong amount | 3 | same |
| 4. Notification system for job events | 4 | same |
| 5. Old cleaner pay lines after removal | 5 | same |
| 6. Timezone logic for job scheduling | 6 | same |
| 10. Admin/customer before photos | 7 | same |
| 11. Discount override for recurring jobs | 8 | same |
| 12. Expandable cleaner job breakdown in payroll | 9 | same |
| 14. Sidebar notifications clickable | 12 | same |
| 15. Mark notifications as read | 13 | same |
| 16. Preserve page position | 14 | same |
| 17. Client phone only after accepting | 15 | same |

That leaves **eleven genuinely new items**: 7, 8, 9, 13, 18, 19, 20, 21, 22, 23
and 24. One of those, item 8, is probably already fixed and needs confirming
rather than building.

---

## P0

### [=] 1 to 6

See the table above. All six shipped 2026-09-22.

One caveat worth stating, because it is the only place the Sept 17 wording asks
for more than the Sept 10 wording did. Item 6 here repeats "UI should make
timezone clear where needed". That was added on 2026-09-22 as part of closing
item 6: the job form's time picker and the cleaner job page both now name the
business clock, from `storeTzLabel()`.

---

### [x] 7. Calgary bookings charging QST

Area: Calgary booking page, tax settings, pricing.
Client evidence: Calgary booking page shows GST 5% and QST 9.975% on a $148
service, totalling $170.16, while Calgary's settings have QST set to 0.

**This was not a display bug.** It looked like one, and the screenshot is of a
price breakdown, but the same code produced the number the customer's card was
charged. An Alberta customer was being billed Quebec provincial sales tax.

The arithmetic ran through `calculateTax()` in `src/lib/tax.ts`, which read two
module constants and nothing else:

```ts
export const GST_RATE = 0.05;
export const QST_RATE = 0.09975;
```

Three callers, and between them they covered the whole booking flow:

| Caller | What it decided |
|---|---|
| `Step5Review.tsx` | the price breakdown the customer reads before paying |
| `book/page.tsx` | the running total in the sidebar |
| `computeBookingPrice()` | **what the customer is actually charged** |

`getTaxRates()` already existed, already read the admin-editable `tax.config`
setting, and is already scoped per tenant. Nothing in the booking flow called
it.

**The fix, and why it is shaped this way.**

`calculateTax(subtotal, rates)` now **requires** its rates. It would have been
a smaller change to give it a default, and that default would have kept the
exact bug: every call site that forgot to pass rates would go on charging
Quebec's, and it would look correct in Montreal, which is where anyone testing
it would be. Making it required turned each of the three into a compile error
that had to be answered.

Then the rates had to reach the browser, since two of the three callers run
there. They ride along with the rest of the booking config, so they arrive with
everything else the page needs rather than as a separate round-trip. The page
holds them as `TaxRates | null` and treats null as **zero**, deliberately not
as the Quebec defaults: seeding the defaults is precisely what showed a Calgary
customer 9.975%, and nothing priced is on screen before the config lands
anyway.

**The labels were a second bug inside the first.** Every price breakdown in the
app had `"QST (9.975%)"` typed into it as a string. Even once the arithmetic
was per-tenant, the screen would have gone on naming Quebec's rate over a
$0.00 amount, which is still the complaint. `taxLines()` now builds the rows
from the rates, and **a rate of zero produces no row at all** — the PDF asks for
this outright ("if QST rate is 0, QST should not appear in the customer price
breakdown"). Applied to: the booking review, the booking sidebar, the customer
booking detail page, all three customer emails, the PDF receipt, the admin job
form, the admin job financials, the calendar side panel, the invoice preview
and the create-invoice modal.

Two smaller things fixed in the same pass:

- **`calculateTax` and `computeJobTaxes` were two implementations of the same
  arithmetic**, one for bookings and one for jobs and invoices. A booking that
  rounded one way became a job that rounded the other. The first now delegates
  to the second.
- **`DEFAULT_TAX_RATES.qstRate` was `9.975000000000001`**, because it was
  derived as `QST_RATE * 100`. That value is the fallback that lands in the
  admin's rate FIELD when a workspace has never saved its tax settings, so it
  put a seventeen-digit number in front of someone to edit. It is written out
  now.

Six files were each re-reading `tax.config` by hand with a `?? 9.975` fallback
typed into them. They are per-tenant and were never part of the bug, but they
are how it would come back, so the literals now point at the one seed.

**Deliberately not changed:** the seed rates themselves. A brand-new workspace
that has never opened Settings → Taxes still starts on Quebec's, because
changing that default would silently move the tax charged by any existing
workspace relying on it. It is a business decision, not a bug, and the admin
sets it on day one.

**Verified:** `scripts/verify-sept17-fixes.ts`. The reported booking is a test:
$148 at Montreal's rates is $170.16, at Calgary's it is $155.40, and the
customer pays $14.76 less. Plus: the QST row disappears rather than reading
$0.00, an unrelated rate (13%) prints correctly so nothing is hardcoded, a
booking and the job it becomes round identically, and none of the ten display
surfaces contains a literal rate any more.

---

### [x] 8. Manual team pay split showing the wrong amount

Area: admin jobs, cleaner pay, calendar side panel.
Client evidence: employee pay set to $130 total for 2 cleaners; the calendar
side panel shows about $43 each instead of $65.

**Confirmed against the reported job: already fixed.**

$130 divided by two is $65. $130 divided by **three** is $43.33, which is "about
$43 each". So the panel was not mis-splitting the money, it was splitting it
between three heads when only two cleaners were assigned — and that is exactly
the defect behind Sept 10 items 3 and 5: a `JobAssignment` row left at
`CANCELLED` when a cleaner comes off a job is kept as history, and the pay math
counted it as a payable head.

Checked against production, read-only, on 2026-09-22. **Job #2544, Lina
Paolini**: `employeePay` $130, `employeePayIsManual` true, **two** cleaners on
the job (Amanda De Souza Filgueiras, Arnaldo Da Silva Filgueiras) and **three**
assignment rows, one of them CANCELLED.

| | |
|---|---|
| Old math, all three rows | $130 / 3 = **$43.33 each** — the reported figure |
| New math, live rows only | $130 / 2 = **$65.00 each** |

No code needed. The fix shipped on 2026-09-22 with Sept 10 items 3 and 5.
One other job carries the same shape (#2396, $160, one cancelled row).

---

### [x] 9. Confirm booking button greyed out

Area: client booking, Calgary booking page, checkout.
Client evidence: customer reaches the final step, consent boxes are checked,
Confirm booking stays greyed out.

**The button was right. The page was silent.**

The last step requires two things: the terms ticked, and either a completed
card or a workspace that charges no deposit. A customer who ticks the two
consent boxes on that screen has done one of the two, and the second one — the
card — is a Stripe form further up the page that they have not finished. So the
button is correctly disabled, and nothing on the page says so. A disabled
button with no explanation is indistinguishable from a broken one, and the
customer's only remaining move is to leave.

**What was built.**

The wizard's gating rules were a `switch` inside `book/page.tsx` that answered
yes or no. They now live in `book/blockers.ts` and return the REASONS, with
"may proceed" defined as "there are no reasons not to". That ordering matters:
writing a second function to explain the no would have meant two copies of the
same rules, and the copy that drifts is always the one nobody is looking at, so
the page would eventually say "add your card" while the button waited on
something else.

On screen:

- A short list above the button naming what is left, in the customer's words
  and in the order the controls appear: *"One thing left before you can
  confirm: finish entering your card details for the deposit."*
- It is shown **in place**, not on click. An explanation that only appears when
  you press a disabled button never appears at all, because a disabled button
  does not take the press.
- The terms checkbox is pointed at while it is the thing holding the booking
  up. In the page's own accent, not red: that box is unticked because nobody
  has ticked it yet, which is not a mistake, and an error colour on arrival
  reads as an accusation.
- It clears the instant the last requirement is met, which is what the PDF asks
  for ("button should become active immediately").

**Two real dead ends were found and closed while in there**, both in the
payment block, and both of which produced the reported symptom with no message
at all:

- If the draft had no name or email, the effect that creates the payment intent
  returned **in silence**: no spinner, no error, no card form, and a grey
  button for a reason that appeared nowhere. Only reachable from a restored
  session, which is exactly the case nobody tests by hand.
- If the intent request resolved without a client secret and without a known
  error code, the customer got an empty box above a dead button. It now says
  the form did not load and what to do about it.

**Verified:** `scripts/verify-sept17-fixes.ts`. The reported state is a test:
terms ticked and no card is still blocked, and the reason returned is the card.
The property that matters most is checked across nine draft states and all five
steps: **blocked and explained are always the same answer**, so no state can
block without saying why. Also that arriving at the review step and confirming
from it stay different questions, or a customer could never reach the screen
that holds the terms box.

---

## P1

### [=] 10, 11, 12, 14, 15, 16, 17

See the table at the top. All shipped 2026-09-22.

### [x] 13. Cleaner rating system: reviews, admin ratings, notes, history

Half of it was already shipped. Sept 10 item 11 linked customer reviews to the
cleaner's profile rating and settled the multi-cleaner rule with the client: **a
customer's rating applies to every assigned cleaner**, four stars on a
three-cleaner job is four stars each. That is the PDF's open question here,
already answered.

What was added: an admin adding a rating **with a real reason** (the old control
wrote the fixed string "Admin manual override", so the history could show THAT
an admin intervened and never why), correcting a rating, and a rating history
showing value, note, source, the related job, who added it and when. Removal
stays an EXCLUSION — the row is kept with the reason on it and drops out of the
average — which is the PDF's own second option, and destroying the row would
take the reason with it.

One nullable column, `EmployeeRating.source`. Legacy rows are read rather than
backfilled: the emailed link and the portal stamp `ratedBy` with `client-link`
or `client-portal`, anything else in that column is a user id, so the rule that
a backfill would have used is applied on read instead.

**A live leak was found and closed in the same pass.** `/reviews`, the PUBLIC
reviews page, selected any rating above the threshold that had a note and
published it as a customer testimonial. In production **42 of 56 ratings are
admin entries and 34 of them would have qualified** — so the page was showing
"Admin manual override" over five stars under a client's name. Now that those
notes are a real sentence an admin types about a cleaner, the same query would
have published the office's private reasoning. It now takes proof that a row
came from a customer, not the absence of proof that it did not.

### [x] 18. One-off custom checklist in the job form

`Job.customChecklist`, one nullable JSON column. Items typed into the job beat
every template including a per-job pin, which is what the PDF asks for, and are
checked BEFORE the template query so the feature works in a workspace with no
templates at all — the other half of what it asks for.

JSON rather than rows because the list has no life outside its job: not shared,
not versioned, not referenced. It is validated on every READ rather than
trusted from the write, because it is read on the cleaner's screen mid-shift
and a column is only as trustworthy as the last thing that touched it.

The editor lives in the job form with add, edit, remove and reorder. Position
in the array IS the order, so there is no `sortOrder` field to drift out of
step with it. A save that does not carry the editor cannot wipe the list —
same marker pattern as `cleanersSubmitted`.

Not built: "save it as a reusable template". Noted as the one sub-bullet left.

### [x] 19. Cleaner time log change requests

New table, `TimeLogChangeRequest`, with the tenant-isolation policy in the same
migration — `scripts/verify-rls-coverage.ts` makes a missing one a red build.

The cleaner asks from their job page once the shift is finished; the admin
decides from a **Time log change requests** subsection on Notifications, which
is where the PDF asks for it by name. A rejection takes a note the cleaner
sees, because "no" with no reason is how the next request becomes an argument.

**Approval delegates to `updateClockTimes`.** Writing the new times onto the
session here would have been shorter and wrong: that function validates the
pair, refuses an edit inside a locked pay period, rewrites the job-level and
assignment mirrors so the next clock action does not silently revert the
change, re-snapshots hourly pay and billed hours, and writes the job log. A
correction made this way has to be byte-identical to one an admin typed.

The sharp edge, found while wiring it: `updateClockTimes` reads null as **clear
this time**, not "leave it alone". Approving a start-only correction with null
for the finish would have wiped the cleaner's clock-out and zeroed their hours.
The untouched side is now re-read from the clock **as it stands now** and passed
back unchanged — not from the request's stored original, which an admin may
have corrected in the meantime.

### [x] 20. Apply to this booking or future bookings for recurring edits

Mostly already built, which the first pass did not expect: the job form has had
an "apply to the whole recurring series" control with the affected count in its
label, a curated list of fields that propagate, and protection for completed,
paid and cancelled occurrences.

Two real gaps closed. **Add-ons now follow a series edit** — they are a
relation so they could not ride along in the `updateMany`, and the price they
contribute already propagated, so occurrence 4 was charging for a carpet clean
its own line items never mentioned. And **the job log now records which scope
was used**, which the PDF asks for outright.

Dates still deliberately do not propagate: each occurrence has its own slot,
which is the entire point of a series.

### [x] 21. Frequency changes when editing existing jobs

The cadence **was never stored**. The form posted a frequency, job creation
used it to generate the occurrences, and then discarded it; the only surviving
trace was `parentJobId` linking the jobs. So there was nothing to show an admin
and nothing to change. `Job.recurringFrequency` fixes that, and it propagates
across a series because a cadence is a property of the series.

Changing it rebuilds the upcoming occurrences, and only with "apply to the
whole series" ticked — changing one visit's cadence is meaningless.

**Withdrawn, not deleted.** The occurrences being replaced are soft-deleted, the
state the Jobs list's Archived view already shows. Hard-deleting would destroy
assignment rows, invites, chat and logs for bookings that were real, and a
cadence change is an edit, not a purge. Only occurrences that are in the
future, unsettled, and that nobody has clocked into are touched at all.

A job that pre-dates the column reads "not recorded" rather than being guessed
at as ONE_TIME: inventing a cadence for a series that might be monthly would
rebuild the schedule wrongly on the first save.

### [x] 22. Per-cleaner hourly pay rates

`JobAssignment.hourlyRate` and `User.defaultHourlyRate`, both nullable. NULL on
the assignment means "use the job's crew-wide rate", which is what every
existing row does, so **no job is repriced by this migration**.

The precedence is deliberate and is the opposite of the obvious one. A
cleaner's PROFILE rate is never read at pay time; it only SEEDS the assignment
when they are put on a new hourly job, where an admin can see and change it. If
pay were computed from the profile, giving someone a raise today would quietly
change what they are owed for work already scheduled, and for hourly work
already done but not yet paid.

`hourlyClockedHours` now returns a per-cleaner rate lookup instead of one rate,
so each cleaner earns their own hours times their own rate and the team total
is the sum of those. A CANCELLED assignment's rate is history, not a rate.

Live shape: **144 hourly-paid jobs, 51 of them with two or more cleaners** on a
single shared rate today.

Not built: the settings table of default rates by tier. The profile default
covers the PDF's "default from the cleaner employee profile"; the tier table is
the one sub-bullet left.

### [x] 23. Unassign future jobs when a cleaner is deactivated

Deactivating locked the cleaner out of the app and did nothing else, so every
job they were booked on still showed them as crew — the calendar read as
covered right up to the morning of the clean. There is **one such job in
production right now**, on a cleaner deactivated some time ago.

Only jobs that have not happened yet, measured from the start of TODAY in the
business clock rather than from this instant: a 9 AM job that an admin is
deactivating someone from at 2 PM is today's work, and pulling a cleaner off it
silently mid-afternoon is not what "future jobs" means.

Mirrors `cancelShift` exactly, because it is the same act from the other side
of the desk: disconnect from the crew, hand the lead to whoever is left, mark
the assignment row CANCELLED rather than deleting it — keeping that row is what
stops the cleaner reappearing in payroll as a ghost head, per Sept 10 items 3
and 5.

The admin is warned with the real count before confirming, from the same
predicate that does the work, so the dialog cannot promise one thing and do
another. Jobs left with nobody on them raise their own notification, pointing
at a new `?attention=unassigned` view.

### [x] 24. Improve text contrast across the app

The faint-teal ramp had to change **shape**, not value. An earlier pass had
already raised its alpha and got as far as it could: alpha over `#008C9C` tops
out at 4.01:1 on white at full opacity, so no value in an alpha ramp reaches
AA. `--primary-40..70` are now solid darkened teals of the same hue, and every
step clears 4.5:1 on white and on the admin surface:

| token | hex | on white | on --cream |
|---|---|---|---|
| `--primary-40` | `#007785` | 5.28 | 4.87 |
| `--primary-50` | `#00707d` | 5.81 | 5.36 |
| `--primary-60` | `#006975` | 6.41 | 5.91 |
| `--primary-70` | `#00626d` | 7.08 | 6.52 |

The customer and booking app had its own, fainter ramp — `--primary-40` was
0.4 alpha, about 1.7:1, which is the "barely readable" helper text and
placeholders the PDF reports on the booking page. Both apps now use the same
values, so they no longer disagree about what "secondary" looks like.

The ramp still reads as a ramp, which is the other half of the ask:
placeholders stay visibly lighter than body text while being readable. The fill
ramp (`--primary-5..30`) is untouched — those are borders and tints, not text.

Separately, **52 uses of Tailwind's `text-gray-400`** (2.84:1, fails) became
`text-gray-500` (4.83:1, passes) across admin, cleaner, customer and shared
components.

---

## Status

**All 24 items are done as of 2026-09-22** — thirteen shipped with the Sept 10
list, eleven built here.

Two sub-bullets are deliberately left, both noted above: "save a one-off
checklist as a reusable template" (item 18) and the settings table of default
hourly rates by tier (item 22). Neither blocks the item it belongs to.

## The migrations

Five, all additive, all nullable-or-new, none with a backfill. Per the standing
rule they are applied deliberately before any push, never as part of a deploy.

| Migration | What it adds | Item |
|---|---|---|
| `20260922160000_employee_rating_source` | `EmployeeRating.source` | 13 |
| `20260922170000_per_cleaner_hourly_rates` | `JobAssignment.hourlyRate`, `User.defaultHourlyRate` | 22 |
| `20260922180000_job_custom_checklist` | `Job.customChecklist` | 18 |
| `20260922190000_time_log_change_requests` | the `TimeLogChangeRequest` table, with its RLS policy | 19 |
| `20260922200000_job_recurring_frequency` | `Job.recurringFrequency` | 21 |

Every added column is NULL for every existing row, and NULL means "behave
exactly as before" in each case, so no job is repriced, no checklist changes
and no rating moves. The new table starts empty, and an empty request queue is
today's behaviour. All five reverse by dropping what they added.

## One thing that needs a person, not code

**CleanoCalgary's workspace timezone is the string `"Toronto"`**, which is not
an IANA zone at all. `Intl` refuses it, so every date in that workspace falls
back to the deployment default and the tenant clock built for item 6 cannot
work for the one tenant it was built for.

The guard added on 2026-09-22 is what stops that throwing on every date rather
than printing the wrong hour, so nothing is broken — it is just wrong by two
hours. The row needs to say `America/Edmonton`.

Two code changes went in alongside it so it cannot happen again: the platform
console now refuses a zone `Intl` cannot resolve when a workspace is created,
and **Settings → General now writes the workspace's timezone for real**. That
control's own help text called itself "the source of truth for date and time
handling" and nothing read it — an admin could pick their timezone, be told it
saved, and watch nothing move.

## What order they were built in, and why

The order was not the PDF's. It put the two that were costing money or losing
bookings first, then the confirmation, then the self-contained items, then the
one that touches everything.

1. **Item 7**, Calgary QST — the only one where the wrong number reached a
   customer's card.
2. **Item 9**, the greyed-out Confirm button — the only one losing bookings.
3. **Item 8**, confirmed against the reported job rather than built.
4. **Item 23**, self-contained, and a real source of scheduling errors.
5. **Item 13**, the admin half of ratings. Found the public-reviews leak.
6. **Item 22**, per-cleaner hourly rates.
7. **Item 18**, one-off checklists.
8. **Item 20**, which turned out to be mostly built, then **item 21**, which
   only makes sense once 20 has decided how far an edit reaches.
9. **Item 19**, time log change requests.
10. **Item 24**, contrast — last on purpose, so it covered the markup every
    item above had just added.
