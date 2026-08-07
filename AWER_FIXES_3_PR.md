# AWER round 3 — `awerfixes.pdf`, 20 items

Working tracker: [`_ai_context/TODO.md`](../_ai_context/TODO.md). Prior rounds:
[`AWER_FIXES.md`](AWER_FIXES.md) (29 items) and [`AWER_NEW_FIXES.md`](AWER_NEW_FIXES.md)
(5 items). Where this PDF conflicts with earlier behaviour, this PDF wins.

**This file is the PR description.** Paste it as the PR body, or link it from one.
The deploy order below is the part that must not be improvised.

---

## ⚠️ Deploy order — run these in this order

`prisma migrate deploy` runs **before** the code deploy. The AWER_NEW_FIXES round
taught us why: the code references columns the database doesn't have yet, and
deploying it first takes payroll down until the migration lands.

1. **`npx prisma migrate deploy`** — applies the seven pending migrations listed
   below. All seven are additive: new nullable columns, two new tables, one
   unique index, and one `NOT NULL DEFAULT` on a table with 6 rows. Nothing is
   dropped, nothing is rewritten, and every one of them is a no-op against a
   database that already has the object (`IF NOT EXISTS` / `duplicate_object`
   guards throughout). Deploying them ahead of the code changes no behaviour.

2. **Deploy the code.**

3. **`npx tsx scripts/cleanupImportNotes.ts`** — dry run first (fix 15). Read the
   before/after samples **and the "surviving segments" list** it prints; that
   list is the review that matters, because a residue there is either a genuine
   customer instruction (keep it) or a label the rule hasn't learned (add it).
   Then `npx tsx scripts/cleanupImportNotes.ts --commit`.
   This is a one-way write to `Job.notes` on ~205 live rows. Every original is
   preserved verbatim in an admin-only `NOTE_ADDED` job log first, and re-running
   is a no-op (processed rows carry the marker log and are skipped).

4. **`npx tsx scripts/backfillJobWorkSessions.ts`** — dry run, then `--commit`
   (fix 6). **Optional.** Jobs with no `JobWorkSession` rows read correctly
   through the legacy `clockInTime`/`clockOutTime` fallback, so skipping this
   changes no number; it only means historical jobs show one session instead of
   a session list. Idempotent — jobs that already have sessions are skipped.

5. **Spot-check live**, in this order (each one exercises a different fix):
   - A cleaner's My Pay figure against the job's pay modal — same number, and
     the modal now says *why* (fix 1).
   - Book a web job with an add-on at quantity 2; confirm the customer's total,
     the receipt and the invoice all agree (fixes 7 + 10).
   - Clock in, clock out, clock back in on one job; confirm hours are the SUM of
     the sessions and that the job only completes when the last cleaner leaves
     (fix 6).
   - Assign a cleaner outside their approved categories — expect a **warning,
     not a block** (fix 3).
   - Upload a void cheque as a cleaner, open it as an admin, confirm the raw
     Cloudinary URL 401s without a signature (fix 16).

**LAST, and separately deployed:** the `InventoryRule` table drop. SQL is
drafted under TODO item 20.e but is **deliberately not staged** in
`prisma/migrations/`. It is destructive and irreversible — take a Supabase
backup point first, and only run it once the 20.a–c code is live and
`npx tsx scripts/verify-awer-fixes-3.ts` is green (it proves mechanically that
nothing under `src/` still reads the table).

### The seven pending migrations, in apply order

| # | Migration | Stage | What it does |
|---|---|---|---|
| 1 | `20260806000000_job_addon_quantity` | 3 | `JobAddOn.quantity INT NOT NULL DEFAULT 1` |
| 2 | `20260806100000_client_address_details` | 4 | `ClientAddress` +city/postalCode/accessNotes, `Job.clientAddressId` (SET NULL) — **also captures the previously undeclared `ClientAddress` table**, which was created by `db push` and never made it into migration history |
| 3 | `20260807000000_job_checklist_unique` | 5 | `@@unique(JobChecklist.jobId, employeeId)` |
| 4 | `20260807010000_invite_unconfirmed_alert` | 5 | `JobAssignmentInvite.unconfirmedAlertAt` |
| 5 | `20260807020000_job_work_sessions` | 5 | new `JobWorkSession` table |
| 6 | `20260807030000_user_service_categories` | 6 | `User.allowedServiceCategories TEXT[] DEFAULT '{}'` |
| 7 | `20260808000000_employee_files` | 7 | new `EmployeeFile` table |

Verified against live on the day of writing: `npx prisma migrate status` reports
exactly these seven as pending and nothing else, and `prisma migrate diff` from
the live datasource to `schema.prisma` produces exactly their combined effect —
no drift, and no `InventoryRule` drop (that model is still declared on purpose).

### Rollback

Migrations 1, 3, 4, 6 are single-statement and reversible (`DROP COLUMN` /
`DROP INDEX`). Migrations 5 and 7 create empty tables and can be dropped while
empty. Migration 2's part 1 only backfills history for a table that already
exists live, so reverting it means dropping the three new columns and the FK,
not the table. The code deploy is a normal revert. `cleanupImportNotes --commit`
is **not** revertible by script — the originals are in the job logs, and
restoring them is a manual query.

