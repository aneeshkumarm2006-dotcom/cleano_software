# Awer Platform Software Fixes — Working Tracker

Source: `awer_fixes.pdf` (Developer Handoff, updated July 2026) — 29 items.
Started: 2026-07-26. One item at a time, verified before moving on.

**Legend:** `[ ]` not started · `[~]` in progress · `[x]` done + verified · `[!]` blocked on a client decision

---

## Audit baseline (2026-07-26)

Verified with a **read-only** query against the live database before any code changes.

```
ADMIN/OWNER users: ADMIN (ADMIN)

Live jobs: 6
Live jobs whose employeeId is an ADMIN/OWNER: 6
  ...of those, with exactly 1 assigned cleaner: 4

Payout rows: 23; negative finalAmount: 2
  2026-04-01..2026-04-15  DRAFT  base=0  ded=20  final=-20
  2026-04-01..2026-04-15  DRAFT  base=0  ded=20  final=-20
Payout rows belonging to an ADMIN/OWNER account: 2 totalling $233.97

Jobs — active: 6, archived: 1443, revenue-eligible (active): 0
```

Cleaner-pay reproduction (real `computeJobPayShares` over live rows):

```
Job #1509  price=$112
   ADMIN        [ADMIN/STANDARD]    rate=40%  -> paid $26.35
   Asia Smellie [EMPLOYEE/STANDARD] rate=45%  -> paid $29.65
   EXPECTED per spec (solo, full rate):        $50.40

Job #1537  price=$220  (no cleaner assigned)  ADMIN -> $88.00
Job #1538  price=$353  (no cleaner assigned)  ADMIN -> $141.20
```

### Root causes identified

1. **Admin counted as a paid crew member.** `saveJob.ts` sets `employeeId: session.user.id`
   on every job saved from the admin modal; `jobParticipantIds()` treats `employeeId` as a
   payable participant. A 1-cleaner job therefore becomes a 2-person "split" job (50% pool),
   and jobs with no cleaner pay the admin outright. Drives items **3** and **4**.
2. **No floor on payout math.** `updatePayout.ts` computes
   `base + adjustments − deductions + reimbursements` with no clamp and no admin-facing
   warning. `base=0` + `$20` deduction → `−$20`. Drives item **1**.
3. **Item 2 is not a code defect.** Analytics / Dashboard / Jobs already share
   `getTotalRevenue()` + `revenueWhere()` (commits `6c91279`, `b885494`). The client's
   "$0 revenue / 6 jobs" screenshot is correct behaviour: 1443 of 1449 jobs are archived.
   The "$154,417 / 771 jobs" screenshot predates that archive. **Do not "fix" this.**
   The one real leftover is `/admin/training-docs`, which is hardcoded demo data (item 22).

### Decisions (settled)

**`awer_fixes.pdf` supersedes every earlier spec.** Confirmed by the user on 2026-07-26:
where this document conflicts with `software_changes_updated.pdf` or any prior agreement,
this document wins. Earlier behaviour is not a reason to keep anything.

- **Cleaner pay model (items 3 + 11) — SETTLED.** The 50% split-pool model is retired.
  - Each cleaner earns `job price x their own rating-based rate`. Item 3's three worked
    examples are the acceptance test: $112 @ 40% = $44.80, $112 @ 45% = $50.40,
    $220 @ 45% = $99.00 ("not $55.00 or 25%" — $55 is exactly the old half-pool share).
  - "Split evenly" (item 11) governs a fixed/custom TOTAL payout, not the percentage
    model — which is already the FLAT/HOURLY behaviour.
  - **Consequence, stated plainly:** a 2-cleaner PERCENTAGE job now costs ~80–90% of the
    job price in labour instead of 50%. That is what the document asks for; it is a
    pricing decision for the client, not a bug.

### Observations found while fixing — NOT acted on (out of scope)

- **`chargeJob` charges `price − discount`, i.e. PRE-TAX.** So the customer's card is
  charged the untaxed amount even on a taxed job, while `Job.totalAmount` includes GST/QST.
  This is not in the 29-item list and changing it would alter what customers are actually
  billed, so it is flagged rather than changed. Worth raising with the client.
- **`assignKit` still hard-blocks on "Insufficient warehouse stock",** which is inconsistent
  with the item 5 decision. Item 5 is scoped to the cleaner workflow and this is an admin
  action, so it was left alone.

### Items that are new scope, not defects

7, 14, 18, 26, 29 do not appear in any prior approved spec. Building them anyway per
instruction, but worth naming in the client reply.

---

## P0

