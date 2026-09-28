-- Bookmops Pro: reporting and blocking in team chat (App Store guideline 1.2).
--
--   TeamChatBlock      one person blocking another: the blocked person's
--                      messages are left out of the blocker's lists, and no
--                      direct message either way (/api/v1/team/blocks)
--   TeamMessageReport  a message reported to the company's moderators, one
--                      per person per message
--                      (POST /api/v1/team/messages/:messageId/report)
--
-- Additive only: two new tables. Nothing existing changes; reverses by
-- dropping them.

-- ── TeamChatBlock ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "TeamChatBlock" (
  "organizationId" TEXT         NOT NULL DEFAULT '',
  "id"             TEXT         NOT NULL,
  "blockerId"      TEXT         NOT NULL,
  "blockedId"      TEXT         NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamChatBlock_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TeamChatBlock_not_self" CHECK ("blockerId" <> "blockedId")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TeamChatBlock_organizationId_blockerId_blockedId_key"
  ON "TeamChatBlock" ("organizationId", "blockerId", "blockedId");
CREATE INDEX IF NOT EXISTS "TeamChatBlock_blockedId_idx" ON "TeamChatBlock" ("blockedId");
CREATE INDEX IF NOT EXISTS "TeamChatBlock_organizationId_idx" ON "TeamChatBlock" ("organizationId");

ALTER TABLE "TeamChatBlock"
  ADD CONSTRAINT "TeamChatBlock_blockerId_fkey"
  FOREIGN KEY ("blockerId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamChatBlock"
  ADD CONSTRAINT "TeamChatBlock_blockedId_fkey"
  FOREIGN KEY ("blockedId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── TeamMessageReport ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "TeamMessageReport" (
  "organizationId" TEXT         NOT NULL DEFAULT '',
  "id"             TEXT         NOT NULL,
  "messageId"      TEXT         NOT NULL,
  "reporterId"     TEXT         NOT NULL,
  "senderId"       TEXT         NOT NULL,
  "reason"         TEXT         NOT NULL,
  "note"           TEXT,
  "status"         TEXT         NOT NULL DEFAULT 'OPEN',
  "clientEventId"  TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamMessageReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TeamMessageReport_organizationId_reporterId_messageId_key"
  ON "TeamMessageReport" ("organizationId", "reporterId", "messageId");
CREATE INDEX IF NOT EXISTS "TeamMessageReport_messageId_idx" ON "TeamMessageReport" ("messageId");
CREATE INDEX IF NOT EXISTS "TeamMessageReport_organizationId_status_idx"
  ON "TeamMessageReport" ("organizationId", "status");
CREATE INDEX IF NOT EXISTS "TeamMessageReport_organizationId_idx" ON "TeamMessageReport" ("organizationId");

ALTER TABLE "TeamMessageReport"
  ADD CONSTRAINT "TeamMessageReport_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "GroupMessage"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamMessageReport"
  ADD CONSTRAINT "TeamMessageReport_reporterId_fkey"
  FOREIGN KEY ("reporterId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Tenant isolation, the same shape as every other tenant table ────────────

ALTER TABLE "TeamChatBlock"
  ADD CONSTRAINT "TeamChatBlock_organizationId_not_blank" CHECK ("organizationId" <> '');
ALTER TABLE "TeamChatBlock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TeamChatBlock" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "TeamChatBlock_tenant_isolation" ON "TeamChatBlock";
CREATE POLICY "TeamChatBlock_tenant_isolation" ON "TeamChatBlock"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "TeamMessageReport"
  ADD CONSTRAINT "TeamMessageReport_organizationId_not_blank" CHECK ("organizationId" <> '');
ALTER TABLE "TeamMessageReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TeamMessageReport" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "TeamMessageReport_tenant_isolation" ON "TeamMessageReport";
CREATE POLICY "TeamMessageReport_tenant_isolation" ON "TeamMessageReport"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

-- Blocks come and go (unblocking deletes the row). Reports are a record: the
-- app role reads, makes and updates them (a moderator closing one), never
-- removes them.
REVOKE ALL ON "TeamChatBlock" FROM awer_app;
GRANT SELECT, INSERT, DELETE ON "TeamChatBlock" TO awer_app;
REVOKE ALL ON "TeamMessageReport" FROM awer_app;
GRANT SELECT, INSERT, UPDATE ON "TeamMessageReport" TO awer_app;
