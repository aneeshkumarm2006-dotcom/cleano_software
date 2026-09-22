# Bookmops Sept 10 fixes, working tracker

Source: `BOOKMOPSsept10.pdf`, 15 items (6 P0, 9 P1). Received 2026-09-22.

Earlier lists: [`AWER_FIXES.md`](AWER_FIXES.md) (29 items) and
[`AWER_NEW_FIXES.md`](AWER_NEW_FIXES.md) (5 items). This is a separate list and
does not supersede them, but two items here touch code those lists already
changed, and that is called out below.

**Legend:** `[ ]` not started · `[~]` in progress · `[x]` done and verified ·
`[!]` blocked on a client decision

Everything below marked "first pass" is a read of the code done on 2026-09-22
before any change. It is a hypothesis with the evidence attached, not a fix.

---

## Decisions taken

Both questions this list raised were already settled, and the answers are
written down rather than remembered.

1. **Manual cleaner pay stays a team total** (decision D2, recorded in
   `docs/product/CLIENT_DECISIONS.md`). A figure typed into `Employee pay` and
   flagged Manual is the whole crew's money, split evenly, minus any
   per-cleaner override. Per-cleaner amounts have their own control, the
   "Custom pay" field from `AWER_FIXES.md` item 10. Nothing about that model
   changes. The PDF agrees with it: "should not be divided unless multiple
   cleaners are assigned". So item 3 is a head-count bug, not a redesign.
2. **A customer's rating applies to every assigned cleaner** (confirmed
   2026-09-22). Four stars on a three-cleaner job is four stars each. There is
   no per-cleaner adjustment to build, which unblocks item 11.

---

## P0, the six that cost money or block work

### [x] 1. Clear clock-in data when a job is duplicated or rescheduled

Area: admin jobs, duplicate, reschedule, time tracking.

**Done 2026-09-22.** Most of this was already built, in a round that is not
recorded in any tracker here. Taking it item by item rather than assuming:

**Duplicate was never broken.** There is no `duplicateJob` action because there
is no copy. The button sends the admin to `/admin/jobs/new?duplicate=<id>`,
which reads the source job only to fill in form defaults and then creates a
brand new row through the ordinary save. Photos, product usage, checklists,
work sessions and the clock all hang off the job id, so the new job starts
empty by construction. Nothing to fix, and a test now guards it.

**Reschedule was already handled, and thoroughly.**
`clearWorkTrailForReschedule` in `src/lib/job-reschedule.ts` clears the
job-level clock mirror, deletes the work sessions and breaks, resets the
per-cleaner `JobAssignment` rows to ASSIGNED, puts an IN_PROGRESS job back to
SCHEDULED, and writes an activity-log row saying what was discarded. It is
called from all three paths that can move a date: the shared save action, the
full-page job editor, and the calendar drag. A COMPLETED or PAID job is left
alone, which is exactly the exception the PDF asks for.

**The one thing that did still carry over: checklist ticks.** A job moved to
next Tuesday arrived with nine of twelve tasks already ticked, which tells the
cleaner to skip nine rooms. Every non-PENDING item is now put back to PENDING
with its `completedAt` cleared, in the same transaction as the rest. SKIPPED
counts as a tick, because skipping was a decision about the old visit. Item
`notes` are kept: a note is an observation about the property, not a claim that
the task is done.

**Two things are deliberately NOT deleted on a reschedule**, and the PDF asks
for both. On a duplicate they already do not carry, as above. On a reschedule,
deleting them would be the worse bug:

- `JobProductUsage` carries `inventoryBefore` and `inventoryAfter`. The stock
  really did leave the van. Deleting the row does not put it back, it only
  makes the inventory count unexplainable.
- Photos are the only evidence the work happened, they live in blob storage as
  well as in the database, and an admin correcting a date has not asked to
  destroy a cleaner's proof.

Both stay attached as the record of the earlier attempt, and the log row now
says so in words: "Photos and product usage were kept." If the client wants
them detached rather than kept, that is a deliberate archive feature with a
migration behind it, not a silent delete on a date edit. **This is the one
place where we have not done exactly what the PDF says, and it is on purpose.**

While here, the decision was pulled out of the database call into a pure
`planWorkTrailReset(job, now)`, so what counts as a trail, which cleaners must
not be dragged back onto the job, and how many minutes are being discarded are
all checkable without a connection. The function was renamed from
`clearClockTrailForReschedule` because it no longer only clears the clock.

