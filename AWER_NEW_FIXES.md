# Awer Platform — New Fixes (second list)

Source: `AwerNewFixes.pdf` — 5 items. Started and completed 2026-07-28.
The earlier 29-item list lives in [`AWER_FIXES.md`](AWER_FIXES.md); this is a
separate document and does not supersede it.

**Legend:** `[ ]` not started · `[~]` in progress · `[x]` done + verified

Verification: `npx tsx scripts/verify-awer-new-fixes.ts` (94 checks).

---

## Decisions taken

Two questions the PDF doesn't answer were settled before building:

1. **An unanswered assignment invite no longer releases the cleaner.** The spec
   says nothing may auto-unassign, so invite expiry became a flag plus an admin
   alert ("Assignment unconfirmed"), not a removal. Last-minute *broadcast*
   invites still expire hard — those are a race for an open job.
2. **Clock-time edits never rewrite a locked payout.** An edit inside a
   PENDING_APPROVAL / APPROVED / PAID pay period is applied and logged, and the
   admin is told the recorded payout was left alone so they can adjust it
   deliberately on the pay period.

---

## [x] 1 — Exclude archived jobs from active reporting (P0)

"Archived" is `Job.deletedAt != null`. Dashboard, analytics, revenue
(`getTotalRevenue`), pay-period generation, cleaner schedules and the calendar
already filtered correctly. The leaks that were left:

| Where | Was |
|---|---|
| `getLabourCostMetric.ts` | labour-cost % counted archived jobs |
| `exportJobs.ts` | CSV/PDF export included the archive |
| `employees/[id]/page.tsx` | per-cleaner stats, history, product usage, upcoming count |
| `bulk-charge`, `requests` (+ sidebar badge), `wash-payouts`, `web-bookings`, `finances` picker | archived jobs listed / chargeable |
| `getDayAvailability`, `getUnavailableSlots` | archived jobs still blocked booking slots |
| customer portal bookings, monthly statement cron, weekly cron (×3 reads) | archived jobs in customer-facing history and digests |

Archived data stays reachable **only when explicitly selected**: `exportJobs`
takes `includeArchived`, and the Jobs page wires it to the Active/Archived
toggle, so each view exports exactly what it shows.

## [x] 2 — Jobs unassigning cleaners (P0)

Three mechanisms, two of them defects:

1. **The invite-expiry cron sweep** (`api/cron/notifications`). Every
   assignment created a `JobAssignmentInvite` with a ~10-minute expiry; if the
   cleaner didn't tap accept, the sweep `disconnect`ed them from the job and
   deleted their `JobAssignment` row. Admin assigns → cleaner is on the job →
   ten minutes later they're gone. **This is the bug the client saw.** The
   sweep now marks the invite EXPIRED, leaves the cleaner assigned, logs it on
   the job, and alerts admins.