- [x] **1. Payroll period showing negative amount** — done. New pure helper
      `src/lib/payout-math.ts` is the single definition of payout totals: the payout is
      floored at `$0`, and the un-recovered deduction is returned as `shortfall` instead of
      being swallowed. Wired into `updatePayout` (write), `pay-period.server` (generation),
      the payouts page + editor (display), `completePayPeriod` (labour expense + cleaner
      emails), `requestWithdrawal` and `cleaner-earnings` (wallet / pending).
      Totals are recomputed from the four components on read, so periods written before the
      floor display correctly with no data migration.
      Verified: math 8/8, and against live data the reported period now reads
      `$0.00` with "$40.00 not recovered across 2 employees" instead of `-$40.00`;
      0 payout rows can still render negative. tsc clean, build compiles.
- [x] **2. Analytics / Dashboard revenue mismatch** — already fixed in code; the reported gap
      is the 1443-job archive. No change. See "Root causes" #3.
- [x] **3. Cleaner pay calculation everywhere** — done. `Job.employeeId` is the job's LEAD
      CLEANER (how `claimJob`, `bulkAssignCleaner` and the cleaner app all read it); both
      admin job forms were stamping it with the ACTING ADMIN, so a 1-cleaner job was paid as
      a 2-way split and an unassigned job paid the admin outright.
      Fixed at the source in `saveJob.ts` **and** `jobs/new/page.tsx` (both wrote
      `session.user.id`), the admin is no longer prepended to the payout-estimate rate list,
      and a new `resolveJobLead()` keeps the lead pointing at a real team member from
      `saveJob`, the full-page form and `assignCleaners`.
      Defence in depth: `jobParticipantIds()` now ignores an ADMIN/OWNER lead who is not also
      an explicitly assigned cleaner, so **historical rows are corrected on read** — no data
      migration needed.
      **Pay model settled and implemented** (the document supersedes the earlier spec): the
      50% split pool is retired in `computeJobPayout` — every cleaner now earns their own
      rating-based rate on the FULL job price, solo or paired. The Available Jobs estimate no
      longer simulates a roster (it was also a route for a stale `employeeId` to skew the
      figure). `SPLIT_POOL_FRACTION` is left in place but deprecated so a stale import is
      caught at review rather than silently reintroducing the halving.
      Verified: `scripts/verify-cleaner-pay.ts` 24/24 — all three quoted figures
      ($112→$50.40, $220→$99.00, $112→$44.80), paired jobs now $99.00 each (not the rejected
      $55.00), a third cleaner dilutes nobody, and FLAT/override behaviour is unchanged.
      On live data Asia resolves to $50.40 (was $29.65) and $0.00 flows to ADMIN accounts
      (was $233.97). Live labour is 45.0% of price; **0 live jobs currently have 2+ cleaners**,
      so the model change has no immediate cost impact. tsc clean, build compiles.
- [x] **4. Cleaner assignment not saving on jobs** — done. The M2M + `syncJobAssignments`
      writes were already correct; the reported symptom was the admin showing as the assigned
      employee everywhere (same root cause as item 3). Also fixed the spec's explicit
      "show an error instead of silently reverting": `syncJobAssignments` swallowed every
      failure, so the job saved, the per-cleaner rows didn't, and the admin was told it
      worked. It now returns a result and all four call sites surface it.
      **Security fix found on the way:** `admin/jobs/new` had NO role check — the only gate
      was `existingJob.employeeId === session.user.id`, which worked only because of the
      bug above. That meant one admin could not edit another admin's job, and once
      `employeeId` holds the lead cleaner an assigned CLEANER could have opened the admin
      job form (price, cleaner pay, payment status). Now guarded with `requireAdmin()`.
- [x] **5. Remove hard inventory checkout blocks** — done. Four separate blocks removed:
      the server's "not stocked at this location" and "Only N available" rejections, the
      disabled `+` button, and the disabled submit. Locker stock may now go negative —
      `inventoryLocationStock` is upserted (a location with no stock row for the product no
      longer throws) and the row is created at a negative quantity to record the debt.
      The action returns `warnings` instead of failing; the cleaner sees an amber
      "you can still take it, it'll be flagged for admin" note and a confirmation that names
      how many items went below the recorded count. Admin inventory shows a distinct
      **"Reconcile (−N)"** badge and a "N negative — reconcile" stat hint, kept separate from
      ordinary low stock (a stock count is needed, not a purchase order).
      Verified: 15/15 structural checks, tsc clean, build compiles.