No migration. Verified: 47/47 in `scripts/verify-sept10-fixes.ts`, including a
two-person job resetting both checklists, a cancelled cleaner never being
dragged back to ASSIGNED, open sessions measured to the moment of the
reschedule, and source assertions that all three date-moving paths still call
the helper. That last one matters: the full-page editor shipped once without
the call, and this is what stops it happening a third time.

### [x] 2. Late-night clock-in after midnight

Area: cleaner jobs, clock-in, date logic.

First pass, and this one is already located. The clock-in action itself has no
calendar-date guard at all. `clockInOpensAt` is just start time minus the early
window, and the blocked statuses are only CANCELLED and PAID. The block comes
from which jobs the cleaner's list shows:

```ts
// src/lib/cleaner-jobs.ts
export function upcomingFilter(now: Date = new Date()): Prisma.JobWhereInput {
  return { startTime: { gte: startOfDayTz(now) }, clockOutTime: null, ... };
}
export function pastFilter(now: Date = new Date()) {
  return { startTime: { lt: startOfDayTz(now) } };
}
```

An 11:55 PM job on the 10th has `startTime` before `startOfDayTz(now)` once the
clock passes midnight, so it leaves Upcoming, lands in Past, and the cleaner
loses the button. The fix belongs in the filter, not the action: a job that is
unfinished and inside its own service window stays upcoming regardless of the
calendar date. Every surface reading these fragments gets it at once.

**Done 2026-09-22.** New `stillWithinServiceWindow(now)` in `cleaner-jobs.ts`.
A job that started before today stays upcoming while it has no clock-out, is
not closed, and `now` has not passed its `endTime` plus a grace period
(`SERVICE_WINDOW_GRACE_HOURS = 6`; a job with no `endTime` is measured from its
start plus `ASSUMED_JOB_HOURS = 4`). Prisma cannot add the grace to a column
inside a `where`, so the comparison is inverted to `endTime >= now - grace`,
which is the same statement with the arithmetic on the side we control.

`pastFilter` now negates the same predicate. That is the part worth guarding:
the two filters have to agree exactly, or a job appears in both lists at once,
which is what an earlier round of this filter got wrong and is a more visible
bug than the one being fixed.

No migration. No change to the clock-in action, which never had a date test.
The "too early" message was already clear and is untouched.

Verified: `npx tsx scripts/verify-sept10-fixes.ts`, 17/17. The script carries a
small evaluator for the Prisma operators these fragments use and runs real job
rows through the real filters, so it tests the logic without a database. It
covers the reported case, a job with no `endTime`, a job already in progress,
the window closing the next morning, finished and cancelled overnight jobs, and
two properties: no job is ever in both lists, and today's work is untouched.
Reverting the fix turns the suite red, which is how we know it tests something.
Full sweep: 16 of 53 suites fail, the same 16 that failed before this change.

### [x] 3. Manual cleaner pay saving the wrong amount

Area: admin jobs, cleaner pay, manual override, payroll.
Client evidence: $180 entered for a one-cleaner job, saved as $90.

First pass: manual pay is modelled as a **team total split evenly**, not a
per-cleaner rate. `src/lib/pay-basis.ts` labels it "Manual, team total, split
evenly", and the client's own screenshot of a three-cleaner job shows $160
becoming three lines of $53.33, which is that model working as designed.

$180 halving means the job had **two** participants where the admin expected
one. `jobParticipantIds` in `src/lib/cleaner-earnings.ts` drops the job's
`employeeId` only when the rates map says that person is ADMIN or OWNER:

```ts
const role = rates?.get(lead)?.role;
if (role === "ADMIN" || role === "OWNER") return Array.from(explicit);
```

If `rates` is not passed, or the lead is missing from it, the admin counts as a
payable head and the pool halves. That is the same root cause written up as
cause 1 in `AWER_FIXES.md`, surviving on a path that call site never covered.

Per decision D2 above, the team-total model stays.

**Done 2026-09-22, and it turned out to be item 5.** The extra head was not the
admin. It was a cleaner who had already left the job. See item 5 below for the
cause and the change; both complaints are the same defect seen from two pages.

What the client sees now: $180 typed for a one-cleaner job pays that cleaner
$180. A genuine two-person job still splits to $90 each, and the three-cleaner
$160 job in their own screenshot still splits cent-exact.

