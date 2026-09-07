-- Awer's own billing: the columns that let a workspace be charged.
-- Additive only. Every column has a default or is nullable, so existing
-- subscriptions keep working unchanged and the deploy needs no backfill.

CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'ANNUAL');

ALTER TABLE "Subscription"
  ADD COLUMN IF NOT EXISTS "interval" "BillingInterval" NOT NULL DEFAULT 'MONTHLY',
  ADD COLUMN IF NOT EXISTS "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "trialReminderSentAt" TIMESTAMP(3);
