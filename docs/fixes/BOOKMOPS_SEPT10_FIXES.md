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

### [ ] 1. Clear clock-in data when a job is duplicated or rescheduled

Area: admin jobs, duplicate, reschedule, time tracking.

First pass: no `duplicateJob` action exists under `src/app/admin/actions/`, so
the duplicate button is doing its copy somewhere else and needs to be found
before anything is judged. The fields that must not travel are the clock pair
(`clockInTime`, `clockOutTime`), the open `WorkSession` rows, checklist
completion, product usage and completion photos. Note that clock state is
mirrored: `syncClockMirrors` in `src/lib/work-sessions.server.ts` keeps the job
columns and the session rows agreeing, so clearing one without the other leaves
the job looking clocked in from one surface and clear from another.

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

### [ ] 4. Notification system for cleaner and admin job events

Area: notifications, both sides, clock in and out.

First pass: the catalog is not missing. `admin.clock.clocked_in`,
`admin.clock.clocked_out`, `admin.clock.late_arrival`,
`admin.clock.not_clocked_in`, `admin.checklist.completed`, `admin.chat.*` and
roughly forty more keys are all emitted today. So the client seeing only
"modified or cancelled" is a **delivery or display** problem, not a missing
event. Three candidates, in the order they should be tested: the admin's own
per-key notification settings, the badge query, and the cron in
`src/app/api/cron/notifications/route.ts`, which needs `CRON_SECRET` set. That
last one is a known open config item and could account for the whole report.
Diagnose before writing code.

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

### [ ] 6. Timezone logic for job scheduling

Area: admin jobs, calendar, scheduling, timezone.
Client evidence: admin in Calgary sees Montreal times shifted by two hours.

First pass: the primitives exist (`src/lib/timezone.ts`, `tz-calendar.ts`,
`startOfDayTz`). This is not a missing concept, it is surfaces that still use
the device timezone instead of the business one. The work is an audit: every
place that formats or parses a job time, checked one at a time. It is also the
item with the widest blast radius, because it touches the calendar, the job
form, reminders, clock windows and late warnings. Directly relevant to the
multi-tenant work, since Montreal and Calgary are two tenants in two zones.

---

## P1, the nine that are quality of life

### [ ] 7. Admin and customer "before" photos for job scope
No `beforePhoto` concept exists in the schema. This is a new photo kind, kept
separate from cleaner proof photos, that flows from booking into the job and
appears in the cleaner's view before they start. Needs a migration.

### [ ] 8. Discount override for recurring jobs
`recurringDiscountPercent` in `src/lib/booking-pricing.ts` applies by frequency
and service type with no per-job escape. Needs a three-way setting (apply, none,
custom) stored on the recurring series so generated jobs inherit it. Needs a
migration.

### [ ] 9. Expandable cleaner job breakdown in payroll
The payout pages exist (`src/app/admin/payouts/`). This is presentation: per
cleaner, list each job with its own pay basis so the total can be checked
without opening every job. `getPayBreakdown` already returns most of this.

### [ ] 10. Shift drop email notifications
`cancelShift.ts` exists. Needs the normal email on every drop, a second urgent
email inside 24 hours of start, the job returned to available, and a send log.

### [ ] 11. Link customer reviews to cleaner star ratings
No longer blocked. The rule, confirmed 2026-09-22, is that the customer's
rating applies to **every** cleaner assigned to that job, with no per-cleaner
adjustment. That was the open question on item 11 of the first list too, so
that item unblocks with this one.
Two constraints carry over: the rating exclusion flag from `AWER_NEW_FIXES.md`
item 5 must be respected, so an excluded rating still drops out of every
average; and where cleaner pay is rating-based, the tier recalculation has to
run when an average moves.

### [ ] 12. Sidebar notification badges clickable and traceable
The badge counts but does not navigate. Needs the click to land on the filtered
list and the causing job to be highlighted.

### [ ] 13. Mark notifications as read
Mostly built. `Notification` and `NotificationRead` exist, read state is
per-person, and `markNotificationsRead` is wired. What is missing is the
deliberate controls: mark one, mark all, dismiss, and a visible difference
between read and unread. Today `NotificationsClient.tsx` marks everything read
on mount, which is why nothing ever feels unread.

### [ ] 14. Preserve page position when returning from a detail page
Page, search, filters, sort, tab and scroll. Worth doing once as a shared hook
and applying it to every paginated admin table rather than per page.

### [ ] 15. Show the client phone number only after the cleaner accepts
`src/lib/phone-masking.ts` already says this in its own header comment: "a
cleaner who has ever been assigned a job keeps that customer's real number".
So the masking layer exists and the gate is what is missing. Reveal on
assignment, revoke on unassignment, never on the public preview card, always
visible to admin.

---

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
4. Item 1, find the duplicate path, then clear both mirrors.
5. Item 4, diagnose before coding. May be config, not code.
6. Item 6, the audit. Largest of the six, do it with room.

Then P1 in this order: 13 and 12 together (same surface, 13 is nearly done),
then 15, 14, 11, 10, 9, 8, 7. Item 11 moved up now that its rule is settled.

Rough shape, one person: **P0 about a week, P1 about a week and a half.**
Items 7 and 8 need migrations, which per the standing rule are written and
applied deliberately before any push, never as part of a deploy.
