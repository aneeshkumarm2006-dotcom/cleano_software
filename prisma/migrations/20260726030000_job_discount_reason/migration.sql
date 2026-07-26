-- awer_fixes.pdf item 29 — discount reason on a job.
--
-- Nullable with no default and no backfill: the spec says existing discounts
-- without a reason may stay blank, and inventing a reason for a historical
-- discount would put a guess into reporting. The UI renders NULL as
-- "No reason assigned".

ALTER TABLE "Job" ADD COLUMN "discountReason" TEXT;
