-- Bookmops Pro: "Delete my account" requests (App Store guideline 5.1.1(v)).
--
-- A staff account belongs to the employer, and pay and tax records must be
-- kept, so the app sends the company a request rather than deleting anything
-- (POST /api/v1/me/deletion-request). One row per person.
--
-- Additive only: one new table. Nothing existing changes; reverses by
-- dropping it.

CREATE TABLE IF NOT EXISTS "AccountDeletionRequest" (
  "organizationId" TEXT         NOT NULL DEFAULT '',
  "id"             TEXT         NOT NULL,
  "userId"         TEXT         NOT NULL,
  "reason"         TEXT,
  "status"         TEXT         NOT NULL DEFAULT 'PENDING',
  "clientEventId"  TEXT,
  "requestedAt"    TIMESTAMP(3) NOT NULL,
  "handledAt"      TIMESTAMP(3),
  "handledById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AccountDeletionRequest_organizationId_userId_key"
  ON "AccountDeletionRequest" ("organizationId", "userId");
CREATE INDEX IF NOT EXISTS "AccountDeletionRequest_organizationId_status_idx"
  ON "AccountDeletionRequest" ("organizationId", "status");
CREATE INDEX IF NOT EXISTS "AccountDeletionRequest_organizationId_idx"
  ON "AccountDeletionRequest" ("organizationId");

ALTER TABLE "AccountDeletionRequest"
  ADD CONSTRAINT "AccountDeletionRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation, the same shape as every other tenant table.
ALTER TABLE "AccountDeletionRequest"
  ADD CONSTRAINT "AccountDeletionRequest_organizationId_not_blank" CHECK ("organizationId" <> '');
ALTER TABLE "AccountDeletionRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AccountDeletionRequest" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "AccountDeletionRequest_tenant_isolation" ON "AccountDeletionRequest";
CREATE POLICY "AccountDeletionRequest_tenant_isolation" ON "AccountDeletionRequest"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

-- Requests are a record: the app role reads, makes and updates them (the
-- office marking one handled), never removes them.
REVOKE ALL ON "AccountDeletionRequest" FROM awer_app;
GRANT SELECT, INSERT, UPDATE ON "AccountDeletionRequest" TO awer_app;
