-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('LOW_INVENTORY', 'CANCELLATION', 'OVERDUE_PAYMENT', 'GENERAL');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "TargetMetric" AS ENUM ('REVENUE', 'JOBS_COMPLETED', 'NEW_CLIENTS', 'PROFIT_MARGIN', 'AVG_JOB_PRICE', 'EMPLOYEE_RETENTION');

-- CreateEnum
CREATE TYPE "TargetPeriod" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateTable
CREATE TABLE "RagWash" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "washDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ragCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RagWash_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "type" "AlertType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'WARNING',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "isDismissed" BOOLEAN NOT NULL DEFAULT false,
    "relatedId" TEXT,
    "relatedType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Target" (
    "id" TEXT NOT NULL,
    "metric" "TargetMetric" NOT NULL,
    "period" "TargetPeriod" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Target_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RagWash_employeeId_idx" ON "RagWash"("employeeId");

-- CreateIndex
CREATE INDEX "RagWash_washDate_idx" ON "RagWash"("washDate");

-- CreateIndex
CREATE INDEX "Alert_type_idx" ON "Alert"("type");

-- CreateIndex
CREATE INDEX "Alert_isRead_idx" ON "Alert"("isRead");

-- CreateIndex
CREATE INDEX "Alert_createdAt_idx" ON "Alert"("createdAt");

-- CreateIndex
CREATE INDEX "Target_periodStart_idx" ON "Target"("periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "Target_metric_period_periodStart_key" ON "Target"("metric", "period", "periodStart");

-- CreateIndex
CREATE INDEX "InventoryRequest_employeeId_idx" ON "InventoryRequest"("employeeId");

-- CreateIndex
CREATE INDEX "InventoryRequest_kitId_idx" ON "InventoryRequest"("kitId");

-- AddForeignKey
ALTER TABLE "InventoryRequest" ADD CONSTRAINT "InventoryRequest_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "KitTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RagWash" ADD CONSTRAINT "RagWash_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