### [x] 4. Notification system for cleaner and admin job events

Area: notifications, both sides, clock in and out.

**Done 2026-09-22.** The first pass was half right. The catalog is not
missing, but it is an EMAIL catalog: roughly forty `admin.*` keys exist, and
only **nine** of them also write to the in-app feed, because
`recordAdminNotification` is called from exactly nine places, all of them
inside `src/lib/email.ts`. An event whose email function is not one of those
nine reaches the feed never.

Diagnosis first, by reading rather than guessing, one bullet of the PDF at a
time:

| The PDF asks for | Before |
|---|---|
| Cleaners told when a job is posted | already works, `job-posted-notify.ts` |
| Admin told when a cleaner claims a job | **missing** |
| Admin told on clock in / clock out | already works |
| Admin told on photos, checklist, issue | already works |
| Admin told when clock in / out FAILS | alert only, not the feed |
| Badges update properly | **broken, and the likely real complaint** |
| Notification failures logged | `console.error` only |

**The claim was invisible.** `admin.unassigned.grabbed` existed but fired only
from `saveJob`, which is an ADMIN assigning somebody from the job form. A
cleaner taking a job off the board, which is the case the PDF names, told
nobody: `claimJob.ts` sent no notification of any kind. It does now, reusing
the same key and template the office already recognises.

**The badge could not reach zero, which explains "I only see notifications
when a job is modified or cancelled" better than any missing event does.** The
count was arithmetic: every notification, minus every read row this admin has.
The feed page lists the newest **50**. Read 50 of 200 and the badge sits at
150, with nothing on screen left to clear, climbing every time a cleaner clocks
in. An admin looking at a permanently red badge with a feed that looks handled
would reasonably conclude notifications are broken. Two changes: the count is
now a question about this person's read rows
(`reads: { none: { userId } }`), and a new `markAllAdminNotificationsRead`
clears what the page never listed, in bounded batches.

**A failed clock-out now reaches the feed.** It raised an Alert, which lands on
`/admin/analytics`, a page nobody watches during a shift. A cleaner stuck on
site is the most time-critical thing this app can report, so it belongs where
the sidebar counts it, at ERROR. A thrown clock-IN is reported the same way.
Clock-in **refusals** deliberately are not: "too early", "not assigned" and
"already clocked in" are the rules working, and announcing them would train the
office to ignore the feed.

**A lost notification now leaves a row in `/admin/logs`**, naming the event and
the reason, instead of a console line on a server nobody reads. That is the
PDF's last bullet, and it is what makes the next report of this answerable.

**Still config, not code:** `src/app/api/cron/notifications/route.ts` needs
`CRON_SECRET` before the time-window notices (12h unassigned, "not clocked in",
48h reminders) can fire at all. Batched with the rest of the Vercel
configuration. Nothing above depends on it.

No migration. Verified: 58/58 in `scripts/verify-sept10-fixes.ts`, including
that a refusal does NOT notify, that the subtraction is gone, and that the feed
page clears all of it rather than the visible 50.

### [x] 5. Old cleaner pay lines staying after a cleaner is removed

Area: admin jobs, financials, assignment, payroll.

**Done 2026-09-22.** The row does survive, and on purpose.

When a cleaner drops or is taken off a job, `cancelShift` disconnects them from
`Job.cleaners` and sets their `JobAssignment` row to CANCELLED.
`syncJobAssignments` then deletes every removed cleaner's row *except* the
cancelled ones, which it keeps deliberately as history. Its own comment says so:
"preserving CANCELLED rows as history".

Nothing was wrong with keeping that history. What was wrong is that the money
path could not see it was history: `JOB_PAY_SELECT` never selected `status`, so
`jobParticipantIds` read every row it found and the departed cleaner stayed a
payable head forever. Two symptoms, one cause:

| Complaint | What the ghost did |
|---|---|
| Item 5 | kept a pay line in the job's Financials tab |
| Item 3 | divided a manual team total by a crew of two, so $180 paid $90 |

The change, all in the read path:

- `JOB_PAY_SELECT` now selects `status`, plus the two pay surfaces that carry
  their own select (`getPayBreakdown`, the employee profile).
- New `liveAssignments(job)` in `cleaner-earnings.ts` is the single definition
  of "this row still means the cleaner is on the job".
- `jobParticipantIds` counts only live rows. `Job.cleaners` is still the live
  crew, so anyone genuinely on the job is counted through that relation
  whatever their row says.
