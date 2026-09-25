-- Issues a cleaner reports from a job. One new table, nothing existing touched.
--
-- The category, urgency and status columns are TEXT rather than enums: they
-- mirror unions in src/lib/job-issues.ts, and a seventh category should be a
-- one-line edit rather than a migration and a deploy.

CREATE TABLE IF NOT EXISTS "JobIssue" (
  "organizationId" TEXT NOT NULL DEFAULT '',
  "id"             TEXT NOT NULL,
  "jobId"          TEXT NOT NULL,
  "reportedById"   TEXT,
  "reportedByName" TEXT NOT NULL,
  "category"       TEXT NOT NULL,
  "urgency"        TEXT NOT NULL DEFAULT 'NORMAL',
  "status"         TEXT NOT NULL DEFAULT 'OPEN',
  "description"    TEXT NOT NULL,
  "photoId"        TEXT,
  "photoUrl"       TEXT,
  "acknowledgedAt" TIMESTAMP(3),
  "resolvedAt"     TIMESTAMP(3),
  "resolvedById"   TEXT,
  "resolutionNote" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobIssue_pkey" PRIMARY KEY ("id")
);

-- The job page reads one job's issues newest-first; the admin queue reads the
-- workspace's open ones the same way.
CREATE INDEX IF NOT EXISTS "JobIssue_jobId_createdAt_idx"
  ON "JobIssue" ("jobId", "createdAt");
CREATE INDEX IF NOT EXISTS "JobIssue_organizationId_status_createdAt_idx"
  ON "JobIssue" ("organizationId", "status", "createdAt");
-- The queue's default view filters on nothing but the workspace. The index
-- above cannot serve it, because "status" sits between the two columns that
-- query needs.
CREATE INDEX IF NOT EXISTS "JobIssue_organizationId_createdAt_idx"
  ON "JobIssue" ("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "JobIssue_organizationId_idx"
  ON "JobIssue" ("organizationId");

ALTER TABLE "JobIssue"
  ADD CONSTRAINT "JobIssue_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation, same shape as every other tenant table.
ALTER TABLE "JobIssue"
  ADD CONSTRAINT "JobIssue_organizationId_not_blank" CHECK ("organizationId" <> '');
ALTER TABLE "JobIssue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobIssue" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "JobIssue_tenant_isolation" ON "JobIssue";
CREATE POLICY "JobIssue_tenant_isolation" ON "JobIssue"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "JobIssue" TO awer_app;
