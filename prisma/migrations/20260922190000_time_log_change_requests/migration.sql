-- Sept 17 list, item 19: a cleaner asking for their clock times to be corrected.
--
-- Additive: one new table. No existing table is altered and no row is
-- rewritten, so this is safe against a live database and reverses by dropping
-- the table.
--
-- A request changes no payroll by itself — it is a proposal, and approving it
-- is what applies the change, through the same updateClockTimes path an admin
-- already uses. So an empty table is exactly today's behaviour.

CREATE TABLE IF NOT EXISTS "TimeLogChangeRequest" (
  "organizationId" TEXT NOT NULL DEFAULT '',
  "id"             TEXT NOT NULL,
  "jobId"          TEXT NOT NULL,
  "cleanerId"      TEXT NOT NULL,
  "sessionId"      TEXT,
  "originalStart"  TIMESTAMP(3),
  "originalEnd"    TIMESTAMP(3),
  "requestedStart" TIMESTAMP(3),
  "requestedEnd"   TIMESTAMP(3),
  "reason"         TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'PENDING',
  "decidedById"    TEXT,
  "decidedAt"      TIMESTAMP(3),
  "decisionNote"   TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TimeLogChangeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TimeLogChangeRequest_status_createdAt_idx"
  ON "TimeLogChangeRequest" ("status", "createdAt");
CREATE INDEX IF NOT EXISTS "TimeLogChangeRequest_jobId_idx"
  ON "TimeLogChangeRequest" ("jobId");
CREATE INDEX IF NOT EXISTS "TimeLogChangeRequest_cleanerId_idx"
  ON "TimeLogChangeRequest" ("cleanerId");
CREATE INDEX IF NOT EXISTS "TimeLogChangeRequest_organizationId_idx"
  ON "TimeLogChangeRequest" ("organizationId");

ALTER TABLE "TimeLogChangeRequest"
  ADD CONSTRAINT "TimeLogChangeRequest_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimeLogChangeRequest"
  ADD CONSTRAINT "TimeLogChangeRequest_cleanerId_fkey"
  FOREIGN KEY ("cleanerId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation, same shape as every other tenant table. A new table
-- without this is a table one company can read out of another's workspace,
-- and scripts/verify-rls-coverage.ts turns the omission into a red build.
ALTER TABLE "TimeLogChangeRequest"
  ADD CONSTRAINT "TimeLogChangeRequest_organizationId_not_blank" CHECK ("organizationId" <> '');
ALTER TABLE "TimeLogChangeRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TimeLogChangeRequest" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "TimeLogChangeRequest_tenant_isolation" ON "TimeLogChangeRequest";
CREATE POLICY "TimeLogChangeRequest_tenant_isolation" ON "TimeLogChangeRequest"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "TimeLogChangeRequest" TO awer_app;
