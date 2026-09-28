-- Provider/cleaner deactivation flag (additive column only).
-- Existing rows default to true so no one is locked out by the migration.
ALTER TABLE "User" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