2. **`saveJob`'s blanket overwrite.** `cleaners: cleanerIds.length > 0 ? {set:…}
   : {set: []}` meant *any* submission without the `cleaners` field wiped the
   team — an "absent field means delete everyone" contract. Forms that own the
   picker now post a `cleanersSubmitted` marker; without it the team, the lead
   (`employeeId`), the `JobAssignment` rows and the series propagation are all
   left untouched. With it, an empty list is still a real "clear the team".
3. **Cleaner-initiated** decline / shift-cancel — by design, unchanged.

Mark-paid, invoice-sent, complete and calendar date-drag were checked and never
touched the assignment. A failed assignment sync was already surfaced as an
error rather than silently reverting, which is the spec's last bullet.

Side effect handled: a cleaner who answers a direct invite late is no longer
told "invite expired" — they're still on the job, so the answer is accepted and
the panel keeps showing it.

## [x] 3 — No payment-type choice on cleaner withdrawals (P1)

The cleaner submits an amount (and optional note); `Withdrawal.paymentMethod`
is written `null` and chosen by an admin at processing time.

The four states the spec names already existed as the stored enum and are now
labelled for humans: PENDING → **Requested**, APPROVED → **Approved**,
COMPLETED → **Paid**, REJECTED → **Rejected**.

Gap found and filled: `processWithdrawal` existed but **nothing rendered it** —
there was no admin withdrawals UI at all. Added `WithdrawalsPanel` on
Admin → Payouts (approve / mark paid / reject, with the payment-method picker),
built from the existing table/stat/button styles.

## [x] 4 — Admin can edit clock-in / clock-out times (P1)

New `updateClockTimes` action (admin-only). Writes the per-cleaner
`JobAssignment` row, or the legacy job-level `Job.clockInTime/clockOutTime` when
no cleaner is named. Assignment status follows the timestamps, so the Team card
can't contradict the times printed next to it.

Validation lives in `src/lib/clock-edit.ts` (pure, unit-tested): clock-out must
follow clock-in, a clock-out with no clock-in is rejected, >24h is rejected as a
typo'd date, and clearing both is allowed — that's how a mistaken clock-in is
undone.

Reachable from the job page (per cleaner, plus a job-level row) and from
Admin → Time tracking. Every edit writes a JobLog entry with the original value,
the new value, the admin's name and the timestamp.

Edited times flow into total time worked, payroll review and job financials
through the existing `resolveClockEntry` / `cleaner-earnings` path. Payouts
already generated are **not** rewritten — see decision 2 above.

## [x] 5 — Admin can remove a job star rating (P2)

`EmployeeRating` gains `excludedAt` / `excludedById` / `excludedReason`
(migration `20260728000000_rating_exclusion`). Soft exclusion: the row survives
so the record of what was rated and why it was pulled stays reviewable.

Thirteen independent read sites now filter `excludedAt: null` — pay tier
(`cleaner-rates`, which is the one that moves money), pay-multiplier recalc,
employee average and count, performance data, cleaner dashboard, analytics,
weekly digest, low-rating alerts, the customer-facing cleaner rating and the
public reviews page. Excluding also recalculates the cleaner's pay multiplier
immediately.

The job's Ratings card shows every rating as **Active** or **Excluded** (with
who excluded it, when and why), counts only active ones in its header, and
offers Exclude (with a reason: test job, cancelled job, incorrect rating,
complaint resolved, not about this cleaner, or free text) and Restore.

Deliberate: a customer who edits a rating that an admin excluded does not
un-exclude it — the admin's decision stands until an admin restores it.

---

## Review pass (2026-07-28, after the first implementation)

Re-reading my own diff turned up four defects, all fixed:

1. **`updateClockTimes` could make an unassigned cleaner payable.** The
   per-cleaner branch upserted a `JobAssignment` row, and `jobParticipantIds`
   (cleaner-earnings) treats an assignment row as proof of participation — so
   editing times for someone not on the job would have started paying them.
   Now rejected: "that cleaner isn't assigned to this job".
2. **Two rating aggregates were missed.** The overall score quoted in the admin
   new-review email (`(public)/rate/actions/submitRating.ts`) and the client
   detail page's ratings/average still counted excluded ratings.
3. **Stale invites could resurface.** Direct invites are now answerable after
   expiry — but invites expired by the OLD sweep had the cleaner detached at
   the same moment. Those would have reappeared in the cleaner's panel as
   something to accept for a job they're not on. The panel now requires the
   cleaner to still be assigned, and `respondToJobInvite` refuses a late answer
   once they're off the job. (The live database has exactly 3 such rows.)
4. **More item-1 leaks found by an exhaustive sweep**, not by memory: all nine
   job reads in the notification cron, the daily reminder cron, the customer
   portal home, `chargeJob`'s claim, `cancelRecurringService`, and the
   labour-report service-type filter list. Archived bookings were still able to
   email customers and raise admin alerts.

The verification script now includes a **completeness guard** that walks every
`db.job.findMany/count/aggregate/groupBy` in `src/` and fails on any that lacks
an archive filter, with a documented allowlist for the reads that use a shared
filtered helper, target an explicit id, or intentionally span the archive.

---

## Verified

- `npx tsx scripts/verify-awer-new-fixes.ts` → **85/85 pass**
- `npx tsc --noEmit` → clean
- `npm run build` → compiles
- `npm run lint` → 321 problems, **identical to the pre-change baseline** (all
  pre-existing; the new files are lint-clean)
- **Read-only probes against the live database**: all 11 changed query shapes
  execute — except the three rating reads, see the blocker below. Confirmed 3
  real cases of the item-2 auto-unassign having fired (direct invite EXPIRED,
  cleaner detached from the job).
- `prisma migrate diff` against the live schema emits **exactly** the three
  columns + index in the hand-written migration.

### Blocker — apply the migrations BEFORE deploying this code

Proven, not assumed. With the regenerated Prisma client against the current
database:

```
FAILS  employeeRating.findMany()              → column EmployeeRating.excludedAt does not exist
FAILS  employeeRating.findMany({excludedAt})  → column EmployeeRating.excludedAt does not exist
FAILS  cleaner-rates groupBy (PAY TIER)       → column EmployeeRating.excludedAt does not exist
```

The third one is the dangerous one: `getCleanerRateInputs` resolves cleaner pay
rates, so saving a job and generating payroll would throw. Run
`prisma migrate deploy` first, then deploy. `prisma migrate status` confirms the
history is otherwise in sync — exactly two migrations are pending
(`20260728000000_rating_exclusion`, `20260728010000_align_schema_drift`) and
nothing else will be touched.

---

## Follow-up (2026-07-28) — the missing archive, explained and stopped

The "7 active / 0 archived" reading was not a different environment. Read-only
probe of the live database:

```
jobs: total=7 active=7 archived=0
jobNumber range: 1501 … 1540      sequence last_value: 1540
→ 1533 job numbers missing from the table
ratings with a job = 0, ratings orphaned (jobId nulled by cascade) = 28
```

`jobNumber` is autoincrement, so missing numbers mean rows were **hard
deleted** — and all 28 ratings had their `jobId` nulled by the `SetNull`
cascade, the fingerprint of a real row deletion. The archive wasn't archived;
it was destroyed.

**Root cause: `deleteJob` called `db.job.delete()`.** Bulk delete has always
been a soft delete. `permanentlyDeleteJobs` documents and enforces a two-step
("archive first, then permanently delete"). The schema's own note on
`Job.deletedAt` says "recoverable via Archived view. Never hard-deleted". The
single-job delete on the job page and the jobs list bypassed all of it and
destroyed the row outright.

Fixed: `deleteJob` now sets `deletedAt`, writes a job-log entry, refuses a job
that's already archived, and leaves assignments intact so a restore brings the
team back. Both confirmation dialogs said "This action cannot be undone. All
job data will be permanently removed" — they now describe archiving. Permanent
removal still exists, deliberately, behind the archived-only gate in
`permanentlyDeleteJobs`.

The 1533 deleted rows are **not recoverable** from the application. If they
matter, a Supabase point-in-time restore is the only route.

## Follow-up — schema drift resolved

`prisma migrate diff` wanted to DROP a `User_fieldLeadId_idx` that exists on the
database, and DROP a default on `PropertyDefinition.updatedAt`. Both are objects
the database has and the schema never declared. Rather than drop live objects,
the schema now declares them, and migration `20260728010000_align_schema_drift`
recreates them idempotently so a database built from migrations alone matches.
`migrate diff` is now empty apart from the two pending migrations.
