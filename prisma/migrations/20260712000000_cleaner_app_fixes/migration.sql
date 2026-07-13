-- Cleaner App + Admin View fixes: one-off availability blocks, product purchase
-- links, client saved payment methods.

-- One-off availability blocks (vacation / appointment / sick day)
CREATE TABLE "AvailabilityException" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AvailabilityException_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AvailabilityException_employeeId_date_key" ON "AvailabilityException"("employeeId", "date");
CREATE INDEX "AvailabilityException_employeeId_date_idx" ON "AvailabilityException"("employeeId", "date");
ALTER TABLE "AvailabilityException" ADD CONSTRAINT "AvailabilityException_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Product purchase links (one exact link + extras)
ALTER TABLE "Product" ADD COLUMN "purchaseUrl" TEXT;

CREATE TABLE "ProductLink" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "label" TEXT,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductLink_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductLink_productId_idx" ON "ProductLink"("productId");
ALTER TABLE "ProductLink" ADD CONSTRAINT "ProductLink_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Client saved payment methods
CREATE TABLE "ClientPaymentMethod" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "stripePaymentMethodId" TEXT NOT NULL,
    "brand" TEXT,
    "last4" TEXT,
    "expMonth" INTEGER,
    "expYear" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClientPaymentMethod_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ClientPaymentMethod_stripePaymentMethodId_key" ON "ClientPaymentMethod"("stripePaymentMethodId");
CREATE INDEX "ClientPaymentMethod_clientId_idx" ON "ClientPaymentMethod"("clientId");
ALTER TABLE "ClientPaymentMethod" ADD CONSTRAINT "ClientPaymentMethod_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
