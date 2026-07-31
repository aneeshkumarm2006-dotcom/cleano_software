-- AwerNewFixes.pdf item 5 — admin can exclude a star rating from a cleaner's score.
--
-- Soft exclusion, not deletion: the row survives so admins keep the record of
-- what was rated and why it was pulled. Every average / count / pay-tier read
-- filters on "excludedAt" IS NULL. Existing ratings stay active (NULL).

ALTER TABLE "EmployeeRating" ADD COLUMN "excludedAt" TIMESTAMP(3);
ALTER TABLE "EmployeeRating" ADD COLUMN "excludedById" TEXT;
ALTER TABLE "EmployeeRating" ADD COLUMN "excludedReason" TEXT;

-- Averages are always computed over the active subset, so index it.
CREATE INDEX "EmployeeRating_employeeId_excludedAt_idx" ON "EmployeeRating"("employeeId", "excludedAt");