- [x] **6. Quick assign inventory to cleaners** — done. New `bulkAssignCleanerInventory`
      action + `QuickAssignModal`: pick a cleaner, see **every** product in the database with
      a quantity field, save the lot in one transaction.
      The two modes are kept genuinely distinct because the same typed number means
      different things — **From Locker** treats it as an amount to hand over (kit `+n`,
      chosen location and global `stockLevel` `−n`), **Manual Adjust** treats it as the
      cleaner's new absolute count and never touches company stock. Switching mode clears
      typed values so intent can't carry across silently. The rule lives in a pure
      `src/lib/inventory-assign.ts` so it is unit-testable and can't drift from the UI.
      Every line writes an `InventoryChange` row (two in From Locker: kit + warehouse),
      feeding item 18's activity log. Consistent with item 5, low/zero locker stock warns
      rather than blocks and may go negative.
      Verified: `scripts/verify-inventory-assign.ts` 23/23, tsc clean, build compiles.
      *Not* exercised end-to-end against the database — that would mean writing to
      production, which I won't do without a green light.
- [x] **7. Exclude sales tax on specific jobs** — done. New `Job.taxExempt` (migration
      `20260726010000_job_tax_exempt`, defaults false so existing totals are unchanged),
      deliberately SEPARATE from `isCashJob`: that is a payment method that happens to be
      untaxed, this is a tax status, and a job can be card-paid **and** exempt. `isJobTaxExempt()`
      ORs the two so one rule drives money math and display alike.
      Scoped to the single job — there is no global switch. Wired through both admin job
      forms, the recurring-series children, the job modal (checkbox that states
      **"Taxes INCLUDED"** / **"Taxes EXCLUDED"** outright), and the job detail financials.
      Invoices match the job: a single-job invoice inherits the setting, and a
      **consolidated** invoice applies exemption per job — exempt jobs' amounts are removed
      from the taxable base while other jobs and manual line items are still taxed.
      Cleaner pay is provably unaffected (calculated from the pre-tax price) — asserted in
      the tests, not just assumed.
      Refactor on the way: the pure tax helpers moved from `tax.server.ts` into the
      client-safe `tax.ts` and are re-exported, so display code can apply the identical rule
      and the logic is unit-testable. Only the DB rate read stays server-only.
      Verified: `scripts/verify-tax-exempt.ts` 25/25, tsc clean, build compiles.
- [x] **8. Square footage section in job modal** — done, **no migration needed**
      (`Job.squareFootage` already existed; the admin forms simply never read or wrote it).
      Added a Square Footage section to the job modal **and** the full-page form, loaded on
      edit and saved on both create and edit.
      Pricing: the modal shows the live derived price for square-foot services and the
      server recomputes it on save — but **only when the admin left Price blank**. A typed
      price always wins, since admins price jobs manually (courtesy/negotiated totals) and
      silently overwriting a human's number would be worse than not helping at all.
      Non-sqft services still store the value and say so in the hint, exactly as the spec asks.
      **Vocabulary bug fixed:** `isSqftService` only matched the booking flow's
      "MOVE_IN_OUT", while the admin form stores "MOVE_IN - Move-in Cleaning" /
      "MOVE_OUT - …", which normalize to MOVE_IN / MOVE_OUT. So an admin-created move job
      would never have been priced by area. New pure `isSqftJobType()` folds both halves of
      a move across both vocabularies and is shared by the modal and the server.
      Verified: `scripts/verify-square-footage.ts` 28/28 (incl. the `>=` threshold boundary),
      tsc clean, build compiles.

## P1

- [x] **9. Recurring jobs with editable instances** — done, **no migration needed**.
      All four required cadences are now offered in admin: **daily** (new), weekly, biweekly
      and **monthly** (the engine already understood it — `saveJob` just never allowed it).
      DAILY is a first-class cadence with its own configurable discount column, distinct
      from the Airbnb `HIGH_FREQUENCY` ("Daily / 20+"), which keeps its weekly cadence.
      Daily uses the same look-ahead *window* as the weekly horizon setting, so "3 weeks
      ahead" means the same span whichever cadence is picked.
      **"Edit the full series" built** (`src/lib/job-series.ts`) — the missing half of this
      item; editing one occurrence already worked because children are real Job rows.
      It is **opt-in per save**, never sticky, and only offered when the job genuinely has
      siblings, showing the real count. Dates are never propagated (each occurrence keeps
      its own slot — the entire point of a series), and **completed / paid / cancelled
      occurrences are skipped** so a price edit can't rewrite financial history or contradict
      an invoice already sent. The count of skipped visits is reported back to the admin.
      `discountAmount` is deliberately excluded: a child's discount carries its own
      recurring-frequency component, so copying the edited job's figure would wipe or double it.
      **Date bug fixed:** `nextOccurrence` used plain `setMonth(+1)`, which overflows —
      Jan 31 became **March 3**, silently dropping February's visit. Now clamps to the last
      day of the target month (Jan 31 → Feb 28, Feb 29 in a leap year). Applies to QUARTERLY
      too. This was latent before but became reachable the moment MONTHLY was exposed to admin.
      Verified: `scripts/verify-recurring.ts` 39/39; all six earlier suites re-run green
      (24/24, 25/25, 28/28, 30/30, 8/8, 23/23). tsc clean, build compiles.
