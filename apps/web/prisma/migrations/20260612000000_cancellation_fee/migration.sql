-- Late-cancellation fee fields on Job (additive, nullable).
-- `cancellationFeeChargedAt` makes the off-session charge idempotent.
ALTER TABLE "Job" ADD COLUMN "cancellationFeeChargedAt" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN "cancellationFeePaymentIntentId" TEXT;
