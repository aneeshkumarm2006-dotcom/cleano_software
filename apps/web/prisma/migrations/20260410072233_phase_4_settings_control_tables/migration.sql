-- CreateTable
CREATE TABLE "AppSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KitTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KitTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KitTemplateItem" (
    "id" TEXT NOT NULL,
    "kitTemplateId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KitTemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryRule" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "usagePerJob" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "refillThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPrice" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppSetting_key_key" ON "AppSetting"("key");

-- CreateIndex
CREATE INDEX "AppSetting_category_idx" ON "AppSetting"("category");

-- CreateIndex
CREATE INDEX "KitTemplateItem_kitTemplateId_idx" ON "KitTemplateItem"("kitTemplateId");

-- CreateIndex
CREATE INDEX "KitTemplateItem_productId_idx" ON "KitTemplateItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "KitTemplateItem_kitTemplateId_productId_key" ON "KitTemplateItem"("kitTemplateId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryRule_productId_key" ON "InventoryRule"("productId");

-- CreateIndex
CREATE INDEX "SupplierPrice_supplierId_idx" ON "SupplierPrice"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierPrice_productId_idx" ON "SupplierPrice"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPrice_supplierId_productId_key" ON "SupplierPrice"("supplierId", "productId");

-- AddForeignKey
ALTER TABLE "KitTemplateItem" ADD CONSTRAINT "KitTemplateItem_kitTemplateId_fkey" FOREIGN KEY ("kitTemplateId") REFERENCES "KitTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KitTemplateItem" ADD CONSTRAINT "KitTemplateItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryRule" ADD CONSTRAINT "InventoryRule_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPrice" ADD CONSTRAINT "SupplierPrice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPrice" ADD CONSTRAINT "SupplierPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
