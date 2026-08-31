# AWER round 4 — `awerfixesaug18.pdf`, 8 items

Working tracker: [`_ai_context/TODO.md`](../../../_ai_context/TODO.md). Prior rounds:
[`AWER_FIXES.md`](AWER_FIXES.md) (29 items), [`AWER_NEW_FIXES.md`](AWER_NEW_FIXES.md)
(5) and [`AWER_FIXES_3_PR.md`](AWER_FIXES_3_PR.md) (20). Where this PDF conflicts
with earlier behaviour, **this PDF wins** — and in one place it deliberately
reverses a rule we shipped last round (fix 4; see *Two client confirmations*).

**This file is the PR description.** Paste it as the PR body, or link it from
one. The deploy order below is the part that must not be improvised.

---

## ⚠️ Deploy order — run these in this order

1. **`npx prisma migrate deploy`** — one additive migration,
   `20260819000000_job_hold_reason` (`ALTER TABLE "Job" ADD COLUMN "holdReason" TEXT`).
   Nullable, no default, no backfill, no table rewrite.
   **It has already been applied to the live database** (2026-08-19,
   owner-authorised) because the Stage 3 code reads the column and the running
   app talks to that database. Re-running `migrate deploy` is a no-op for it,
   and it should still be run so the deploy has no special cases.

2. **Deploy the code.**

3. **Run the four data scripts, in this order**, each dry-run → read the output
   → `--commit`. All four are dry-run by default; a bare run writes nothing, and
   that shape is asserted mechanically in the verify script. Their reviewed dry
   runs are reproduced under *Data repair* below.

   ```
   npx tsx scripts/fixFutureCompletedJobs.ts   --commit
   npx tsx scripts/releaseLegacyJobHolds.ts    --commit
   npx tsx --conditions=react-server scripts/recomputeHourlyJobs.ts --commit
   npx tsx scripts/backfillJobAptNumbers.ts    --commit
   ```

   ⚠️ The third one **needs the `--conditions=react-server` flag** — it drives
   `server-only` modules on purpose, so the app's own guards (settled customer,
   FINAL_PRICE override, manual pay, locked payroll period) apply to the repair
   exactly as they do to a clock-out. Run without the flag it prints the right
   command instead of failing obscurely.

   The order matters in one place: `fixFutureCompletedJobs` before
   `releaseLegacyJobHolds`, so a row is not being reasoned about as two
   different kinds of wrong at once.

4. **Spot-check live** — the six-point matrix under *Verification* below.

### One thing to tell the team before deploying

Fix 2 repaired `cancelShift.ts`, and doing so **un-blocks a dormant email
fan-out**. Cancelling a shift as its lead used to null `employeeId` while
leaving the cleaner connected to the job, so `cleaners.length` could never reach
zero — and the last-minute repost only fans out when it does. A sole cleaner
cancelling inside the 24-hour window now genuinely empties the crew, so the
repost fires: a bonus-bearing "opening" email to every `EMPLOYEE`/`FIELD_LEAD`
(`LAST_MINUTE_CLAIM_BONUS_USD`). That is the designed behaviour and it has been
unreachable in the common case, so its first real run will feel new.

### Rollback

The migration is a single `ADD COLUMN` and reverses with `DROP COLUMN`. The code
deploy is a normal revert. All four data scripts write a `STATUS_CHANGED` /
`JobLog` row per row they touch, carrying the previous value — so each one is
reversible from the logs, and re-running any of them is a no-op (the log entry
is also the re-run guard). No money column is written by scripts 1, 2 or 4;
script 3 writes `Job.employeePay` only.

---

## What's in it

Eight items from the PDF, worked in six stages. Full per-item detail and every
decision is in `_ai_context/TODO.md`.

### P0 — the two that were losing work

- **1 — Future jobs no longer read as Completed.** Payment state was being
  written into lifecycle state with no date guard (import, mark-paid toggle,
  card charge, bulk charge, invoice sync), and the Completed tab was a bare
  `status IN (COMPLETED, PAID)`. Both halves fixed: the writers are guarded, and
  completion is now derived from the enum **and** the calendar in one predicate
  (`isCompletedJob`, with a SQL twin) that the Jobs tab, its stat cards, the
  status pill, the Dashboard and Analytics all import. A read-side rule is the
  load-bearing part here — on this database the corruption came from a writer
  that leaves no log, so a guard that only fixes known writers would not have
  held.

