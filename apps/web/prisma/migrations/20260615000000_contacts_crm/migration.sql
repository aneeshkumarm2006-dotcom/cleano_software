-- Unified Contacts CRM (additive). Creates Contact + ContactActivity and their
-- enums, then backfills one Contact per existing Client and per non-converted
-- Lead. Existing tables are NOT altered (the reverse relations are virtual).

-- CreateEnum
CREATE TYPE "LifecycleStage" AS ENUM ('NEW_LEAD', 'QUALIFIED', 'BOOKED', 'ACTIVE', 'RETURNING', 'PAST', 'LOST', 'APPLICANT', 'CLEANER', 'DNC');

-- CreateEnum
CREATE TYPE "ContactActivityType" AS ENUM ('NOTE', 'EMAIL', 'SMS', 'CALL', 'BOOKING', 'RATING', 'CANCEL', 'LIFECYCLE', 'CREATE');

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "lifecycle" "LifecycleStage" NOT NULL DEFAULT 'NEW_LEAD',
    "source" TEXT,
    "sourceDetail" TEXT,
    "latestSource" TEXT,
    "campaign" TEXT,
    "ownerId" TEXT,
    "leadScore" INTEGER,
    "nextStep" TEXT,
    "nextStepDue" TIMESTAMP(3),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "props" JSONB,
    "ratingAvg" DOUBLE PRECISION,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "lifetimeValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bookingsCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateDismissed" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "clientId" TEXT,
    "leadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactActivity" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "type" "ContactActivityType" NOT NULL DEFAULT 'NOTE',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "actor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Contact_clientId_key" ON "Contact"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_leadId_key" ON "Contact"("leadId");

-- CreateIndex
CREATE INDEX "Contact_lifecycle_idx" ON "Contact"("lifecycle");

-- CreateIndex
CREATE INDEX "Contact_ownerId_idx" ON "Contact"("ownerId");

-- CreateIndex
CREATE INDEX "Contact_lastActivityAt_idx" ON "Contact"("lastActivityAt");

-- CreateIndex
CREATE INDEX "Contact_email_idx" ON "Contact"("email");

-- CreateIndex
CREATE INDEX "Contact_phone_idx" ON "Contact"("phone");

-- CreateIndex
CREATE INDEX "ContactActivity_contactId_idx" ON "ContactActivity"("contactId");

-- CreateIndex
CREATE INDEX "ContactActivity_createdAt_idx" ON "ContactActivity"("createdAt");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactActivity" ADD CONSTRAINT "ContactActivity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────────────────────────────────────────────────────────────────────
-- Backfill: one Contact per Client. Lifecycle is a coarse first guess from
-- isActive + job history; admins refine it in the CRM afterwards.
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO "Contact" (
  "id", "name", "email", "phone", "address", "lifecycle",
  "tags", "clientId", "createdAt", "updatedAt", "lastActivityAt"
)
SELECT
  gen_random_uuid()::text,
  c."name",
  c."email",
  c."phone",
  NULLIF(TRIM(BOTH ', ' FROM CONCAT_WS(', ',
    NULLIF(c."address", ''), NULLIF(c."city", ''), NULLIF(c."state", ''), NULLIF(c."zip", '')
  )), ''),
  CASE
    WHEN EXISTS (SELECT 1 FROM "Job" j WHERE j."clientId" = c."id" AND j."status" IN ('COMPLETED', 'PAID'))
      THEN (CASE WHEN c."isActive" THEN 'RETURNING'::"LifecycleStage" ELSE 'PAST'::"LifecycleStage" END)
    WHEN c."isActive" THEN 'ACTIVE'::"LifecycleStage"
    ELSE 'PAST'::"LifecycleStage"
  END,
  CASE WHEN c."clientType" = 'COMMERCIAL' THEN ARRAY['Commercial']::TEXT[] ELSE ARRAY[]::TEXT[] END,
  c."id",
  c."createdAt",
  c."updatedAt",
  c."updatedAt"
FROM "Client" c
WHERE NOT EXISTS (SELECT 1 FROM "Contact" ct WHERE ct."clientId" = c."id");

-- Backfill: one Contact per non-converted Lead (converted leads are covered by
-- their Client row above).
INSERT INTO "Contact" (
  "id", "name", "email", "phone", "lifecycle", "source",
  "clientId", "leadId", "createdAt", "updatedAt", "lastActivityAt"
)
SELECT
  gen_random_uuid()::text,
  COALESCE(NULLIF(l."name", ''), l."email"),
  l."email",
  l."phone",
  CASE l."status"
    WHEN 'NEW' THEN 'NEW_LEAD'::"LifecycleStage"
    WHEN 'CONTACTED' THEN 'QUALIFIED'::"LifecycleStage"
    WHEN 'DEAD' THEN 'LOST'::"LifecycleStage"
    WHEN 'OUT_OF_AREA' THEN 'LOST'::"LifecycleStage"
    ELSE 'NEW_LEAD'::"LifecycleStage"
  END,
  l."source",
  NULL,
  l."id",
  l."createdAt",
  l."updatedAt",
  l."lastActivityAt"
FROM "Lead" l
WHERE l."status" <> 'CONVERTED'
  AND NOT EXISTS (SELECT 1 FROM "Contact" ct WHERE ct."leadId" = l."id");
