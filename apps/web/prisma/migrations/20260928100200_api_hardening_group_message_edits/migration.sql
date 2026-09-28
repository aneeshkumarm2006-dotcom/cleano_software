-- API hardening: team-chat edit history.
--
-- Editing a team-chat message overwrote its body, so a message could be
-- changed after people had read and acted on it with no record of what it
-- said. Each edit now first writes the body it replaces here. Readable by
-- the office's moderators only (server/messages/team-chat.ts); never returned
-- to anyone else, the sender included.
--
-- Additive only: one new table. Rows are history: the app role may read and
-- add them, not change or remove them (a message's own deletion cascades).

CREATE TABLE IF NOT EXISTS "GroupMessageEdit" (
  "organizationId" TEXT         NOT NULL DEFAULT '',
  "id"             TEXT         NOT NULL,
  "messageId"      TEXT         NOT NULL,
  "previousBody"   TEXT         NOT NULL,
  "editedAt"       TIMESTAMP(3) NOT NULL,
  "editedById"     TEXT         NOT NULL,
  CONSTRAINT "GroupMessageEdit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "GroupMessageEdit_messageId_editedAt_idx"
  ON "GroupMessageEdit" ("messageId", "editedAt");
CREATE INDEX IF NOT EXISTS "GroupMessageEdit_organizationId_idx"
  ON "GroupMessageEdit" ("organizationId");

ALTER TABLE "GroupMessageEdit"
  ADD CONSTRAINT "GroupMessageEdit_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "GroupMessage"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation, the same shape as every other tenant table.
ALTER TABLE "GroupMessageEdit"
  ADD CONSTRAINT "GroupMessageEdit_organizationId_not_blank" CHECK ("organizationId" <> '');
ALTER TABLE "GroupMessageEdit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GroupMessageEdit" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "GroupMessageEdit_tenant_isolation" ON "GroupMessageEdit";
CREATE POLICY "GroupMessageEdit_tenant_isolation" ON "GroupMessageEdit"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

REVOKE ALL ON "GroupMessageEdit" FROM awer_app;
GRANT SELECT, INSERT ON "GroupMessageEdit" TO awer_app;
