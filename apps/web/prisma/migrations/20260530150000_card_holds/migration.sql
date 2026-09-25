-- Card hold lifecycle (Stripe manual-capture PaymentIntent per job).

ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "holdPaymentIntentId"   TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "holdPlacedAt"          TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "holdAmount"            DOUBLE PRECISION;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "holdCapturedAt"        TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "holdReleasedAt"        TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "holdCaptureFailedAt"   TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "holdCaptureFailReason" TEXT;