- The per-cleaner override lookup reads the same live set. This mattered more
  than the head count: an override is paid off the top *before* the remainder
  is split, so a departed cleaner's stored amount was being taken out of the
  crew's money and handed to nobody.
- A row with no status at all still counts as live, so nothing about older
  jobs moves.

**No migration and no backfill.** The fix is at read time, so every job that is
already wrong is right the next time it is opened.

Two places were already safe and stayed untouched, because they build their
crew from `Job.cleaners` rather than from the rows: the creation form's stored
pay check, and the per-cleaner pay cap in `setCleanerJobPay`. The first one's
comment had already spotted this hazard, which is the clearest sign it was
worth fixing at the source.

Verified: `npx tsx scripts/verify-sept10-fixes.ts`, 28/28 (17 for item 2, 11
for items 3 and 5). Neutering `liveAssignments` to its old behaviour fails
exactly 6 of them, the first being "$180 for one cleaner pays that cleaner
$180", which is the client's sentence. Full sweep: the same 16 of 53 suites
fail as before the change. tsc and build clean.

### [x] 6. Timezone logic for job scheduling

Area: admin jobs, calendar, scheduling, timezone.
Client evidence: admin in Calgary sees Montreal times shifted by two hours.

Closed 2026-09-22 in three passes: the reported bug, then the tenant clock
everywhere a tenant can name itself, then the tenant clock on an ordinary
browser request. All three are written up below, in the order they were done.

#### Part 1, the reported bug: fixed 2026-09-22

"Admin is in Calgary at 1:15 PM, Montreal is 3:15 PM, but the software acts
like it is 1:15 PM in Montreal." That is the **device** clock leaking in, and
it had one main source.

The shared date picker (`src/components/ui/DatePicker.tsx`) had already been
moved onto the business clock in an earlier round. The **job form carries its
own private second copy** of that component, `CustomDatePicker` inside
`JobModal.tsx`, and it never was. Three lines in it read the laptop:

| | Was | Now |
|---|---|---|
| "Today" in the calendar grid | `new Date()` | `tzToday()` |
| The **Now** button | `new Date().toTimeString()` | `storeTimeKey(new Date())` |
| Month an empty picker opens on | `new Date()` | `tzToday()` |

The Now button is the client's sentence exactly: pressed in Calgary at 1:15 PM,
it wrote 1:15 PM onto a Montreal job. On the wrong side of midnight the "Today"
line is worse than two and a half hours out, it is a whole day.

Four smaller defaults in the same class were fixed while there, each one line:
the reports spend-import date, the bookkeeping entry date, the promo-code
expiry minimum, and the logs date-range view. Those three read **UTC** rather
than the device, which is wrong every evening after 8 PM in Montreal.

Audited and found already correct, so deliberately untouched: the calendar
views (they go through `tzNow` / `tzToday`), the cleaner schedule and job
lists (server-side, instant-based), clock-in and clock-out windows and late
warnings (pure instant arithmetic, which no timezone can move), reminders (the
cron reads `STORE_TZ` helpers), and the shared date picker.

Verified by behaviour, not only by source: `storeDateKey` and `storeTimeKey`
are asserted against a known instant on both daylight and standard time, so the
off-by-one-day case is a test rather than a claim.

#### Part 2, the multi-tenant half: NOT started, and here is the size

`STORE_TZ` is one value for the whole deployment:

```ts
export const STORE_TZ =
  process.env.NEXT_PUBLIC_BUSINESS_TIMEZONE ?? "America/Montreal";
```

`Organization.timezone` already exists in the schema, defaulting to
`America/Toronto`, and **nothing reads it**. So today every tenant is shown
Montreal's clock, and CleanoCalgary is two hours wrong on every screen. The
PDF's "job times should use the business/job location timezone" is not
satisfied for a second tenant, and cannot be until this is done.

Why it is not a quick change: `storeParts()` and its dependants are
synchronous, client-safe, and called from hundreds of places, with the
`Intl.DateTimeFormat` built once at module load. Making the zone per-tenant
means one of:

- threading a zone argument through every call site, which is enormous and
  easy to get half-right, or
- a request-scoped zone on the server plus a value provided once on the client,
  leaving every call site's signature alone. This is the right shape.

Either way the formatter cache has to become per-zone, the client needs the
zone injected at layout time (the org is already resolved from the host), and
every one of the surfaces audited above has to be re-checked against a tenant
that is NOT in Montreal.

