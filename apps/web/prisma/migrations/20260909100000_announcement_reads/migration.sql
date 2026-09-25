-- Who has seen an announcement. Additive: a new table only, so nothing
-- existing changes and there is no backfill. Announcements published before
-- this simply have no readers recorded, which is the truth.

CREATE TABLE IF NOT EXISTS "AnnouncementRead" (
  "organizationId" TEXT NOT NULL DEFAULT '',
  "id"             TEXT NOT NULL,
  "announcementId" TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "readAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnnouncementRead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AnnouncementRead_announcementId_userId_key"
  ON "AnnouncementRead" ("announcementId", "userId");
CREATE INDEX IF NOT EXISTS "AnnouncementRead_announcementId_idx"
  ON "AnnouncementRead" ("announcementId");
CREATE INDEX IF NOT EXISTS "AnnouncementRead_organizationId_idx"
  ON "AnnouncementRead" ("organizationId");

ALTER TABLE "AnnouncementRead"
  ADD CONSTRAINT "AnnouncementRead_announcementId_fkey"
  FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation, same shape as every other tenant table. A new table
-- without this is a table one company can read out of another's workspace.
ALTER TABLE "AnnouncementRead"
  ADD CONSTRAINT "AnnouncementRead_organizationId_not_blank" CHECK ("organizationId" <> '');
ALTER TABLE "AnnouncementRead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnnouncementRead" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "AnnouncementRead_tenant_isolation" ON "AnnouncementRead";
CREATE POLICY "AnnouncementRead_tenant_isolation" ON "AnnouncementRead"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "AnnouncementRead" TO awer_app;