---

## What's in it

Twenty items from the PDF, worked in seven stages. Full per-item detail and every
decision is in `_ai_context/TODO.md`; the client-facing version is in
[`CLIENT_SUMMARY.md`](CLIENT_SUMMARY.md).

**Money and pay**
- **1 — Pay multiplier now actually pays.** `rate = tier base × the cleaner's
  rating multiplier`, resolved live from Settings → Pay Rate Multipliers off the
  all-time rating average. The hardcoded 40→45% ladder is retired.
  **This moves real money — see the payout impact below.**
- **10 — Custom extra charges are billed.** One shared helper
  (`src/lib/job-money.ts`) owns the subtotal→tax computation, so the job, the
  receipt and the invoice can no longer disagree. An admin's $25 charge used to
  bill $0.
- **7 — Add-on quantities**, on `/book` and in the admin modal, priced and
  line-itemed everywhere.

**Booking and customers**
- **2 — Multiple saved addresses**, with unit number, postal code and access
  notes; full customer CRUD; picking one re-runs the coverage check.
- **9 / 15 / 17 — BookingKoala import**: add-ons become structured rows, billing
  text leaves cleaner- and customer-visible notes, add-on icons and pop-ups.
- **12 / 18 / 20 / 13** — referral rewards read from Settings, price column
  readability, "usually $10 less" copy removed, job details opens at the top.

**Cleaner workflow**
- **6 — Clock back into a job.** Work is rows now, not one clock pair, and keyed
  per cleaner: one teammate no longer blocks the crew from clocking in, and the
  first to leave no longer completes the job for everyone.
- **5 — Checklists generate when the cleaner opens the job**, no button.
- **8 — Job preview before claiming. 4 — the 10-minute pending hold is gone.**
- **3 — Service category permissions**: hard on the cleaner side, advisory on
  the admin side. **19** — cleaner availability shown while booking.

**Admin**
- **11 — Sidebar badges** for every attention queue, one batched request.
- **16 — Void cheque upload**, private by construction (Cloudinary
  `authenticated` + OWNER/ADMIN-gated signed URLs, every view logged).
- **14 — Inventory Rules settings removed**; the forecast is re-sourced from
  what cleaners actually reported.

---

## Payout impact — read before approving

Fix 1 changes how every percentage-paid cleaner's rate is computed. Measured
read-only against live data (`scripts/probe-pay-multiplier-delta.ts`):

- **Last pay period (Jul 27 – Aug 2, 19 jobs, 11 cleaners): $2047.53 → $2047.53,
  +$0.00.** None of that period's participants has reached the 5-rating gate, so
  their multiplier is 1.0 under both models.
- **Company-wide, exactly one cleaner is already past the gate today** — Asia
  Smellie (STANDARD, 5 ratings, 5.00 average): **45.00% → 50.00%**, i.e. a $100
  job pays $50.00 instead of $45.00 (+11.1%). She simply didn't work the last
  period, which is why the replay shows $0.00. **Her next percentage-paid job
  moves the day this deploys.**
- **Projected once the current crew qualifies: +$68.15 on that period, +3.3%.**
  Two more carry averages that would buy a premium (4.80 → 1.20×, 4.50 → 1.13×).
- **Structurally, the ceiling rises for every tier**: Standard 45% → 50%, Field
  Lead 46% → 57.5%, Trainee 30% → 37.5% at a 5.0★ average. That is what the
  +3.3% grows into as ratings accumulate.

Two related reporting effects, both corrections rather than regressions, but both
will *look* like drops: net profit falls on BookingKoala-imported jobs now that
Financials uses the real payout instead of the CSV provider payment (~26% of
price), and Field Lead bonuses may shift upward now that admin-excluded ratings
stop dragging group averages down.

---

## Verification

- `npx tsx scripts/verify-awer-fixes-3.ts` — **850 passed, 0 failed**, covering
  all 20 items; plus the 16 pre-existing verify suites, unchanged and green.
- `npx tsc --noEmit` — clean.
- `npm run build` — compiles, all routes emitted.
- `npm run lint` — **323 problems** against a Stage 0 baseline of 325. Every new
  file is lint-clean; the 323 are pre-existing.
- `npx prisma migrate status` — exactly the seven migrations above pending.

## Two deliberate non-builds

Both are recorded in `CLIENT_SUMMARY.md` for the client, and both are contained
pieces of work if they're wanted:

1. **No "required photos" concept** (fix 5). The PDF's checklist scope note
   implies photo-gated checklist items; the checklist gates clock-out on required
   *items*, not on photos.
2. **No approval gate before reported usage updates stock** (fix 14). The brief
   says stock should be reviewed "where needed"; we built the review *trail*
   (`JobProductUsage` + `InventoryChange` + job log, all visible on the job page
   and under Inventory → Activity) rather than a *gate*, because a gate would
   hold a cleaner's clock-out until an admin was awake to approve it.