#### Part 2, done 2026-09-22 for everything that can announce its tenant

`Organization.timezone` existed, `OrgContext` carried it, and nothing read it.
Now the whole of `timezone.ts` reads it.

- `storeTz()` resolves the current tenant's zone, falling back to the
  deployment default when no organization has been announced.
- The single module-level `Intl.DateTimeFormat`, built once for the only zone
  there used to be, became a small per-zone cache. Building one is expensive
  and this runs on every date the app prints.
- `org-context.ts` registers the resolver at module load. **Registered rather
  than imported**, because `timezone.ts` is client-safe and the context is
  built on `node:async_hooks`, which a browser cannot load. There is no cycle
  and no client-bundle change.

**What this covers.** Everything that announces its organization with
`runAsOrg`: cron jobs, the Twilio and Resend webhooks, and operational
scripts. Every date those produce — the times inside a reminder email, an SMS,
a generated invoice — now comes out in that tenant's own clock. CleanoCalgary
was getting Montreal's.

**What it does NOT cover, and why.** An ordinary browser request. A request
resolves its organization **asynchronously**, from the host and then a database
read, while every one of these helpers is **synchronous** and called from
hundreds of places including client components. There is nothing for them to
read at the moment they run. Closing that needs either a per-request wrapper
that can establish the context before rendering, or the zone injected into the
client from the layout — and doing only the second would be worse than today,
because the browser would then print Calgary's clock while the server-rendered
half of the same screen printed Montreal's.

So at the end of that pass a CleanoCalgary admin still saw Montreal times on
screen. That is what the third pass closes.

#### Part 2, second pass: the browser request, done 2026-09-22

The blocker was stated above: a request resolves its organization
asynchronously while every timezone helper is synchronous. The way past it is
that **the lookup has already happened.** `getCurrentOrg()` is wrapped in
React's per-request cache and is called by the root layout on every gated
request, and again by `requireOrgId()` before any query runs. Nothing in this
app formats a date it has not first fetched. So no new lookup was added: the
zone is remembered the moment the host becomes an organization, and the
synchronous helpers read what is already known.

| Piece | Where | What it does |
|---|---|---|
| The holder | `src/lib/store-tz.server.ts` | One mutable box per request, from React's `cache()`. |
| The write | `getCurrentOrg()` in `src/lib/org.ts` | `rememberRequestTz(org?.timezone)`, as a side effect of the one place a host becomes an organization. |
| The read | `storeTz()` in `src/lib/timezone.ts` | Asks the announcement first, then the request, then the browser. |
| The browser | `src/app/layout.tsx` | Stamps `window.__cleanoTz` in `<head>`, at parse time. |

Three decisions inside that are worth keeping:

- **A per-request holder, not a module variable.** A module variable is shared
  by every request the server is handling at that moment, so two tenants
  loading a page at the same second would take each other's clock. It would
  happen under load and intermittently, which is the worst way for a bug of
  this kind to show up. There is a test for exactly this.
- **Not AsyncLocalStorage**, which the announcement path uses. A layout cannot
  wrap its children in a call frame: Next hands the layout the page as an
  already-built element and React renders it after the layout returns. There is
  no frame to attach to.
- **The browser half ships with the server half, not after it.** On its own it
  would have been worse than the bug: the interactive half of a page would
  print one clock while the server-rendered half printed the other, and
  hydration would flip one of them in front of the user.

Two smaller things were fixed in the same pass because they would have silently
undone it:

- **Frozen defaults.** Fifteen files read the deployment default directly, five
  of them as `const TZ = STORE_TZ` at module scope — captured once, before any
  request, and therefore the same value for every tenant on the deployment.
  `email.ts`, `sms.ts`, `availability.ts`, `time.ts` and `pay-period.ts` were
  the worst of them, because those are the files that write the times a
  customer reads. All fifteen now call `storeTz()` at the point of use. There
  is a test that asserts none of them regresses.
- **An unusable zone.** `Organization.timezone` is an editable text column, and
  every date on a page is formatted through an `Intl.DateTimeFormat` built from
  it. One bad save would have thrown on every date rather than printing the
  wrong hour, so a zone Intl does not recognise now falls back to the
  deployment default. The value is also filtered before it is written into the
  page's `<script>`.