- **2 — An assigned job always reaches its cleaner.** The Aug 19 job in IMG-2 /
  IMG-3 had saved perfectly — M2M row, `JobAssignment` row and `employeeId` all
  named Annabel Karim. It was hidden by its *status*: fix 1's corruption, one
  table over. `upcomingFilter` now says a **future** job can only be removed
  from a cleaner's schedule by a **cancellation**, whatever else the status
  column claims, and `doneFilter` carries the mirror guard so the repaired row
  does not appear in both lists at once. Three write paths were repaired along
  the way — `claimJob` wrote no lead and no assignment row, `respondToJobInvite`
  left a declined job on the decliner's own schedule, and `cancelShift`'s
  unassign did essentially nothing when the canceller was the lead.

### Honest counts

- **3 — Cancelled jobs are out of Total Jobs.** Dashboard **222 → 198**,
  measured. Both excluded groups stay visible twice: named in the hint under the
  total and again as their own tiles. Analytics counts the same way, through the
  pure twin of the same helper.

- **6 — On Hold is a real status now.** It was never one: it was the Prisma
  default, and **76% of every hold in the business (13 of 17) was nothing but
  that default** — which is why the two holds that meant something were
  invisible. Admin-created jobs are now born `SCHEDULED`; a genuine hold carries
  a written reason (`$0 import`, `quote pending`, `flexible date`, `no date`), a
  `Release` button on three surfaces, its own Jobs tab, its own dashboard tile,
  and one label everywhere. The nightly sweep no longer flips a hold to
  COMPLETED because its date slid past.

### Hourly money

- **4 — Billable hours are total crew hours.** `2 cleaners × 15h = 30h`. This
  **reverses** the round-3 "elapsed on-site hours" rule; per the standing rule
  the PDF wins. The rate is still multiplied exactly once — the crew size lives
  *inside* the hours — and that is pinned as an identity, not a grep: 1 cleaner
  × 6h and 2 cleaners × 3h produce the same price. The cleaner-facing labels
  moved with it ("Crew hours", "Crew hours worked"), because a cleaner planning
  their day off "6h" for a 3-hour shift would plan the wrong day.

- **5 — Cleaner hourly pay saves, and pays from the clock.** The save bug was
  one DTO: the job **detail** page carried the four billing columns and neither
  pay column into `<JobModal mode="edit">`, so the modal's Pay-type control read
  `undefined`, fell back to `PERCENTAGE`, and saved that over the job. That is
  exactly the shape of the live data (7 of 11 hourly-pay jobs with **no rate**).
  Pay is now each cleaner's own clocked hours × the rate, recomputed on final
  clock-out and on clock edits, with the even split surviving as the fallback
  wherever the clock cannot answer. Every pay surface states its basis in words
  — "Hourly — 6.5h clocked × $25.00/h", "Percentage — tier rate", "Manual
  override".

  The customer's billable hours are the **sum of the hours the crew is paid
  for**, by construction: both read the same per-cleaner minute map. "Billed 6h,
  paid for 3h" is no longer expressible.

### The two UX fixes

- **7 — The apartment number is impossible to miss.** The recon's guess was
  wrong and it changed what this fix is: the unit was never lost. IMG-5's ", 23"
  is `formatAddressLine` appending a *known* unit to the end of a long line
  (**0 of 155** jobs hide a unit in the address string). So it is a rendering
  fix — **Apt 23** on its own bold line in its own box, above the map buttons;
  its own row on the list card, because that line is `line-clamp: 2` and a unit
  at the tail is not merely easy to miss but cut off. **Copy** now includes the
  apartment; the Waze / Google / Apple queries deliberately drop it, because
  units break geocoders.

