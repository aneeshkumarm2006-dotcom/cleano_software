-- CreateEnum
CREATE TYPE "ActivityCategory" AS ENUM ('EMAIL', 'SMS', 'PAYMENT', 'REFUND', 'DEPOSIT', 'WEBHOOK', 'AUTH', 'BOOKING', 'ADMIN', 'CRON', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ActivityStatus" AS ENUM ('SUCCESS', 'FAILED', 'PENDING', 'SKIPPED');

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" "ActivityCategory" NOT NULL,
    "action" TEXT NOT NULL,
    "status" "ActivityStatus" NOT NULL DEFAULT 'SUCCESS',
    "actorId" TEXT,
    "actorLabel" TEXT,
    "targetType" TEXT,
    "targetId" TEXT,
    "message" TEXT,
    "error" TEXT,
    "amount" DOUBLE PRECISION,
    "providerId" TEXT,
    "metadata" JSONB,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityLog_category_idx" ON "ActivityLog"("category");

-- CreateIndex
CREATE INDEX "ActivityLog_status_idx" ON "ActivityLog"("status");

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_actorId_idx" ON "ActivityLog"("actorId");

-- CreateIndex
CREATE INDEX "ActivityLog_targetType_targetId_idx" ON "ActivityLog"("targetType", "targetId");