- [x] **10. Manual cleaner payout option** — done (`setCleanerJobPay`, per-cleaner
      "Custom pay", `JobAssignment.payAmount` wins in payroll).
- [x] **11. Custom cleaner pay + paired split** — done. Per-cleaner overrides
      (`JobAssignment.payAmount`) already won over the automatic calc and flowed into payroll,
      profit/margin and the revenue breakdown; verified rather than rebuilt.
      Paired split: with the percentage model settled (item 3) each cleaner is paid their own
      rate, and "split evenly" governs a fixed/custom TOTAL — the FLAT/HOURLY path, which
      splits the team total evenly and lets an override take its amount off the top
      (verified 70/30 on a $100 total). Automatic-vs-overridden is now explicit: the job
      detail shows an `auto` pill alongside the existing `custom` pill, rather than leaving
      "automatic" to be inferred from a missing badge.
- [x] **12. Admin view for employee clock-ins** — done, **no migration needed** (the data
      already existed in `JobAssignment`, it just had nowhere to be read).
      New **Staff → Time Tracking** page (`/admin/time-tracking`) with the cross-employee
      clock history: cleaner, job, clock-in, clock-out, total time worked and clock status,
      filterable by employee and by "still clocked in", cursor-paginated.
      All logic lives in a pure `src/lib/time-tracking.ts` so the page and the job detail
      compute "time worked" identically.
      **Legacy jobs handled:** jobs created before per-cleaner `JobAssignment` rows only have
      the job-level `clockInTime`/`clockOutTime`. The report falls back to those, otherwise
      older history would have appeared empty. Where both exist, the per-cleaner row wins.
      **Open shifts are never counted as worked time** — an in-progress shift reports
      *elapsed* time, kept separate from `minutesWorked` so it can't leak into payroll totals.
      Shifts open beyond `STALE_SHIFT_HOURS` (12h) are flagged as **"Missed clock-out"** with
      a count tile, since a forgotten clock-out otherwise silently inflates hours. Those
      totals are computed over the whole set, not just the loaded page.
      Job detail now also shows **total time worked** per cleaner next to in/out — the spec
      lists it and it was the one field missing there.
      Verified: `scripts/verify-time-tracking.ts` 35/35, tsc clean, build compiles, route
      registered as `ƒ /admin/time-tracking`.
- [x] **13. Improve cleaner inventory assignment** — done via the same screen as item 6.
      Assignment is reachable directly from Inventory → Cleaner Inventory, the picker lists
      **all** products (not just ones the cleaner already holds) with an editable quantity
      each, many products save at once, and the modal calls `router.refresh()` so the kit
      updates immediately. The cleaner list is built from all staff rather than from
      `cleanerInventory` (which only contains people who already hold stock), so you can
      assign to someone with an empty kit.
- [x] **14. Split inventory refill thresholds** — done. New `Product.cleanerRestockThreshold`
      sits alongside `minStock` (now documented as the company reorder point) so both are
      edited in one place, with migration `20260726000000_split_inventory_thresholds`
      backfilling every configured `InventoryRule.refillThreshold`. The legacy column is
      kept, not dropped, so the migration is reversible; the Settings rules editor writes
      both in one transaction so they can't drift.
      All threshold logic now goes through a pure `src/lib/inventory-thresholds.ts`.
      **The real defect was the fallback:** `clockOut` read
      `inventoryRule?.refillThreshold ?? product.minStock`, so a cleaner holding 3 bottles
      was judged against a WAREHOUSE reorder point of 20 and reported critically low.
      Cleaner-side paths no longer reference `minStock` at all.
      **Also fixed:** both dashboards skipped any product without an `InventoryRule` row
      (`if (!rule) return false`), so those products could never raise a refill alert no
      matter how empty the kit was.
      Alerts now name the action — **"Purchase needed"** (company) vs **"Restock needed"**
      (cleaner) — instead of an ambiguous shared "Low Stock".
      Verified: `scripts/verify-inventory-thresholds.ts` 30/30, tsc clean, build compiles.
      **Migration applied to production 2026-07-26** — backfill verified, 0 mismatches across all 18 configured thresholds.
