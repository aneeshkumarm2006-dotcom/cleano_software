-- Align the migration history with two objects that already exist on the
-- deployed database but were never declared in schema.prisma. `prisma migrate
-- diff` reported both as drift (it wanted to DROP the index and DROP the
-- default); the schema now declares them instead, and these statements make a
-- database built from migrations alone match.
--
-- Written idempotently because the deployed database already has both.

CREATE INDEX IF NOT EXISTS "User_fieldLeadId_idx" ON "User"("fieldLeadId");

ALTER TABLE "PropertyDefinition" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