- **8 — The mobile job form can always be saved.** The card and its scroller
  were both `max-h-[95vh]` (static `vh`) inside a fixed overlay, with the action
  row as the last child of the scrolling body. Measured in Blink, **Update Job
  sat 3121px below the fold** at the top of step 3. Now: a `dvh` cap with a `vh`
  fallback, a sticky footer, `visualViewport` tracking so the card is sized and
  centred above the on-screen keyboard, and Delete demoted into the body. At
  390×844 the primary action is pinned on screen at every scroll position of
  every step.

---

## Data repair — the four scripts, and what their dry runs say

Every one of these was dry-run against the live database and reviewed. Nothing
has been committed.

| Script | Rows | What it does |
|---|---|---|
| `fixFutureCompletedJobs` | **2** | #2066 David Hinchey and #2064 Group Mercer — IMG-1's own two rows — `COMPLETED → SCHEDULED`. Update body is exactly `{ status: "SCHEDULED" }`: `paymentReceived`, `paidAt`, `stripePaymentIntentId` and every money column are preserved, because the payment really did happen. Only the claim that the *work* happened is withdrawn. |
| `releaseLegacyJobHolds` | **13 released, 4 labelled** | 13 `CREATED → SCHEDULED` (the enum-default holds, including four real Aug 19–20 bookings with crews assigned: Sembly Montreal $170, Kristina Pagliuca $253, Nabil Mamane $290, Maison Beloeil $450). The 4 that stay held are $0 imports and gain "Imported with $0 total — review pricing". 0 quotes, 0 flexible. Never overwrites a reason a human typed. |
| `recomputeHourlyJobs` | **0 + 2** | **No customer bill moves** — not one hourly-*billed* job on this database has clock data, so fix 4's reversal is effectively forward-only. Two cleaner-pay rows do move: #2036 Haute Coiffure Narcisse **$0.00 → $81.38** (Annabel Karim, 3.5h × $23.25) and #2222 Group Mercer **$0.00 → $10.42** (Edris Soleimani, 0.42h × $25.00). It drives the app's own snapshot helpers rather than carrying a second copy of the rules. |
| `backfillJobAptNumbers` | **0** | A no-op on this database (0 of 155 addressed jobs hide a unit in the string). Run it for the record; it exists as the guard for the next import. Its safety property is that it only ever *fills a blank* — `location` is never rewritten. |

The client's complaint, measured: **two cleaners had clocked real work on hourly
jobs and the system owed them $0.00.**

---

## Two client confirmations — both cheaper than they look

1. **Fix 4 — hours become total crew hours.** A 2-cleaner, 15-hour job bills as
   30 hours. This changes what future hourly jobs cost. It changes **nothing
   retroactively**: the recompute dry run finds zero existing hourly-billed jobs
   with clock data. They are agreeing to a rule for future work, not to a
   re-invoice.

2. **Fix 5 — each cleaner is paid their own clocked hours × the rate.** A
   two-person hourly job therefore costs both cleaners' hours rather than one
   shared total. That is what the PDF asks for, and it is the same crew hours
   the customer is now billed for. `CLIENT_DECISIONS.md` #8 (team pay is split
   equally) is not contradicted: it governs a **team total**, and an hourly job
   no longer has one to split. The even split survives untouched as the fallback
   for FLAT, PERCENTAGE and every job without sessions.

And one answer to relay, because the PDF asked for it directly:

> **"What currently triggers On Hold, and is it automatic or manual?"**
> Automatic only — and it was not a real status. "On hold" was the calendar's
> display label for the database's default value, so **every admin-created job
> was born on hold**. On your own data that was 13 of 17 holds. It is a real
> status now, with a stated reason and a Release button.

---

## Verification

- **`npx tsx scripts/verify-awer-fixes-4.ts` — 457 passed, 0 failed**, covering
  all eight items. Behaviour checks wherever the claim is logic or arithmetic
  (status derivation across the full status × date × clock-out cross-product;
  the three-bucket partition; the crew-hours sum; every pay branch; the
  once-only rate multiplication as an identity; the address splits), source
  checks where the fix lives in JSX or a form contract.