**The UI half of the PDF's request** ("UI should make timezone clear where
needed, especially for admin scheduling and cleaner job views") is now two
labels, both from `storeTzLabel()`, which reads "Eastern Time" / "Mountain
Time" with the season stripped so it does not change under people twice a year:

- the job form's time picker, under the **Now** button, since Now is the
  control that raised the question in the first place;
- the cleaner job page, under the start time.

**Verified:** `scripts/verify-tenant-timezone.ts` 22/22 and
`scripts/verify-sept10-fixes.ts` 169/169, plus `tsc` and `next build` clean.
The first runs the real helpers inside real organization contexts and checks
the failures that would matter most: a loop over tenants leaking the previous
one, two tenants in flight at the same time, a near-midnight instant where a
wrong zone changes the DAY rather than the hour, a remembered zone failing
closed outside a request, and an unusable zone falling back instead of
throwing. The second pins the wiring, which no behavioural test can see.

**One limit, stated rather than left to be discovered.** The request half
depends on the organization having been resolved before a date is formatted.
Everything that reads data has been through `getCurrentOrg()`, so that holds
across the app; a page that formats a date without touching the database at all
would fall back to the deployment default. That is today's behaviour, not a
regression, and there is no such page today.

---

## P1, the nine that are quality of life

### [x] 7. Admin and customer "before" photos for job scope
**Admin half done 2026-09-22. No migration, contrary to the first pass.**

The first pass was wrong about the schema. `JobPhotoKind.BEFORE` already
exists, and `uploadJobPhoto` already admits an admin and already accepts a
kind. The only thing missing was a way for an admin to reach it.

Added: an "Add areas to clean" control on the job's Photos tab. Files are
stored as `BEFORE`, so they land in the cleaner's own gallery under the same
Before heading every other surface uses, which is the point: the cleaner sees
them before they start, apart from their own proof photos. Uploads run one at
a time, because firing five whole images at once is how a phone on site times
out.

Access is unchanged and already correct: `uploadJobPhoto` accepts an admin, the
job's lead, or an assigned cleaner, and nobody else.

**Customer half, done 2026-09-22, and it was one line.** The booking flow
already collects photos and already attaches them to the job it creates. They
were simply stored with no kind, so they landed in the GENERAL pile beside the
cleaner's proof photos instead of in front of the cleaner before they start.
They are now `BEFORE`, like the admin's, which is the whole point of the item.

Deliberately NOT copied onto the other occurrences of a recurring booking: they
describe the state of the property on the day it was booked, and a photo of a
dirty oven from March is misleading in June. The admin can add scope photos to
any occurrence.

### [x] 8. Discount override for recurring jobs
**Done 2026-09-22. Needs the migration below to be applied before deploy.**

The configured table discounts by frequency and service category with no way to
say "not this one", which is the client's own example: a weekly commercial
contract already has the discount in its agreed rate, so the table applies it a
second time.

The job form now offers three choices on any recurring job: **use the
configured discount**, **no discount**, or **custom**, with a percentage box.
One pure function, `resolveRecurringDiscountPercent`, is the only place those
three are interpreted, so the form's preview and the series generator cannot
disagree about what the customer pays. A custom percentage is clamped to 0-100,
because a negative discount is a surcharge by another name and this is not the
field for it.

Both columns are stored on the job and added to `SERIES_PROPAGATED_FIELDS`: a
series is one agreement, so occurrence 4 cannot be discounted on different terms
from occurrence 1, which is the same reason `price` and `billingType` already
propagate.

**Nothing changes for existing jobs.** A missing or unknown mode means AUTO,
which is exactly what every row created before today did, so the migration needs
no backfill.

