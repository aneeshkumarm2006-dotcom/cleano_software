-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "bathCount" INTEGER,
ADD COLUMN     "bedCount" INTEGER,
ADD COLUMN     "discountAmount" DOUBLE PRECISION,
ADD COLUMN     "payRateMultiplier" DOUBLE PRECISION DEFAULT 1.0,
ADD COLUMN     "paymentType" "PaymentType";

-- CreateTable
CREATE TABLE "JobAddOn" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobAddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingRule" (
    "id" TEXT NOT NULL,
    "bedCount" INTEGER NOT NULL,
    "bathCount" INTEGER NOT NULL,
    "basePrice" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobAddOn_jobId_idx" ON "JobAddOn"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "PricingRule_bedCount_bathCount_key" ON "PricingRule"("bedCount", "bathCount");

-- AddForeignKey
ALTER TABLE "JobAddOn" ADD CONSTRAINT "JobAddOn_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