- **`npm run verify` — 32/32 scripts green** (baseline 31; this round adds one).
  `verify-stage8-hourly-jobs.ts` was rewritten **in place** to the reversed
  hourly rule rather than deleted, so the reversal stays legible in the file
  that used to argue the other way.
- **`npx tsc --noEmit`** — clean. Note `next.config.ts` sets
  `ignoreBuildErrors: true`, so the build proves nothing about types; tsc must
  be run explicitly.
- **`npm run build`** — clean, all routes emitted. (One pre-existing warning, on
  `src/app/api/stripe/webhook/route.ts`'s deprecated `export const config`.)
- **`npm run lint`** — 339 problems, all pre-existing. Measured two ways rather
  than asserted: the **ten files new in this round are lint-clean**, and
  cross-referencing every reported line number against this round's diff hunks
  finds **no lint problem sitting on a line this round added**. The 339 are
  overwhelmingly `no-explicit-any` in large files that already had them.
- **Live click-through** — done in the running app, signed in as an owner, at
  1440×900 and 390×844. What it confirmed and what it could not are both listed
  below, because the difference matters.

### What the click-through confirmed

| # | Check | Result |
|---|---|---|
| ① | Completed tab holds no future-dated job | Top row is Aug 18 11:45 PM; count 29 → **27** |
| ① | IMG-1's two rows are under Upcoming, payment visible | Aug 19 12:00 PM David Hinchey and 6:00 PM Group Mercer, both wearing **Scheduled** — *while still stamped `COMPLETED` in the database*, which is the point of the read-side guard |
| ② | The assigned Aug 19 job is on the cleaner's schedule | Annabel Karim's profile leads with it, in exactly one panel |
| ③ | Dashboard totals | **198** active · 17 on hold · 7 cancelled · reconciles to 222 |
| ③ | Analytics agrees with the Dashboard | 198 / 27 completed / 24 pending — after the fix below |
| ④ | Hourly pay from the clock, on a real row | #2222 reads **"HOURLY — CLOCKED · $10.42 · 1 cleaner · Hourly — 0.42h clocked × $25.00/h"** |
| ④ | IMG-4's panel under the new rule | "Total job hours across all cleaners — 2 cleaners × 15h is 30", and $50/h × 30h = **$1500.00** live |
| ⑤ | Hold reason visible, release offered | Amber pill + inline reason + `title` on every row; **Release from hold — {reason}** per row; a reason banner and Release in the calendar drawer |
| ⑥ | Update Job reachable on a phone | 390×844, step 3, **2987px** of scroll: pinned at y=760–814 at top, middle and bottom |
| — | Fix 5's actual mount site | The detail-page Edit modal now prefills `payType = HOURLY`, rate `25` — the DTO gap that caused "hourly pay not saving" |

### Three defects the click-through found, and fixed

None of these could have been caught by a check in the verify script, because
each one is two surfaces *disagreeing* and every check tests one surface at a
time. All three are now pinned.

1. **Analytics counted "completed" its own way.** Its `completedJobs` set was
   still a bare `status === COMPLETED || status === PAID`, so the page read **29
   completed and 26 payments outstanding** while the Dashboard and the Jobs tab
   read 27 and 24 — the same two mis-stamped Aug 19 rows. Everything reducing
   over that set was affected: average duration, average job price, labour cost,
   tips, parking, net profit, and the per-employee performance table. The worst
   of them **writes**: the overdue-payment alert pass was minting real "Overdue
   payment" alert rows for work nobody has done yet.

2. **The employee profile listed one job twice.** 2.4 rewired the Upcoming panel
   through the shared builder but left "Recent Jobs (completed in last 30 days)"
   on a hand-written `status: "COMPLETED"` with a lower date bound and no upper
   one — a fourth local definition of "done". Annabel Karim's Aug 19 job showed
   under both panels at once. It now composes `doneJobsWhere`, which also means
   a job stops vanishing from a cleaner's own history the moment the customer's
   payment lands.

3. **The calendar drawer asked to charge a card before it said "on hold".** The
   block's own comment said it sits "above the payment line, because a held
   booking has not been agreed yet — charging a card for it is not the next
   thing anyone should be doing". It was written second and rendered second. On
   job #2273 (Sembly Montreal, $195.46, on hold) the drawer read "$195.46 due ·
   Mark paid" and only then "On hold · Release". Order restored, and pinned by
   position rather than by presence.

### What the click-through could NOT confirm, and why

Everything left needs either a **write to the live database** or a **login that
is not mine**. `DATABASE_URL` is the production Supabase behind
`https://www.useawer.com`; there is no dev copy, no Docker and no local
Postgres, so there is nowhere safe to exercise these.

- **Assigning a cleaner** and **cancelling a job** — writes, and the first can
  send mail to real cleaners (see the fan-out note at the top).
- **Clocking two cleaners in and out** of an hourly job — writes, on a real
  customer's booking.
- **Releasing a hold** — a write. The button, its confirm and the reason it
  names are all verified; only the click is outstanding.
- **One actual save from the mobile modal.** The form was driven through all
  three steps on create and on edit and Update Job was reachable throughout;
  nothing was submitted, because every job reachable was a real customer's
  booking and pressing Update on one to prove a button works is a write nobody
  asked for.
- **The cleaner side of fix 7** — the Apt line and the Copy button on
  `/cleaners/my-jobs/[jobId]`. Cleaner routes bounce an owner to
  `/admin/dashboard`, and signing in as somebody else is not something I do. The
  rendering is verified against the app's own stylesheet at 390px and against
  every one of the 31 distinct apartment values in the business.
- **iOS Safari.** It is the engine whose `vh` over-reporting started fix 8 and
  the only one that shows a real keyboard. Chromium at 390×844 confirms the box
  model and a simulated 376px keyboard; the real device pass is the owner's.

---

## Deliberate non-changes

Recorded here so they read as decisions rather than omissions.

1. **The customer portal still says "Scheduling".** The On-hold label was
   unified across seven *admin* surfaces only. A customer must not read internal
   ops text like "Imported with $0 total — review pricing", and a verify check
   pins the portal's wording so a later sweep does not "fix" it.
2. **The cleaner's SCHEDULE still admits `CREATED`; the available-jobs BOARD no
   longer admits an explained hold.** Narrowing the schedule before
   `releaseLegacyJobHolds` commits would delete every legacy admin-created job
   from every cleaner's schedule — i.e. it would recreate fix 2, this round's
   P0. Both halves of that asymmetry are asserted so neither can drift.
   The board was a different question and is now **closed**, without waiting on
   the backfill: `openForClaimFilter` keys on the *reason* rather than the
   status — `SCHEDULED`, or `CREATED` with **no** `holdReason` (a legacy
   default, i.e. real work) — so every hold created from this round on is
   unclaimable the moment it is created, while the 16 legacy rows stay on the
   board exactly as today. Measured against live data: **183 claimable before,
   183 after, 0 dropped**. It also self-completes — once the backfill moves the
   legacy rows to `SCHEDULED` and stamps the genuine holds, the same filter
   means precisely "drop `CREATED`", with no second deploy. `claimJob` carries
   the identical rule as a guard *and* inside its compare-and-set `WHERE`, so a
   hold placed mid-claim wins the race.
3. **`formatAddressLine` was not rewired.** The new `resolveAddressParts` is an
   additive second entry point used by the cleaner surfaces only. The shared
   one-liner feeds the address manager, every dropdown label, the invoice's
   Service address block and the customer portal; moving the unit there would
   have changed text on all of them to fix a screen none of them are.
4. **A placeholder apartment (`"None"`) reads as blank for display but stays
   distinct for de-duplication.** Two rows whose units differ only by a
   placeholder are still two rows, and merging them would lose one. Both halves
   are asserted so a later sweep cannot tidy the asymmetry away.
5. **The Jobs page's stat cards stay filter-scoped.** They count whatever the
   current tab shows, which is correct behaviour; the PDF's target was the
   Dashboard. The new On-hold tab scopes them to held work, so that tab's "Total
   jobs" card is the hold count.
6. **The employee profile's money stats stay on the lead relation.** The
   Employees *list* attributes revenue the same way; widening one page and not
   the other is how a cleaner ends up with two different revenue figures on two
   screens.
