-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('LIQUID_SPRAY', 'MOP_LIQUID', 'DISPOSABLE', 'OTHER');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "category" "ProductCategory" NOT NULL DEFAULT 'OTHER';
