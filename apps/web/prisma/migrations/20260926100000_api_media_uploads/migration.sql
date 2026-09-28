-- API v1, job media: the uploads the server signs (packages/api/src/v1/photos.ts).
--
-- Additive only: one new table, nothing existing is touched, so it is safe
-- against a live database and reverses by dropping the table.
--
--   MediaUpload  one row per signed Cloudinary upload. The server picks the
--                public_id and records it when it signs; attaching a photo
--                (or an issue report's photo) must find the row for THIS
--                person and THIS job, and marks it used in the same
--                transaction as the photo row, so one stored asset never
--                becomes two photos.

CREATE TABLE IF NOT EXISTS "MediaUpload" (
  "organizationId" TEXT NOT NULL DEFAULT '',
  "id"             TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "jobId"          TEXT NOT NULL,
  "purpose"        TEXT NOT NULL,
  "publicId"       TEXT NOT NULL,
  "contentType"    TEXT NOT NULL,
  "byteSize"       INTEGER NOT NULL,
  "expiresAt"      TIMESTAMP(3) NOT NULL,
  "usedAt"         TIMESTAMP(3),
  "photoId"        TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MediaUpload_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MediaUpload_organizationId_publicId_key"
  ON "MediaUpload" ("organizationId", "publicId");
CREATE INDEX IF NOT EXISTS "MediaUpload_organizationId_userId_createdAt_idx"
  ON "MediaUpload" ("organizationId", "userId", "createdAt");
CREATE INDEX IF NOT EXISTS "MediaUpload_jobId_idx" ON "MediaUpload" ("jobId");
CREATE INDEX IF NOT EXISTS "MediaUpload_organizationId_idx" ON "MediaUpload" ("organizationId");

ALTER TABLE "MediaUpload"
  ADD CONSTRAINT "MediaUpload_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaUpload"
  ADD CONSTRAINT "MediaUpload_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Tenant isolation, same shape as every other tenant table ────────────────

ALTER TABLE "MediaUpload"
  ADD CONSTRAINT "MediaUpload_organizationId_not_blank" CHECK ("organizationId" <> '');
ALTER TABLE "MediaUpload" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MediaUpload" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "MediaUpload_tenant_isolation" ON "MediaUpload";
CREATE POLICY "MediaUpload_tenant_isolation" ON "MediaUpload"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "MediaUpload" TO awer_app;