### [x] 9. Expandable cleaner job breakdown in payroll
**Done 2026-09-22.** Each payout row now expands into the jobs behind it: job
number and client, date, service, that cleaner's own hours, the work, the tip,
the parking, the total, and the rule that produced the pay ("Manual, team
total, split evenly", "Hourly, from the clock", a tier percentage). Each line
links straight to the job.

The figures are **recomputed, not stored**. `Payout` keeps only totals, and
adding four columns per job would be a second copy of numbers that already have
one source. Instead the breakdown shares the generator's own two pieces: the
date window, which was extracted as `payPeriodJobsWhere` so there is one
definition rather than two, and `computeJobPayShares`, which is the same money
function payroll ran. So the expanded lines add up to the Base figure above
them by construction.

Loaded on expand rather than with the page: a period holds a dozen payouts and
each recomputes every job in the window. Nobody expands twelve at once.

**Access:** owner/admin only, and the cleaner whose jobs are listed is read
from the payout row, never from anything the caller sends. This is a whole
team's earnings.

Adjustments, deductions and reimbursements stay off the job lines and are
labelled as such: they are entered on the payout, not earned on a job.

### [x] 10. Shift drop email notifications
**Audited 2026-09-22; already built, every bullet.** One email on every drop, a
second urgent one when the drop lands inside 24 hours of the start, the cleaner
disconnected so the job returns to the board, a row in the notification feed,
and `EmailLog` recording SENT or FAILED with the provider's error. Nothing to
change. Now covered by tests, which is what was actually missing.

### [x] 11. Link customer reviews to cleaner star ratings
**Done 2026-09-22.** The client's premise was half right. Customer stars DO
already reach cleaner profiles, averages and pay tiers, through
`EmployeeRating` and `getCleanerRateInputs`. What was broken is who they reach.

There are two ways a customer can rate a job, and they disagreed:

| Path | Rated |
|---|---|
| The emailed rating link | every cleaner on the job |
| The customer portal | **the lead, and nobody else** |

So on a three-person job rated from the portal, two cleaners' work vanished.
Worse: `employeeId` is the lead field, and on older rows it can still hold the
acting admin, the same root cause as items 3 and 5, so a customer's stars could
be filed against an administrator and feed their pay tier.

One shared rule now, `ratedCleanerIds` in `src/lib/rating-crew.ts`, used by both
paths: the token's named cleaner if it has one, otherwise the whole crew, plus
the lead when the lead is not already among them and is not an ADMIN/OWNER.
Pure, so the rule is tested directly rather than described.

The two constraints that carried over are both satisfied without changes: the
exclusion flag is respected, because every average reads `excludedAt: null`;
and the pay tier moves with the average automatically, because
`getCleanerRateInputs` computes the multiplier live rather than storing it.

Admin visibility was already there: the employee profile lists the ten most
recent ratings with the client's name and the note attached.

The same question blocked item 11 of the first list. That one unblocks too.

### [x] 12. Sidebar notification badges clickable and traceable
**Done 2026-09-22.** The Jobs pill counts unread job chat and the row opened
the full list, leaving the admin to guess which of hundreds of rows the "1"
meant. The row still opens all jobs, because that is what clicking Jobs should
do; the **pill** now opens `/admin/jobs?attention=chat`, which is exactly the
rows it counted.

The pill is a `span` with `role="link"` and a keyboard handler, not a nested
anchor: an `<a>` inside an `<a>` is invalid and browsers silently un-nest it.

**Security note on the new parameter.** `?attention=chat` resolves its id list
through `getJobChatUnread("admin")`, which re-derives the caller's role from
the session and returns nothing to a non-admin. The page's existing `baseWhere`
still pins a non-admin to their own jobs. So the parameter can only ever
narrow what someone sees, never widen it.

Each feed row also now carries the reason it exists ("Clock", "Shift",
"Billing"), derived from the notification key rather than stored a second time
and left to drift.

### [x] 13. Mark notifications as read
**Mostly done 2026-09-22.** The page used to mark everything read the moment it
mounted, which is why nothing ever felt unread: by the time you had read the
first line the app had decided you had read all fifty. Reading is now something
you do.

- An **Unread** tab, which is what the page opens on, plus **All** for history.
- **Mark all as read**, which clears the badge including the rows the page
  never listed (see item 4 for why that mattered).
- **Mark as read** on each unread row.
- Opening a notification marks that one and navigates. The navigation happens
  even if the write fails, so a failure cannot strand the admin.
- Read rows are dimmed with a grey dot; unread keep their severity colour.
- Every change is optimistic, so the row and the sidebar badge stop arguing.

**Archive, added 2026-09-22.** Needs the migration below applied before
deploy. Each row has **Archive**, and an **Archived** view with **Put back**.
Nothing is deleted: the row is kept and stamped, which is what the PDF asks for
("read notifications should remain available in notification history unless
deleted or archived"). It is per person by construction, because the read table
is keyed on (notification, user), so one admin clearing their own feed leaves
everyone else's alone.

One thing worth recording because it was nearly wrong: archiving WRITES a read
row, so "unread" is still simply "no read row for this person". An earlier draft
of the count asked for rows with no *undismissed* read row, which would have
brought every archived notification back as unread the moment it was archived.
The tests now pin the correct version.

### [x] 14. Preserve page position when returning from a detail page
**Done 2026-09-22, and the cause was smaller than expected.** The lists already
keep page, search, filters and sort in the query string. Nothing was losing
that state. The **back links** simply refused to use it: every detail page
pointed at the bare list URL, so "Back to Employees" meant page 1 by
definition.

`BackToList` (`src/components/common/BackToList.tsx`) goes back through
history, which restores the previous URL and, because the browser does it, the
scroll position too. Applied to Employees, Clients, Inventory and Jobs.

Three details that make it safe rather than clever:

- It stays a real `<a>` with a real `href`, so middle-click and
  open-in-new-tab work and the link means something before hydration.
- When there is no in-app history — a bookmark, a pasted URL, a link opened in
  a new tab — it behaves as an ordinary link to the list, which is the only
  sensible destination.
- The calendar's existing explicit `returnTo` on a job still wins, so "Back to
  Calendar" is unchanged.

Not done: the PDF's optional "clear reset option". The filter controls on each
list already clear individually, and a second reset affordance is a design
decision rather than a defect. Say if you want one.

### [x] 15. Show the client phone number only after the cleaner accepts
**Audited 2026-09-22, and the rule the PDF asks for is already the rule the
code enforces.** No change was needed. What was needed was tests, because a
regression here leaks a customer's mobile number and would do it silently.

| The PDF asks | What the code does |
|---|---|
| No phone before accepting | `getAvailableJobPreview` never selects `client.phone`, and its types file records why |
| Phone once assigned | the job page shows it, still behind the admin's own `provider.showCustomerPhone` setting |
| Never on the public preview card | same as the first row: the field is not fetched, so it cannot leak |
| Admin always sees it | unchanged |
| Lose access when unassigned | the job page re-checks `isEmployee \|\| isCleaner` on every load and redirects, so access ends the moment the assignment does |

One more surface was checked because it is the only other cleaner-side code
that touches a client phone: `onMyWay.ts` reads it to send the customer an SMS.
It verifies assignment **before** reading, and never returns the number to the
caller. Both properties are now asserted.

The header comment in `phone-masking.ts` that prompted the concern describes
the problem masking was built to solve, not current behaviour.

---

## The migration, applied to production 2026-09-22

`prisma/migrations/20260922120000_recurring_discount_override_and_notification_dismiss/`

Three columns, all nullable, no defaults and no backfill:

| Table | Column | Item |
|---|---|---|
| `Job` | `recurringDiscountMode TEXT` | 8 |
| `Job` | `recurringDiscountPercentOverride DOUBLE PRECISION` | 8 |
| `NotificationRead` | `dismissedAt TIMESTAMP(3)` | 13 |

NULL means AUTO and "not archived" respectively, which is what every existing
row already does, so no row changes behaviour. Nothing is rewritten, so it is
safe against a live database, and it reverses by dropping the three columns.

It was applied BEFORE the code was deployed, per the standing rule, or the two features above
will fault at runtime. Item 7 needed no migration after all: `JobPhotoKind`
already had `BEFORE`.

## Sequencing

The six P0 items are production defects on real money and real shifts, so they
come before any mobile app work. Items 2, 3 and 5 are the ones a cleaner or an
admin hits this week.

Suggested order, which is not the PDF's order, because it puts the located bugs
first and the audit last:

1. Item 2, located, single filter, wide benefit. **Done 2026-09-22.**
2. Item 3, unblocked by D2, now a head-count fix. **Done 2026-09-22**, and it
   was item 5.
3. Item 5, confirm on staging, then small. **Done 2026-09-22** with item 3.
4. Item 1, find the duplicate path, then clear both mirrors. **Done
   2026-09-22**, and the duplicate path was already correct.
5. Item 4, diagnose before coding. **Done 2026-09-22**; it was code, plus
   one config item left for the Vercel batch.
6. Item 6, the audit. **Done 2026-09-22**, in three passes: the reported
   device-clock bug, the tenant clock for anything that announces itself, and
   the tenant clock on an ordinary browser request.

**All 15 items are done as of 2026-09-22.** The migration above is applied to
production. The only thing this list still leaves outside the code is
`CRON_SECRET` in the Vercel batch, which item 4 needs before the time-window
notices (12-hour unassigned, nobody clocked in, 48-hour customer reminder) will
fire at all.
