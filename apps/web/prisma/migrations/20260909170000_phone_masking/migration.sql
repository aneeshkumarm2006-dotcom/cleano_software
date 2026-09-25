-- Phone masking (fix list #6). Two new tables, nothing existing touched.
--
-- ProxyNumber is the pool of company numbers a workspace has bought;
-- MaskedContact is one live cleaner <-> customer pairing carried by one of
-- them. Both are ordinary tenant tables, isolated the same way as every other.

CREATE TABLE IF NOT EXISTS "ProxyNumber" (
  "organizationId" TEXT NOT NULL DEFAULT '',
  "id"             TEXT NOT NULL,
  "phoneNumber"    TEXT NOT NULL,
  "label"          TEXT,
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProxyNumber_pkey" PRIMARY KEY ("id")
);

-- Globally unique, not unique-per-organization, for the same reason
-- "Organization"."smsNumber" is: an inbound call tells us the number that was
-- dialled and nothing else, so this column is the only routing key there is.
CREATE UNIQUE INDEX IF NOT EXISTS "ProxyNumber_phoneNumber_key"
  ON "ProxyNumber" ("phoneNumber");
-- Allocation reads one workspace's usable numbers and nothing else.
CREATE INDEX IF NOT EXISTS "ProxyNumber_organizationId_isActive_idx"
  ON "ProxyNumber" ("organizationId", "isActive");
CREATE INDEX IF NOT EXISTS "ProxyNumber_organizationId_idx"
  ON "ProxyNumber" ("organizationId");

CREATE TABLE IF NOT EXISTS "MaskedContact" (
  "organizationId" TEXT NOT NULL DEFAULT '',
  "id"             TEXT NOT NULL,
  "jobId"          TEXT NOT NULL,
  "cleanerId"      TEXT NOT NULL,
  "clientId"       TEXT,
  "proxyNumberId"  TEXT NOT NULL,
  "cleanerPhone"   TEXT NOT NULL,
  "clientPhone"    TEXT NOT NULL,
  "expiresAt"      TIMESTAMP(3) NOT NULL,
  "lastUsedAt"     TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MaskedContact_pkey" PRIMARY KEY ("id")
);

-- The two constraints that make the reverse lookup answerable. An inbound
-- message gives us only (To = proxy, From = one participant); if one proxy
-- number carried two pairings involving the same phone, "who did they mean?"
-- would have no answer. These also catch the allocation race: two cleaners
-- picking the same free number at the same instant collide here rather than
-- both writing a row.
CREATE UNIQUE INDEX IF NOT EXISTS "MaskedContact_proxyNumberId_cleanerPhone_key"
  ON "MaskedContact" ("proxyNumberId", "cleanerPhone");
CREATE UNIQUE INDEX IF NOT EXISTS "MaskedContact_proxyNumberId_clientPhone_key"
  ON "MaskedContact" ("proxyNumberId", "clientPhone");
-- "Does this cleaner already have a live number for this job?" — the reuse
-- check that runs before every allocation.
CREATE INDEX IF NOT EXISTS "MaskedContact_jobId_cleanerId_idx"
  ON "MaskedContact" ("jobId", "cleanerId");
-- The expiry sweep, which is what returns numbers to the pool.
CREATE INDEX IF NOT EXISTS "MaskedContact_organizationId_expiresAt_idx"
  ON "MaskedContact" ("organizationId", "expiresAt");
CREATE INDEX IF NOT EXISTS "MaskedContact_organizationId_idx"
  ON "MaskedContact" ("organizationId");
-- No separate index on "proxyNumberId": the unique indexes above lead with it,
-- which is what serves both the join from ProxyNumber and the reverse lookup.

ALTER TABLE "MaskedContact"
  ADD CONSTRAINT "MaskedContact_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MaskedContact"
  ADD CONSTRAINT "MaskedContact_proxyNumberId_fkey"
  FOREIGN KEY ("proxyNumberId") REFERENCES "ProxyNumber"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation, same shape as every other tenant table.
ALTER TABLE "ProxyNumber"
  ADD CONSTRAINT "ProxyNumber_organizationId_not_blank" CHECK ("organizationId" <> '');
ALTER TABLE "ProxyNumber" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProxyNumber" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ProxyNumber_tenant_isolation" ON "ProxyNumber";
CREATE POLICY "ProxyNumber_tenant_isolation" ON "ProxyNumber"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

ALTER TABLE "MaskedContact"
  ADD CONSTRAINT "MaskedContact_organizationId_not_blank" CHECK ("organizationId" <> '');
ALTER TABLE "MaskedContact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MaskedContact" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "MaskedContact_tenant_isolation" ON "MaskedContact";
CREATE POLICY "MaskedContact_tenant_isolation" ON "MaskedContact"
  USING ("organizationId" = current_setting('app.current_org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "ProxyNumber" TO awer_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "MaskedContact" TO awer_app;
