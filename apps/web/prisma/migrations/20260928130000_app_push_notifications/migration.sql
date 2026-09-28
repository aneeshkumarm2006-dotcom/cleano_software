-- Server-sent push notifications for Bookmops Pro (server/push).
--
-- Additive only: two new tables, nothing existing changes.
--
--   PushThrottle     when a person was last pushed about something that
--                    bursts (a team chat channel): at most one push per
--                    person and key per window, decided in one statement
--   PushJobReminder  the one-hour job reminder, sent once per person, job and
--                    start time (api/cron/job-reminders). A moved job gets a
--                    new reminder; the same one never repeats

-- ── PushThrottle ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "PushThrottle" (
  "organizationId" TEXT NOT NULL DEFAULT '',
  "id"             TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "key"            TEXT NOT NULL,
  "lastSentAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PushThrottle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PushThrottle_organizationId_userId_key_key"
  ON "PushThrottle" ("organizationId", "userId", "key");
CREATE INDEX IF NOT EXISTS "PushThrottle_userId_idx" ON "PushThrottle" ("userId");
CREATE INDEX IF NOT EXISTS "PushThrottle_organizationId_idx" ON "PushThrottle" ("organizationId");

ALTER TABLE "PushThrottle"
  ADD CONSTRAINT "PushThrottle_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── PushJobReminder ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "PushJobReminder" (
  "organizationId" TEXT NOT NULL DEFAULT '',
  "id"             TEXT NOT NULL,
  "jobId"          TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "startTime"      TIMESTAMP(3) NOT NULL,
  "sentAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushJobReminder_pkey" PRIMARY KEY ("id")
);

-- The marker itself: a second insert for the same reminder is refused.
CREATE UNIQUE INDEX IF NOT EXISTS "PushJobReminder_organizationId_jobId_userId_startTime_key"
  ON "PushJobReminder" ("organizationId", "jobId", "userId", "startTime");
CREATE INDEX IF NOT EXISTS "PushJobReminder_jobId_idx" ON "PushJobReminder" ("jobId");
CREATE INDEX IF NOT EXISTS "PushJobReminder_userId_idx" ON "PushJobReminder" ("userId");
CREATE INDEX IF NOT EXISTS "PushJobReminder_organizationId_idx" ON "PushJobReminder" ("organizationId");
CREATE INDEX IF NOT EXISTS "PushJobReminder_sentAt_idx" ON "PushJobReminder" ("sentAt");

ALTER TABLE "PushJobReminder"
  ADD CONSTRAINT "PushJobReminder_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PushJobReminder"
  ADD CONSTRAINT "PushJobReminder_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Tenant isolation, the same shape as every other tenant table ────────────

ALTER TABLE "PushThrottle"
  ADD CONSTRAINT "PushThrottle_organizationId_not_blank" CHECK ("organizationId" <> '');
ALTER TABLE "PushThrottle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PushThrottle" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "PushThrottle_tenant_isolation" ON "PushThrottle";
CREATE POLICY "PushThrottle_tenant_isolation" ON "PushThrottle"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "PushJobReminder"
  ADD CONSTRAINT "PushJobReminder_organizationId_not_blank" CHECK ("organizationId" <> '');
ALTER TABLE "PushJobReminder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PushJobReminder" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "PushJobReminder_tenant_isolation" ON "PushJobReminder";
CREATE POLICY "PushJobReminder_tenant_isolation" ON "PushJobReminder"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

-- The throttle row is moved forward in place; a reminder marker is written
-- once and never changed. Old markers are removed by the platform retention
-- cron, not by the tenant role.
REVOKE ALL ON "PushThrottle" FROM awer_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "PushThrottle" TO awer_app;
REVOKE ALL ON "PushJobReminder" FROM awer_app;
GRANT SELECT, INSERT ON "PushJobReminder" TO awer_app;
