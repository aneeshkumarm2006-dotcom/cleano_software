-- Quote request landing page submissions.

DO $$ BEGIN
  CREATE TYPE "QuoteRequestStatus" AS ENUM ('NEW', 'CONTACTED', 'CONVERTED', 'ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "QuoteRequest" (
  "id"            TEXT PRIMARY KEY,
  "name"          TEXT NOT NULL,
  "email"         TEXT NOT NULL,
  "phone"         TEXT,
  "address"       TEXT,
  "serviceType"   TEXT,
  "bedCount"      INTEGER,
  "bathCount"     INTEGER,
  "squareFootage" INTEGER,
  "preferredDate" TIMESTAMP(3),
  "message"       TEXT,
  "status"        "QuoteRequestStatus" NOT NULL DEFAULT 'NEW',
  "source"        TEXT,
  "notes"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "QuoteRequest_status_idx"    ON "QuoteRequest"("status");
CREATE INDEX IF NOT EXISTS "QuoteRequest_createdAt_idx" ON "QuoteRequest"("createdAt");
