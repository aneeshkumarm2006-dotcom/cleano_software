-- Fix 4 of cleano_new_fixes.pdf — an admin's Employee pay figure is an ORDER,
-- not a suggestion (decision D2).
--
-- `Job.employeePay` has always carried two incompatible meanings in one column:
--
--   a SNAPSHOT   saveJob writes `computeJobPayout(price, rates).pool` on every
--                PERCENTAGE save. It is stale the moment a rating lands or
--                Settings -> Pay Rate Multipliers is edited, which is why every
--                pay surface recomputes live and ignores it.
--   an ORDER     an admin typing a number into Employee pay, and the
--                BookingKoala CSV's "Provider/team payment" — the figure
--                BookingKoala actually paid the crew.
--
-- Because the app could not tell them apart it treated BOTH as stale, and the
-- job detail page printed "Stored value $88.55 — not used". That row is the
-- exact complaint in the PDF. This column separates the two meanings.
--
-- ── Why the default is FALSE and the backfill is deliberately narrow ────────
-- FALSE reproduces today's behaviour for every existing row, so the column can
-- land without moving a single payout.
--
-- The backfill is D2's rule verbatim: BookingKoala imports that carry a team
-- payment. Nothing else. That is a conscious refusal to be clever, because the
-- Stage 0 probe (_ai_context/TODO.md § 0.4b) measured what "broader" would cost:
-- 471 of 472 live jobs carry an `employeePay`, and the overwhelming majority of
-- those are PERCENTAGE snapshots. Flagging them manual would FREEZE every job in
-- the database at a stale save-time number and call it the admin's intent — a
-- silent, site-wide pay change, and precisely the staleness this codebase has
-- spent three rounds removing.
--
-- ── What that costs, stated rather than hidden ─────────────────────────────
-- On this database `bookingSource` is NULL on all 472 rows (0.4b), so the WHERE
-- below matches ZERO rows, and job #1809 — the PDF's booking 6919, whose stored
-- $88.55 the client circled — is NOT flagged by this migration. It is flagged by
-- an admin opening the job and confirming the figure, which is the "explicit
-- per-job admin action" the TODO names as the alternative and which Stage 4c.2
-- ships: the Employee pay field now posts a manual/automatic choice, and the
-- Financials card offers "Use this amount" on any stored figure that is being
-- superseded. One click per job, auditable in the job log, versus a bulk stamp
-- nobody can review.
--
-- Jobs imported from BookingKoala AFTER this deploy are stamped TRUE by the
-- importer itself (runBookingKoalaImport.ts / scripts/importBookingKoala.ts), so
-- the narrow backfill is a one-time gap, not an ongoing one.

ALTER TABLE "Job" ADD COLUMN "employeePayIsManual" BOOLEAN NOT NULL DEFAULT false;

-- D2: the CSV's provider/team payment is what BookingKoala actually paid the
-- crew, so it is an authoritative amount, not an estimate.
UPDATE "Job"
SET "employeePayIsManual" = true
WHERE "bookingSource" = 'bookingkoala_import'
  AND "employeePay" IS NOT NULL;

-- ── Post-deploy sanity check (Stage 7.1) ────────────────────────────────────
-- Same convention as 20260814000000_job_pricing_mode: no `RAISE NOTICE`, since
-- Prisma's migration engine discards Postgres notices. Run this read-only query
-- straight after `prisma migrate deploy` and record the result here.
--
--   SELECT "employeePayIsManual", count(*) FROM "Job" GROUP BY 1 ORDER BY 2 DESC;
--
-- Expected on the database the Stage 0 probe measured: 472 false, 0 true. A
-- non-zero true count means BookingKoala rows landed between the probe and the
-- deploy, which is fine — those are exactly the rows that should be on it.
