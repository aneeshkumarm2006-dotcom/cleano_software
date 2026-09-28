-- API hardening: per-person request activity for the offline clock
-- (docs/architecture/API_V1.md §6).
--
-- Session.lastRequestAt held only a session's latest request, so a request
-- inside the 30 s reconnect grace overwrote the evidence that the phone was
-- online after a backdated tap, and a fresh sign-in had none at all. This
-- table keeps, per person and per minute, a 60-bit map of the seconds with an
-- authenticated request in them, for the last ~15 minutes.
--
-- Additive only: one new table. Session.lastRequestAt stays (unused).

CREATE TABLE IF NOT EXISTS "UserRequestActivity" (
  "organizationId" TEXT    NOT NULL DEFAULT '',
  "userId"         TEXT    NOT NULL,
  "minute"         INTEGER NOT NULL,
  "seconds"        BIGINT  NOT NULL DEFAULT 0,
  CONSTRAINT "UserRequestActivity_pkey" PRIMARY KEY ("organizationId", "userId", "minute")
);

CREATE INDEX IF NOT EXISTS "UserRequestActivity_minute_idx" ON "UserRequestActivity" ("minute");
CREATE INDEX IF NOT EXISTS "UserRequestActivity_userId_idx" ON "UserRequestActivity" ("userId");

ALTER TABLE "UserRequestActivity"
  ADD CONSTRAINT "UserRequestActivity_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation, the same shape as every other tenant table.
ALTER TABLE "UserRequestActivity"
  ADD CONSTRAINT "UserRequestActivity_organizationId_not_blank" CHECK ("organizationId" <> '');
ALTER TABLE "UserRequestActivity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserRequestActivity" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "UserRequestActivity_tenant_isolation" ON "UserRequestActivity";
CREATE POLICY "UserRequestActivity_tenant_isolation" ON "UserRequestActivity"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "UserRequestActivity" TO awer_app;
