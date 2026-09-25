-- Phase 7: Inventory Enhancements
-- Fix orphaned productId on InventoryRequest: add foreign key + index

-- CreateIndex
CREATE INDEX "InventoryRequest_productId_idx" ON "InventoryRequest"("productId");

-- AddForeignKey
ALTER TABLE "InventoryRequest" ADD CONSTRAINT "InventoryRequest_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
