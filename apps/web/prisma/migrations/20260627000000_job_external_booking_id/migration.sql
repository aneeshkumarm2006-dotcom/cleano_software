-- External source booking id (BookingKoala "Booking id") — idempotency key for
-- imports so concurrent same-time jobs aren't deduped away. Additive, nullable.
ALTER TABLE "Job" ADD COLUMN "externalBookingId" TEXT;
CREATE INDEX "Job_externalBookingId_idx" ON "Job"("externalBookingId");
