-- Per-organization job numbering.
--
-- Job.jobNumber came from one global sequence, so a second organization's first
-- job would have been #265. Each company now numbers its own jobs, allocated
-- from Organization.nextJobNumber by allocateJobNumber().
--
-- Existing jobs are NOT renumbered. Their numbers appear on invoices, in sent
-- emails and on printed job sheets; rewriting them would break every historical
-- reference for the sake of cosmetics. Instead each existing organization
-- continues from where it had reached, and organizations created from here on
-- start at 1.

ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "nextJobNumber" INTEGER NOT NULL DEFAULT 1;

-- Continue each existing organization from its highest job number.
UPDATE "Organization" o
   SET "nextJobNumber" = COALESCE(
         (SELECT MAX(j."jobNumber") FROM "Job" j WHERE j."organizationId" = o."id"),
         0
       ) + 1;

-- Stop the global sequence handing out numbers. The sequence object itself is
-- left in place; dropping it is irreversible and it costs nothing idle.
ALTER TABLE "Job" ALTER COLUMN "jobNumber" DROP DEFAULT;

-- Unique per organization rather than globally.
DROP INDEX IF EXISTS "Job_jobNumber_key";
CREATE UNIQUE INDEX "Job_organizationId_jobNumber_key" ON "Job"("organizationId", "jobNumber");