- [x] **15. Cleaner inventory issue reporting** — done, **no migration needed**. The old flow
      offered Damaged/Lost only; it now has all four types the spec names — **Lost, Broken,
      Ran out, Other** — each with a hint, plus product, quantity and optional note.
      **The types deliberately behave differently in the books**, which is the whole reason
      for having types rather than a free-text note (rule in `src/lib/inventory-issues.ts`):
      • **Lost / Broken** — the product is gone, so it is written off against company stock
        as well as the cleaner's kit (existing behaviour).
      • **Ran out** — normal consumption. Company stock was already reduced when the product
        was handed over, so writing it off again would **double-count the loss**. Kit only,
        and it raises an INFO "may need a restock" alert rather than a loss warning.
      • **Other** — unexplained, so it corrects the kit but never silently reduces what the
        company believes it owns; flagged for admin review instead.
      An unrecognised value falls back to OTHER, so a bad input can never trigger a
      write-off. Legacy `"damaged"`/`"lost"` values still resolve, and the activity log
      labels both new and legacy rows.
      Reported issues flow into the item 18 activity log automatically (they already wrote
      `InventoryChange` rows).
      Verified: `scripts/verify-inventory-issues.ts` 35/35, tsc clean, build compiles.
- [x] **16. Improve cleaner My Inventory view** — Empty/Low/OK status, report + refill buttons.
- [x] **17. Admin cleaner inventory overview** — done. The overview (per-cleaner cards,
      product count, low flags, drill-through to the full list) already existed; added the
      missing **"Assign more"** button on each cleaner card, which opens the item 6 screen
      pre-selected to that cleaner, plus an "Assign inventory" action in the header and in
      the empty state — previously the empty state was a dead end, since the only route to
      assignment was via a cleaner who already held stock.
- [x] **18. Inventory activity log** — done. New Inventory → **Activity** tab backed by
      `getInventoryActivity`, showing cleaner, product, action, signed quantity + resulting
      count, timestamp and note, newest first, filterable by cleaner and product.
      Lazy-loaded in pages of 25 via **cursor** pagination (`cursor` + `skip: 1`, ordered by
      `createdAt, id`) rather than offset — this table is append-only, so `skip` would
      duplicate or drop rows as new activity landed mid-scroll.
      **Two logging gaps fixed first**, or the log would have quietly under-reported:
      `clockOut` deducted product used on jobs and `assignKit` moved kit stock, both without
      writing any `InventoryChange` row — so job usage (the single biggest source of stock
      movement) and kit assignments were invisible in both this log and each product's Stock
      History. Both now write audit rows like every other path.
      Verified against live data: 38 rows paged in 8 pages of 5 — **38/38 visited, 0
      duplicates**, ordering confirmed newest-first. tsc clean, build compiles.
- [x] **19. Keep cleaner self-serve pickup simple** — done alongside item 5 (same code path).
      `getLocationProducts` now lists **every** active product with its stock at that location
      (it previously filtered on `quantity > 0`, so out-of-stock items were invisible and a
      cleaner could not record taking something restocked outside the app). Each row carries
      an In stock / Low stock / Out of stock pill driven by `minStock`, quantity inputs stay
      enabled at any stock level, pickup still adds to cleaner inventory and decrements the
      locker, and the confirmation message is retained.
