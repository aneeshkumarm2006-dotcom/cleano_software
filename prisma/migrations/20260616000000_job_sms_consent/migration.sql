-- SMS notification consent captured at booking time (additive column only).
-- Existing rows default to true to preserve current notification behavior.
ALTER TABLE "Job" ADD COLUMN "smsConsent" BOOLEAN NOT NULL DEFAULT true;
