-- Adds no-show tracking to Client and late-arrival rating cap to Job.
-- All columns nullable / defaulted so it's a safe additive migration.

ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "noShowCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "lastNoShowAt" TIMESTAMP(3);

ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "noShowAt" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "lateArrivalAt" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "lateArrivalRatingCap" DOUBLE PRECISION;

ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "washReviewOverrideAt" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "washReviewOverrideBy" TEXT;
