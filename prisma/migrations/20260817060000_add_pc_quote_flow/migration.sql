-- Stage 11 of `_ai_context/TODO.md` — post-construction deposit + photo quote
-- flow (cleano_inventory_operations_fixes.pdf #9, p.7). Implements step 11.1.
--
-- ── Why ────────────────────────────────────────────────────────────────────
-- A post-construction booking was priced INSTANTLY off two steppers the customer
-- guessed at (`max(4, hours) x $50 x cleaners`), charged the same flat $20
-- deposit as a one-bedroom apartment, and then threw both numbers away:
-- `submitBooking`'s `db.job.create` wrote neither `pcHours` nor `pcCleaners` and
-- hardcoded `requiredCleaners: 1`. Nothing downstream could reconstruct the
-- quote, staff the crew the customer had asked for, or refund the right deposit.
--
-- PDF #9 asks for the opposite shape: take a real deposit up front (example
-- $200), collect photos of the space, treat the booking as a QUOTE REQUEST until
-- an admin has looked at those photos, then send a final price.
--
-- This migration adds the columns that state needs, plus the one relaxation the
-- photos need.
--
-- ── Blast radius ───────────────────────────────────────────────────────────
-- Additive, plus one NOT NULL drop. Nothing is rewritten, nothing is dropped, no
-- price/total/tax/payout column changes value, and there is no backfill.
--
--   * `Job.depositAmount` stays NULL on every existing row. That is READ as $20
--     by `resolveDepositCredit()` (src/lib/booking-deposit.ts) — not as a guess,
--     but because the deposit WAS the hardcoded constant 20 for the whole life of
--     the old flow, so every historical row credits and refunds exactly what it
--     credited and refunded yesterday.
--   * `Job.quoteStatus` / `quotedAt` stay NULL, which means "not a quote". Every
--     surface that consults them treats NULL as an ordinary job, so no existing
--     booking becomes invisible to cleaners or unschedulable.
--   * `Job.pcHours` / `pcCleaners` stay NULL. No backfill is possible: the two
--     numbers were never stored, and the price they produced can't be inverted
--     (four different hour/crew pairs give $400). `requiredCleaners` on those
--     rows keeps whatever it has.
--   * `JobPhoto.employeeId` becomes nullable. Every existing row has a value, so
--     nothing changes for cleaner-uploaded photos; NULL is reserved for the new
--     "the customer uploaded this at booking" case. The FK stays ON DELETE
--     CASCADE, which can now only ever fire for a staff-uploaded photo.
--
-- ── Why quoteStatus is not part of JobStatus ───────────────────────────────
-- `JobStatus` drives clock-in, payroll, invoicing, both calendars, the cleaner
-- app and about a dozen admin filters. Two new values there would put every one
-- of those paths in the blast radius of a quote. A parallel nullable column is
-- opt-in: only the surfaces listed in step 11.7 consult it.
--
-- ── Indexes ────────────────────────────────────────────────────────────────
-- One partial index on `quoteStatus`. Partial because the column is NULL for
-- ~100% of rows and the only query that filters on it is the admin review queue
-- ("show me the quotes"), which wants precisely the non-NULL rows. A plain index
-- would be almost entirely NULL entries the planner would never use. The
-- cleaner-facing guards filter it the other way (NULL or ACCEPTED = visible) and
-- are always combined with a far more selective predicate — the cleaner's own id
-- — so they need no index of their own.

CREATE TYPE "QuoteStatus" AS ENUM ('PENDING_REVIEW', 'QUOTED', 'ACCEPTED', 'DECLINED');

ALTER TABLE "Job"
  ADD COLUMN "depositAmount" DOUBLE PRECISION,
  ADD COLUMN "quoteStatus"   "QuoteStatus",
  ADD COLUMN "quotedAt"      TIMESTAMP(3),
  ADD COLUMN "pcHours"       DOUBLE PRECISION,
  ADD COLUMN "pcCleaners"    INTEGER;

CREATE INDEX "Job_quoteStatus_idx" ON "Job"("quoteStatus") WHERE "quoteStatus" IS NOT NULL;

-- The public booking flow has no `User` row to attribute a photo to: the booker
-- is a guest and no crew is assigned yet. This is the constraint that forced the
-- earlier round of fixes to ship photo PROMPTS instead of photo UPLOADS.
ALTER TABLE "JobPhoto" ALTER COLUMN "employeeId" DROP NOT NULL;
