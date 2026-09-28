-- Add structured address + company fields to Client (all nullable, additive)
ALTER TABLE "Client" ADD COLUMN "company" TEXT;
ALTER TABLE "Client" ADD COLUMN "aptNumber" TEXT;
ALTER TABLE "Client" ADD COLUMN "city" TEXT;
ALTER TABLE "Client" ADD COLUMN "state" TEXT;
ALTER TABLE "Client" ADD COLUMN "zip" TEXT;
