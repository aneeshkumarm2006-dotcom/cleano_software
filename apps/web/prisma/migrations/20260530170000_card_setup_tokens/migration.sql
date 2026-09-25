-- One-time tokens for the /add-card/[token] public page.

CREATE TABLE IF NOT EXISTS "ClientCardSetupToken" (
  "id"        TEXT PRIMARY KEY,
  "clientId"  TEXT NOT NULL,
  "token"     TEXT NOT NULL UNIQUE,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "jobId"     TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "ClientCardSetupToken_clientId_idx"  ON "ClientCardSetupToken"("clientId");
CREATE INDEX IF NOT EXISTS "ClientCardSetupToken_expiresAt_idx" ON "ClientCardSetupToken"("expiresAt");
