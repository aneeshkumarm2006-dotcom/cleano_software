-- ── Enum extensions ───────────────────────────────────────────────
-- AlterEnum: Roles
ALTER TYPE "Roles" ADD VALUE 'OPS_MANAGER';
ALTER TYPE "Roles" ADD VALUE 'FIELD_LEAD';

-- AlterEnum: PayPeriodStatus
ALTER TYPE "PayPeriodStatus" ADD VALUE 'PENDING_APPROVAL';
ALTER TYPE "PayPeriodStatus" ADD VALUE 'REJECTED';

-- AlterEnum: AlertType
ALTER TYPE "AlertType" ADD VALUE 'PROVIDER_LOW_STOCK';
ALTER TYPE "AlertType" ADD VALUE 'CLEANER_PAYMENT';
ALTER TYPE "AlertType" ADD VALUE 'IMMEDIATE_PAYOUT';
ALTER TYPE "AlertType" ADD VALUE 'CLIENT_COMPLAINT';
ALTER TYPE "AlertType" ADD VALUE 'RATING_DECREASE';
ALTER TYPE "AlertType" ADD VALUE 'OVERDUE_COMMERCIAL';

-- ── New enums ─────────────────────────────────────────────────────
-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('RESIDENTIAL', 'COMMERCIAL');

-- CreateEnum
CREATE TYPE "ServiceFrequency" AS ENUM ('ONE_TIME', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY');

-- CreateEnum
CREATE TYPE "ComplaintCategory" AS ENUM ('SERVICE_QUALITY', 'BEHAVIOR', 'DAMAGE', 'MISSED_APPOINTMENT', 'BILLING', 'OTHER');

-- CreateEnum
CREATE TYPE "ComplaintPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ComplaintStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED');

-- ── Column additions ──────────────────────────────────────────────
-- AlterTable: User
ALTER TABLE "User" ADD COLUMN "multiplierLastRecalculatedAt" TIMESTAMP(3);

-- AlterTable: Client
ALTER TABLE "Client" ADD COLUMN "clientType" "ClientType" NOT NULL DEFAULT 'RESIDENTIAL',
ADD COLUMN "serviceFrequency" "ServiceFrequency",
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable: Job (jobNumber SERIAL backfills existing rows from sequence)
ALTER TABLE "Job" ADD COLUMN "jobNumber" SERIAL NOT NULL;

-- AlterTable: Invoice
ALTER TABLE "Invoice" ADD COLUMN "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable: Alert (Phase 2 — notification fan-out)
ALTER TABLE "Alert" ADD COLUMN "recipientUserId" TEXT;

-- ── New tables ────────────────────────────────────────────────────
-- CreateTable: AlertRoutingRule
CREATE TABLE "AlertRoutingRule" (
    "id" TEXT NOT NULL,
    "alertType" "AlertType" NOT NULL,
    "recipientRole" "Roles" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertRoutingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Complaint
CREATE TABLE "Complaint" (
    "id" TEXT NOT NULL,
    "jobId" TEXT,
    "clientId" TEXT,
    "employeeId" TEXT,
    "resolvedById" TEXT,
    "category" "ComplaintCategory" NOT NULL,
    "priority" "ComplaintPriority" NOT NULL DEFAULT 'MEDIUM',
    "details" TEXT NOT NULL,
    "status" "ComplaintStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);

-- ── Indexes ───────────────────────────────────────────────────────
-- CreateIndex
CREATE UNIQUE INDEX "Job_jobNumber_key" ON "Job"("jobNumber");

-- CreateIndex
CREATE INDEX "Client_clientType_idx" ON "Client"("clientType");

-- CreateIndex
CREATE INDEX "Client_isActive_idx" ON "Client"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "AlertRoutingRule_alertType_recipientRole_key" ON "AlertRoutingRule"("alertType", "recipientRole");

-- CreateIndex
CREATE INDEX "AlertRoutingRule_alertType_idx" ON "AlertRoutingRule"("alertType");

-- CreateIndex
CREATE INDEX "AlertRoutingRule_recipientRole_idx" ON "AlertRoutingRule"("recipientRole");

-- CreateIndex
CREATE INDEX "Complaint_jobId_idx" ON "Complaint"("jobId");

-- CreateIndex
CREATE INDEX "Complaint_clientId_idx" ON "Complaint"("clientId");

-- CreateIndex
CREATE INDEX "Complaint_employeeId_idx" ON "Complaint"("employeeId");

-- CreateIndex
CREATE INDEX "Complaint_status_idx" ON "Complaint"("status");

-- CreateIndex
CREATE INDEX "Complaint_createdAt_idx" ON "Complaint"("createdAt");

-- CreateIndex
CREATE INDEX "Alert_recipientUserId_idx" ON "Alert"("recipientUserId");

-- ── Foreign keys ──────────────────────────────────────────────────
-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
