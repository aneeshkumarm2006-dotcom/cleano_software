-- awerfixes.pdf item 3 (round 3) — service category permissions per employee.
--
-- There was no category concept on User at all, and claimableJobsWhere carries
-- no category term, so every cleaner saw every open job. This column is the
-- allow-list: an employee restricted to RESIDENTIAL stops seeing (and stops
-- being able to claim) COMMERCIAL work.
--
-- EMPTY ARRAY = ALL CATEGORIES ALLOWED (settled decision 8). That is why the
-- column is additive with an empty default and needs no backfill: every existing
-- row reads as "unrestricted", which is exactly today's behaviour. Admins opt IN
-- to restricting a specific employee.
--
-- Deliberately NOT an enum: the canonical category keys live in
-- src/lib/calendar-labels.ts (SERVICE_CATEGORIES) and the admin service catalog
-- is itself editable from Settings, so pinning them into a Postgres type would
-- mean a migration every time the business renames or adds a service. Values are
-- validated on write by normalizeAllowedCategories() in
-- src/lib/service-permissions.ts — every writer goes through it.
--
-- Enforcement is cleaner-side only. Admin assignment stays possible with a
-- warning (the PDF is explicit: warn, never block), so no constraint here may
-- ever prevent a row from being written.
--
-- TEXT[] DEFAULT ARRAY[]::TEXT[] with no NOT NULL matches the existing array
-- columns in this schema (JobApplication.availableDays / experienceTypes,
-- Contact.tags, PropertyDefinition.options) — Prisma reads String[] @default([])
-- against exactly that shape, so this does not introduce drift.

-- PRE-FLIGHT (should return 0 — the column must not already exist):
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_name = 'User' AND column_name = 'allowedServiceCategories';

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "allowedServiceCategories" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- POST-APPLY VERIFICATION (expect every existing user at 0 — unrestricted):
--   SELECT count(*) FILTER (WHERE cardinality("allowedServiceCategories") = 0) AS unrestricted,
--          count(*)                                                            AS total
--     FROM "User";

-- ROLLBACK:
--   ALTER TABLE "User" DROP COLUMN "allowedServiceCategories";
