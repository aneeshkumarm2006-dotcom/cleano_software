-- Booking ↔ payment binding.
--
-- Two additive changes, both reversible with no data loss:
--
--   1. UNIQUE on Job.depositPaymentIntentId — makes the deposit intent the
--      booking's idempotency key. Closes the replay race where two concurrent
--      requests both verify the same paid intent and each create a booking.
--      Postgres permits multiple NULLs under a UNIQUE index, so admin-created,
--      BookingKoala-imported and recurring child jobs (all NULL) are unaffected.
--
--   2. Job.stripePaymentMethodId — the card a booking is pinned to at
--      confirmation time. Nullable with no backfill on purpose: NULL means
--      "not pinned", and every charge path falls back to the client's current
--      default, which is precisely the pre-migration behaviour. Existing rows
--      therefore change behaviour not at all.
--
-- PRE-FLIGHT (must return zero rows before applying to production):
--   SELECT "depositPaymentIntentId", count(*)
--     FROM "Job"
--    WHERE "depositPaymentIntentId" IS NOT NULL
--    GROUP BY 1 HAVING count(*) > 1;
--
-- ROLLBACK:
--   DROP INDEX "Job_depositPaymentIntentId_key";
--   ALTER TABLE "Job" DROP COLUMN "stripePaymentMethodId";

ALTER TABLE "Job" ADD COLUMN "stripePaymentMethodId" TEXT;

CREATE UNIQUE INDEX "Job_depositPaymentIntentId_key"
  ON "Job"("depositPaymentIntentId");

-- Charge paths resolve a job's card by this column; index the lookup used when
-- reconciling a payment method back to the bookings attached to it.
CREATE INDEX "Job_stripePaymentMethodId_idx"
  ON "Job"("stripePaymentMethodId");
