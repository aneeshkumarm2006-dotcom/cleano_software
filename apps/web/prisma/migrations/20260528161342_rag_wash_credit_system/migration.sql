-- Rag wash credit system (per spec)

-- CreateEnum
CREATE TYPE "WashPayoutStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- AlterTable: Job — projection + idempotency
ALTER TABLE "Job" ADD COLUMN "washProjectedRags" INTEGER;
ALTER TABLE "Job" ADD COLUMN "washProjectedPads" INTEGER;
ALTER TABLE "Job" ADD COLUMN "washCappedRags" INTEGER;
ALTER TABLE "Job" ADD COLUMN "washCappedPads" INTEGER;
ALTER TABLE "Job" ADD COLUMN "washActualRags" INTEGER;
ALTER TABLE "Job" ADD COLUMN "washActualPads" INTEGER;
ALTER TABLE "Job" ADD COLUMN "washCreditsAwarded" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: User — running ledger
ALTER TABLE "User" ADD COLUMN "ragCredits" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "padCredits" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: RagWash — track pads alongside rags
ALTER TABLE "RagWash" ADD COLUMN "padCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable: WashPayout (per-spec Payout_Log)
CREATE TABLE "WashPayout" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "ragCreditsUsed" INTEGER NOT NULL DEFAULT 0,
    "padCreditsUsed" INTEGER NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "WashPayoutStatus" NOT NULL DEFAULT 'PENDING',
    "stripeTransferId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WashPayout_pkey" PRIMARY KEY ("id")
);

-- Index
CREATE INDEX "WashPayout_employeeId_idx" ON "WashPayout"("employeeId");
CREATE INDEX "WashPayout_status_idx" ON "WashPayout"("status");
CREATE INDEX "WashPayout_createdAt_idx" ON "WashPayout"("createdAt");

-- FK
ALTER TABLE "WashPayout" ADD CONSTRAINT "WashPayout_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
