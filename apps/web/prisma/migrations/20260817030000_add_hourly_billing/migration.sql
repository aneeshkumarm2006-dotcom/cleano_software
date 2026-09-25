-- Stage 8 of `_ai_context/TODO.md` — hourly jobs, first-class (PDF #8, p.6-7).
-- Implements step 8.1: `JobBillingType` + four `Job` columns.
--
-- ── Why ────────────────────────────────────────────────────────────────────
-- Customer-side hourly pricing did not exist. `Job.hourlyRate` is CLEANER PAY
-- (`payType = HOURLY`); the only auto-derived customer price was square
-- footage for move-in/out. So an admin taking an hourly booking had to work out
-- rate x hours on paper, type the product into `price`, and retype it by hand
-- every time the job ran long — which is the complaint PDF #8 records.
--
-- The names are deliberately NOT `hourlyRate`/`hours`. Two hourly numbers now
-- live on one row and they are different money:
--     Job.hourlyRate        what the CLEANER is paid per hour
--     Job.billedHourlyRate  what the CUSTOMER is charged per hour
-- Anything that blurs them is a pay bug or a billing bug, so the columns, the
-- labels and the two form sections all keep them apart (decision D6).
--
-- ── Blast radius ───────────────────────────────────────────────────────────
-- Additive only. Nothing is rewritten and nothing is dropped.
--   * `billingType` is NOT NULL DEFAULT 'FLAT', so every existing row lands on
--     FLAT — which IS today's behaviour: `computeJobMoney` only takes the
--     hourly branch for HOURLY, so a FLAT row prices exactly as it did before
--     this migration existed. No backfill is needed or wanted.
--   * The three Float columns are nullable and null on every existing row.
--   * No index: nothing filters or sorts on these. `billingType` has two
--     values, so an index on it would never be selective enough to be used.
-- No price, total, tax, payout or payment row is touched by this file.

CREATE TYPE "JobBillingType" AS ENUM ('FLAT', 'HOURLY');

ALTER TABLE "Job"
  ADD COLUMN "billingType" "JobBillingType" NOT NULL DEFAULT 'FLAT',
  ADD COLUMN "billedHourlyRate" DOUBLE PRECISION,
  ADD COLUMN "billedEstimatedHours" DOUBLE PRECISION,
  ADD COLUMN "billedActualHours" DOUBLE PRECISION;
