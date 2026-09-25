-- Cleaner payroll tier (Trainee / Standard / Field Lead)
CREATE TYPE "CleanerTier" AS ENUM ('TRAINEE', 'STANDARD', 'FIELD_LEAD');
ALTER TABLE "User" ADD COLUMN "cleanerTier" "CleanerTier" NOT NULL DEFAULT 'STANDARD';

-- "On My Way" + optional geolocation snapshot on the job
ALTER TABLE "Job"
  ADD COLUMN "onMyWayAt" TIMESTAMP(3),
  ADD COLUMN "onMyWayLat" DOUBLE PRECISION,
  ADD COLUMN "onMyWayLng" DOUBLE PRECISION,
  ADD COLUMN "onMyWayLocationAt" TIMESTAMP(3);

-- Supplier website URL (suppliers treated as websites for price comparison)
ALTER TABLE "Supplier" ADD COLUMN "website" TEXT;

-- Inventory stock-count audit trail
ALTER TABLE "Product"
  ADD COLUMN "stockUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "stockUpdatedById" TEXT,
  ADD COLUMN "stockUpdatedByName" TEXT;

-- Client review photos (poor-review uploads)
CREATE TABLE "ReviewPhoto" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "rating" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReviewPhoto_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ReviewPhoto_jobId_idx" ON "ReviewPhoto"("jobId");
ALTER TABLE "ReviewPhoto" ADD CONSTRAINT "ReviewPhoto_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Field Lead group membership (self-relation) for the weekly group bonus
ALTER TABLE "User" ADD COLUMN "fieldLeadId" TEXT;
CREATE INDEX "User_fieldLeadId_idx" ON "User"("fieldLeadId");
ALTER TABLE "User" ADD CONSTRAINT "User_fieldLeadId_fkey"
  FOREIGN KEY ("fieldLeadId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Job-specific cleaner<->client chat
CREATE TYPE "JobChatSenderRole" AS ENUM ('CLEANER', 'CLIENT', 'ADMIN');
CREATE TABLE "JobChatMessage" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "senderId" TEXT,
  "senderRole" "JobChatSenderRole" NOT NULL,
  "senderName" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "readByAdminAt" TIMESTAMP(3),
  "readByClientAt" TIMESTAMP(3),
  "readByCleanerAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JobChatMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "JobChatMessage_jobId_createdAt_idx" ON "JobChatMessage"("jobId", "createdAt");
ALTER TABLE "JobChatMessage" ADD CONSTRAINT "JobChatMessage_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Cleaner group chat
CREATE TABLE "GroupChannel" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GroupChannel_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "GroupMessage" (
  "id" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "senderName" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GroupMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GroupMessage_channelId_createdAt_idx" ON "GroupMessage"("channelId", "createdAt");
ALTER TABLE "GroupMessage" ADD CONSTRAINT "GroupMessage_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "GroupChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
