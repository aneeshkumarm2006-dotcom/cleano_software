-- Admin View Software Fixes: job pay type (flat/hourly), inventory audit log,
-- group-chat read receipts.

-- Job pay type (Flat / Hourly / Percentage default)
CREATE TYPE "JobPayType" AS ENUM ('PERCENTAGE', 'FLAT', 'HOURLY');
ALTER TABLE "Job" ADD COLUMN "payType" "JobPayType" NOT NULL DEFAULT 'PERCENTAGE';
ALTER TABLE "Job" ADD COLUMN "hourlyRate" DOUBLE PRECISION;

-- Inventory change audit log
CREATE TABLE "InventoryChange" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "employeeId" TEXT,
    "employeeName" TEXT,
    "quantityChange" DOUBLE PRECISION NOT NULL,
    "newQuantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "reason" TEXT,
    "changedById" TEXT,
    "changedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InventoryChange_productId_createdAt_idx" ON "InventoryChange"("productId", "createdAt");
CREATE INDEX "InventoryChange_employeeId_idx" ON "InventoryChange"("employeeId");
ALTER TABLE "InventoryChange" ADD CONSTRAINT "InventoryChange_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Group-chat per-user read cursor
CREATE TABLE "GroupChannelRead" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GroupChannelRead_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GroupChannelRead_channelId_userId_key" ON "GroupChannelRead"("channelId", "userId");
CREATE INDEX "GroupChannelRead_userId_idx" ON "GroupChannelRead"("userId");
