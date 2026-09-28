-- API v1, the foundation (docs/architecture/API_V1.md §6, §7).
--
-- Additive only. Two new tables; nullable audit columns on four existing ones;
-- one column with a constant default. No row is rewritten and nothing the web
-- reads changes meaning, so this is safe against a live database and reverses
-- by dropping what it adds.
--
--   IdempotencyRecord  a retried phone mutation is applied once
--   PushDevice         push notification tokens, per company and person
--   Session.lastRequestAt
--                      the last authenticated /api/v1 request on a session;
--                      disproves an "I was offline" clock event
--   JobWorkSession / JobBreak  clientEventId, receivedAt (+ end*)
--                      which phone event opened/closed the row, and when it
--                      reached the server
--   TimeLogChangeRequest  source, eventKind, clientEventId, occurredAt,
--                      receivedAt, breakId: a clock event whose claimed time
--                      was not applied as sent becomes a correction request
--                      the office approves (source = 'PHONE').

-- ── Existing tables ─────────────────────────────────────────────────────────

ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "lastRequestAt" TIMESTAMP(3);

ALTER TABLE "JobWorkSession"
  ADD COLUMN IF NOT EXISTS "clientEventId" TEXT,
  ADD COLUMN IF NOT EXISTS "receivedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "endClientEventId" TEXT,
  ADD COLUMN IF NOT EXISTS "endReceivedAt" TIMESTAMP(3);

ALTER TABLE "JobBreak"
  ADD COLUMN IF NOT EXISTS "clientEventId" TEXT,
  ADD COLUMN IF NOT EXISTS "receivedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "endClientEventId" TEXT,
  ADD COLUMN IF NOT EXISTS "endReceivedAt" TIMESTAMP(3);

ALTER TABLE "TimeLogChangeRequest"
  ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'CLEANER',
  ADD COLUMN IF NOT EXISTS "eventKind" TEXT,
  ADD COLUMN IF NOT EXISTS "clientEventId" TEXT,
  ADD COLUMN IF NOT EXISTS "occurredAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "receivedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "breakId" TEXT;

-- One correction request per phone event. NULLs are distinct, so every
-- existing (web) row is unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS "TimeLogChangeRequest_organizationId_clientEventId_key"
  ON "TimeLogChangeRequest" ("organizationId", "clientEventId");

-- ── IdempotencyRecord ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "IdempotencyRecord" (
  "organizationId" TEXT NOT NULL DEFAULT '',
  "id"             TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "key"            TEXT NOT NULL,
  "route"          TEXT NOT NULL,
  "requestHash"    TEXT NOT NULL,
  "state"          TEXT NOT NULL DEFAULT 'IN_FLIGHT',
  "statusCode"     INTEGER,
  "responseBody"   JSONB,
  "expiresAt"      TIMESTAMP(3) NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- The scope that makes a key safe: company, person, key. Two people choosing
-- the same key never see each other's answer.
CREATE UNIQUE INDEX IF NOT EXISTS "IdempotencyRecord_organizationId_userId_key_key"
  ON "IdempotencyRecord" ("organizationId", "userId", "key");
CREATE INDEX IF NOT EXISTS "IdempotencyRecord_expiresAt_idx"
  ON "IdempotencyRecord" ("expiresAt");
CREATE INDEX IF NOT EXISTS "IdempotencyRecord_organizationId_idx"
  ON "IdempotencyRecord" ("organizationId");

ALTER TABLE "IdempotencyRecord"
  ADD CONSTRAINT "IdempotencyRecord_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── PushDevice ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "PushDevice" (
  "organizationId" TEXT NOT NULL DEFAULT '',
  "id"             TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "token"          TEXT NOT NULL,
  "platform"       TEXT NOT NULL,
  "appVersion"     TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PushDevice_organizationId_token_key"
  ON "PushDevice" ("organizationId", "token");
CREATE INDEX IF NOT EXISTS "PushDevice_userId_idx" ON "PushDevice" ("userId");
CREATE INDEX IF NOT EXISTS "PushDevice_organizationId_idx" ON "PushDevice" ("organizationId");

ALTER TABLE "PushDevice"
  ADD CONSTRAINT "PushDevice_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Tenant isolation, same shape as every other tenant table ────────────────
-- A new table without this is a table one company can read out of another's
-- workspace, and scripts/verify-rls-coverage.ts turns the omission into a red
-- build.

ALTER TABLE "IdempotencyRecord"
  ADD CONSTRAINT "IdempotencyRecord_organizationId_not_blank" CHECK ("organizationId" <> '');
ALTER TABLE "IdempotencyRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IdempotencyRecord" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "IdempotencyRecord_tenant_isolation" ON "IdempotencyRecord";
CREATE POLICY "IdempotencyRecord_tenant_isolation" ON "IdempotencyRecord"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "PushDevice"
  ADD CONSTRAINT "PushDevice_organizationId_not_blank" CHECK ("organizationId" <> '');
ALTER TABLE "PushDevice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PushDevice" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "PushDevice_tenant_isolation" ON "PushDevice";
CREATE POLICY "PushDevice_tenant_isolation" ON "PushDevice"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "IdempotencyRecord" TO awer_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "PushDevice" TO awer_app;