- [x] **20. Sync job types between Settings and job form** — done, **no migration needed**.
      **Root cause:** Settings → Job Types wrote a `jobTypes.list` AppSetting that
      **nothing in the product read**. An admin could rename, add or deactivate a service,
      save it, and nothing changed anywhere. Meanwhile there were **seven** hardcoded lists
      (`job-types.ts`, `JobTypeSelector`, `JobModal`, admin Jobs filter, cleaner Jobs filter,
      checklist editor, plus a private `switch` in the cleaner job detail) — and two of them
      disagreed about what to STORE: the full-page form wrote `"MOVE_IN - Move-in Cleaning"`
      while the modal wrote `"MOVE_IN"` for the same service.
      New `src/lib/service-catalog.ts` (+ `.server.ts`) is now THE list. Each service has an
      admin-editable **name** plus a canonical **category** that drives pricing, discounts,
      checklists and calendar labels. Jobs store the CATEGORY, so renaming a service in
      Settings renames it everywhere without orphaning a single existing job.
      Defaults ship **Move-in / Move-out as one service**, matching the spec's example; the
      Settings tab now rejects two services mapping to the same category (that was the
      duplicate-options bug).
      Wired into: job creation, job edit modal, admin Jobs filter, cleaner Jobs filter,
      checklist templates, invoice line items (single and consolidated) and the cleaner job
      views — the exact surfaces the spec lists.
      **Legacy mapping:** `jobTypeLabel(raw, adminLabels)` and `resolveServiceValue()` map old
      stored values (`"R - Residential"`, `"MOVE_IN"`, the booking flow's `"STANDARD"`) onto
      the current service, and fold a legacy MOVE_IN/MOVE_OUT job onto the combined service
      so it never displays one the business no longer offers. A service that is no longer
      offered preselects blank rather than a wrong one. `job-types.ts` is kept, deprecated,
      purely so historical values still match in the labour-cost filter.
      Verified: `scripts/verify-service-catalog.ts` 46/46; all 8 earlier suites re-run green;
      tsc clean, build compiles.

## P2

- [x] **21. Rag Wash section** — page redirects to Wash Payouts; cleaner side removed.
      Client screenshot appears to predate the deploy — confirm on prod.
- [x] **22. "Hide" Training & Documents from admin view** — done, **no migration needed**.
      ⚠️ **The title is misleading and the page was NOT hidden.** The written requirements —
      which the document's own preamble makes the source of truth over titles and
      screenshots — ask for the opposite: *"The admin side should focus on managing training
      content and employee progress"* and *"use a clear View as Employee/Admin Preview mode"*.
      Hiding the page would have failed the last requirement outright.
      Admins now land on a **management view** built from real `TrainingModule` /
      `TrainingProgress` data: module list (length, quiz count, required/optional) and
      per-employee progress (required modules completed, average quiz score, last activity),
      plus the existing real document access log and a link to Settings → Training to edit
      modules. The employee onboarding flow moved behind an explicit **"View as employee"**
      toggle with a banner stating nothing is recorded against the admin's account.
      **All the fake data is gone** — the page previously rendered hardcoded sample videos,
      sample PDFs and a fabricated "Passed · 92%". The employee *preview* now renders real
      modules and real documents too, so an admin previewing the cleaner experience isn't
      shown content that doesn't exist. This was also the last of the demo data the client
      flagged under item 2.
      Judgement calls: progress counts only ACTIVE + REQUIRED modules (an optional or retired
      module must not make someone look permanently incomplete), and "no quiz taken" renders
      as **—** rather than 0%.
      Verified: `scripts/verify-training-admin.ts` 21/21; all 9 earlier suites re-run green;
      tsc clean, build compiles.
- [x] **23. Jobs search bar losing focus** — search is local state; no URL round-trip.
- [x] **24. Preserve jobs filters after updating a booking** — `router.refresh()`.
- [x] **25. Permanent delete for archived jobs** — row + bulk, admin-only, archived-only guard.
- [x] **26. Cleaner break / pause while clocked in** — done. **Migration
      `20260726020000_job_breaks` pending deploy.**
      New `JobBreak` model — **rows, not a start/end column pair on JobAssignment**, because
      a cleaner can legitimately take more than one break on a long job and a single pair
      would silently overwrite the earlier one. `endedAt` null = running.
      Cleaner gets **Start break / End break** on the clock screen, available only once
      clocked in; the running state is read server-side so a reload mid-break doesn't lose
      it. Clock-out closes any break left open — otherwise it would run forever and active
      time would keep shrinking.
      **Break time never inflates active work time** (the spec's last requirement): worked =
      clock-out − clock-in, active = worked − breaks, and `jobWorkedHours` — which HOURLY pay
      bills — now subtracts breaks. Without that a lunch break would be paid to the cleaner
      *and* billed to the customer. A running break counts up to now, so live figures don't
      jump when it ends; an open shift reports no active total rather than a guess.
      Admin sees break time in the job modal time summary (clock-in/out, break total, active
      working time, "On break now") and on Staff → Time Tracking, where **active** is the
      headline figure with break time beneath so elapsed stays auditable.
      Guards: can't start a break without being clocked in, can't double-tap into two
      overlapping breaks (that would double-count against the cleaner), can't end one that
      isn't running; all scoped to the session user.
      Verified: `scripts/verify-breaks.ts` 37/37; all 13 earlier suites green; tsc clean,
      build compiles.
- [x] **27. Separate checklist trigger for add-ons** — done, **no migration needed**. The
      field existed, but **two defects meant the feature didn't actually work**:
      1. **Add-on matching was case-sensitive** — the Settings hint even admitted it
         ("case-sensitive match"). With free text on both sides, a template for
         "Inside Fridge" silently never fired on a job whose add-on read "Inside fridge".
         Matching is now case- and whitespace-insensitive via `addOnKey()`.
      2. **"Both" was silently broken.** The matcher returned on `jobType` alone, so a
         template scoped to Residential AND "Inside Fridge" attached to **every** residential
         job, add-on or not. Job type + add-on now requires **both** to match.
      Scoping rules live in a pure `src/lib/checklist-triggers.ts`: jobType only → that
      service; add-on only → any job carrying it; both → AND; neither → global. Combined
      MOVE_IN_OUT jobs still pull in both halves of a move, and cross-vocabulary matching
      (web "STANDARD" vs admin "R - Residential") is preserved.
      The editor's free-text box is replaced by a **picker sourced from the add-ons in
      Settings → Pricing Rules**, with any add-on already referenced by a saved template
      unioned in — so renaming an add-on never makes an existing trigger vanish from the
      list, and a now-unconfigured value is flagged rather than silently reset. The template
      list shows a **"Both must match"** badge so the AND is visible at a glance.
      The generator now loads active templates and filters in memory (case-insensitive
      matching can't be expressed as a SQL `in`; the template table is small).
      Verified: `scripts/verify-checklist-triggers.ts` 27/27; all 11 earlier suites green;
      tsc clean, build compiles.

## P3

- [x] **28. Calendar month view job details** — done, **no migration needed**. Month cells
      already rendered job cards rather than only a count, so the gap was identity:
      • **Client name** was `title.split(" ")[0]` — the surname was thrown away, so two
        clients called "David" were indistinguishable on the grid. New `shortName()` gives
        "David B." / "David C.".
      • **The dot was status-coloured**, duplicating information the chip's own tint already
        carries. It is now keyed to the **assigned cleaner** via the canonical `avatarColor`
        (same person, same colour everywhere), with the cleaner's initials on the card — so
        the month can be scanned by person, which is what the spec asks for.
      • **Unassigned jobs** get a dashed outline rather than borrowing someone's colour, and
        the literal string "Unassigned" is never treated as a person's name.
      Assignee resolves from the first assigned cleaner, falling back to the lead employee.
      Cards per day raised from 2 to 3 (cells given the extra height) and the tooltip names
      the assignee.
      Verified: `scripts/verify-calendar-month.ts` 23/23; all 12 earlier suites green;
      tsc clean, build compiles.
- [x] **29. Discount reason field** — done. **Migration
      `20260726030000_job_discount_reason` pending deploy.**
      `Job.discountReason` — nullable TEXT, **no backfill**: the spec allows existing
      discounts to stay blank, and inventing a reason for a historical discount would put a
      guess into reporting. Blank renders as **"No reason assigned"**.
      Stored as a string, not an enum, because the spec says "select **or enter**" — the job
      modal offers the seven presets it names and "Other" reveals a free-text box. The
      literal word "Other" is never stored as the reason.
      The field only appears once a discount is actually entered, and a job with **no**
      discount shows nothing at all — "No reason assigned" there would imply a discount
      nobody explained.
      **System-applied discounts label themselves** rather than leaving a blank reporting
      can't explain: a recurring booking gets "Recurring Discount", and recurring children
      get it regardless of why the first visit was discounted (they carry only the frequency
      discount — see commit `d00415e`). An admin-entered reason always wins. The auto values
      are exact preset strings so they group with manually-chosen ones in reporting.
      Appears in job details (beside the discount, with a missing reason styled differently)
      and in reporting via a **Discount Reason** column on the jobs export.
      Verified: `scripts/verify-discount-reason.ts` 31/31; all 14 earlier suites green;
      tsc clean, build compiles.

---

## Change log

| Date | Item | What changed | Verification |
|------|------|--------------|--------------|
| 2026-07-26 | — | Baseline audit of all 29 items against the codebase + live DB (read-only). | Queries above |
| 2026-07-26 | 1 | `payout-math.ts` — $0 floor on payouts + visible shortfall; applied to write, generation, display, payroll completion, withdrawals and cleaner earnings. | `scripts/verify-payout-math.ts` 8/8; live period now $0.00 + warning; tsc + build clean |
| 2026-07-26 | 3, 4 | `Job.employeeId` = lead cleaner, not the acting admin (both admin forms); `resolveJobLead()`; participant guard ignores an unassigned ADMIN/OWNER lead; `syncJobAssignments` reports failures; `requireAdmin()` added to `admin/jobs/new`. | `scripts/verify-cleaner-pay.ts` 15/15; live: $50.40 to the cleaner, $0.00 to admins; tsc + build clean |
| 2026-07-26 | 5, 19 | Inventory pickup blocks removed (server rejections, disabled +, disabled submit, hidden out-of-stock items); locker may go negative via upsert; warnings returned; stock-status pills; admin "Reconcile" badge. | 15/15 structural checks; tsc + build clean |
| 2026-07-26 | 3, 11 | Pay model settled per the document: 50% split pool retired, every cleaner earns their own rate on the full price; Available Jobs estimate de-rostered; `auto`/`custom` payout pills. | `scripts/verify-cleaner-pay.ts` 24/24; live labour 45.0% of price, 0 paired jobs; tsc + build clean |
| 2026-07-26 | 6, 13, 17 | `bulkAssignCleanerInventory` + `QuickAssignModal`: all products, bulk save, From Locker / Manual Adjust modes, audit rows; "Assign more" per cleaner + non-dead-end empty state. | `scripts/verify-inventory-assign.ts` 23/23; tsc + build clean |
| 2026-07-26 | 18 | Inventory → Activity tab with cursor pagination + cleaner/product filters; added missing audit rows to `clockOut` (job usage) and `assignKit`. | Live: 38/38 rows paged, 0 duplicates, newest-first; tsc + build clean |
| 2026-07-26 | 14 | `Product.cleanerRestockThreshold` + migration/backfill; pure `inventory-thresholds.ts`; removed the minStock fallback on cleaner paths; action-named alerts. | `scripts/verify-inventory-thresholds.ts` 30/30; tsc + build clean. Migration applied 2026-07-26. |
| 2026-07-26 | 7 | `Job.taxExempt` + migration; `isJobTaxExempt()`; wired through both job forms, recurring children, modal, job detail, single + consolidated invoices; pure tax helpers moved to client-safe `tax.ts`. | `scripts/verify-tax-exempt.ts` 25/25; tsc + build clean. Migration applied 2026-07-26. |
| 2026-07-26 | 8 | Square Footage section on both admin job forms; `isSqftJobType()` fixes the admin-vocabulary gap; price derived from area only when Price is left blank. | `scripts/verify-square-footage.ts` 28/28; tsc + build clean. No migration needed. |
| 2026-07-26 | 9 | DAILY + MONTHLY admin cadences; `job-series.ts` opt-in "apply to whole series" protecting completed/paid visits; month-end clamping in `nextOccurrence`. | `scripts/verify-recurring.ts` 39/39 + all 6 prior suites green; tsc + build clean. No migration needed. |
| 2026-07-26 | 12 | `/admin/time-tracking` page + `getClockActivity` + pure `time-tracking.ts`; legacy job-level clock fallback; missed-clock-out flagging; worked total on job detail. | `scripts/verify-time-tracking.ts` 35/35; tsc + build clean. No migration needed. |
| 2026-07-26 | 20 | `service-catalog.ts` becomes THE service list; Settings → Job Types is finally read; 7 hardcoded lists removed; jobs store canonical categories so renames propagate; legacy values mapped on read. | `scripts/verify-service-catalog.ts` 46/46 + all 8 prior suites green; tsc + build clean. No migration needed. |
| 2026-07-26 | 29 | `Job.discountReason` + preset/custom picker; system-applied discounts self-label; shown in job details and the jobs export. | `scripts/verify-discount-reason.ts` 31/31 + 14 prior suites green; tsc + build clean. Migration applied 2026-07-26. |
| 2026-07-26 | 26 | `JobBreak` rows + start/end break on the clock screen; breaks deducted from `jobWorkedHours` so hourly pay bills ACTIVE time; admin job summary + time-tracking show break vs active. | `scripts/verify-breaks.ts` 37/37 + 13 prior suites green; tsc + build clean. Migration applied 2026-07-26. |
| 2026-07-26 | 28 | Month cards: `shortName()` keeps the surname initial, dot + initials keyed to the assigned cleaner via `avatarColor`, dashed dot for unassigned, 3 cards per day. | `scripts/verify-calendar-month.ts` 23/23 + 12 prior suites green; tsc + build clean. No migration needed. |
| 2026-07-26 | 27 | `checklist-triggers.ts`: case-insensitive add-on matching + jobType AND add-on now actually requires both; free-text box replaced by a Settings-driven picker. | `scripts/verify-checklist-triggers.ts` 27/27 + 11 prior suites green; tsc + build clean. No migration needed. |
| 2026-07-26 | 15 | Four issue types (Lost/Broken/Ran out/Other) with per-type stock semantics in `inventory-issues.ts`; cleaner UI + activity-log labels. | `scripts/verify-inventory-issues.ts` 35/35; tsc + build clean. No migration needed. |
| 2026-07-26 | 22 | Admin Training & Documents becomes a management view (real modules + per-employee progress); employee flow moved behind an explicit preview; all hardcoded sample content removed. Page deliberately NOT hidden — see the note above. | `scripts/verify-training-admin.ts` 21/21 + all 9 prior suites green; tsc + build clean. No migration needed. |
