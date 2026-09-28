-- The in-app notification feed. Two new tables, nothing existing touched.
--
-- One row per EVENT (Notification), plus one row per person who has seen it
-- (NotificationRead), so five admins share a notification and each clears
-- their own badge.

CREATE TABLE IF NOT EXISTS "Notification" (
  "organizationId"  TEXT NOT NULL DEFAULT '',
  "id"              TEXT NOT NULL,
  "notificationKey" TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  "body"            TEXT,
  "href"            TEXT,
  "severity"        TEXT NOT NULL DEFAULT 'INFO',
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Notification_organizationId_createdAt_idx"
  ON "Notification" ("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_organizationId_idx"
  ON "Notification" ("organizationId");

CREATE TABLE IF NOT EXISTS "NotificationRead" (
  "organizationId" TEXT NOT NULL DEFAULT '',
  "id"             TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "readAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationRead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "NotificationRead_notificationId_userId_key"
  ON "NotificationRead" ("notificationId", "userId");
CREATE INDEX IF NOT EXISTS "NotificationRead_notificationId_idx"
  ON "NotificationRead" ("notificationId");
CREATE INDEX IF NOT EXISTS "NotificationRead_organizationId_idx"
  ON "NotificationRead" ("organizationId");

ALTER TABLE "NotificationRead"
  ADD CONSTRAINT "NotificationRead_notificationId_fkey"
  FOREIGN KEY ("notificationId") REFERENCES "Notification"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation, same shape as every other tenant table.
ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_organizationId_not_blank" CHECK ("organizationId" <> '');
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Notification_tenant_isolation" ON "Notification";
CREATE POLICY "Notification_tenant_isolation" ON "Notification"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "NotificationRead"
  ADD CONSTRAINT "NotificationRead_organizationId_not_blank" CHECK ("organizationId" <> '');
ALTER TABLE "NotificationRead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationRead" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "NotificationRead_tenant_isolation" ON "NotificationRead";
CREATE POLICY "NotificationRead_tenant_isolation" ON "NotificationRead"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "Notification" TO awer_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "NotificationRead" TO awer_app;
