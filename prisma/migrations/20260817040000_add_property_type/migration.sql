-- Stage 9 of `_ai_context/TODO.md` — property type on the job form
-- (cleano_inventory_operations_fixes.pdf #11, p.7-8).
-- Implements step 9.1: `PropertyType` + one nullable `Job` column.
--
-- ── Why ────────────────────────────────────────────────────────────────────
-- Nothing in the job path recorded whether a booking is at an apartment or a
-- house. `Job` carries bedCount/bathCount/halfBathCount/squareFootage but no
-- building classifier, so a cleaner arriving on site could not tell from the
-- app whether to expect a buzzer and an elevator or a driveway and a basement
-- — which is the complaint PDF #11 records ("helps cleaners understand the job
-- setup before arriving").
--
-- Worse, the fact was being actively destroyed on import. BookingKoala's CSV
-- puts the property word in its "Service" column ("House", "Apartment",
-- "Condo", "Townhouse", "Detached Home (2000+ sqft)"), and the importer folds
-- every one of them onto the service category RESIDENTIAL. That fold is
-- correct for what it does — a house clean and an apartment clean are the same
-- service — so it stays. This column is where the property word now lands
-- BEFORE the fold, which is why the two can coexist.
--
-- Deliberately NOT `Job.jobType`. That column answers "what cleaning is this"
-- and drives pricing rules, checklist triggers and service permissions;
-- overloading it with building types would change all three by accident.
--
-- ── Blast radius ───────────────────────────────────────────────────────────
-- Additive only. Nothing is rewritten and nothing is dropped.
--   * The column is NULLABLE with no default and is NULL on every existing row.
--     "Not recorded" is the honest state for a job booked before the field
--     existed, and a DEFAULT here would stamp a guess onto ~all of history.
--   * No backfill is shipped for the same reason: no stored data can tell an
--     apartment from a house for the existing rows. New BookingKoala imports
--     classify themselves from the CSV (step 9.6); old ones stay blank and are
--     editable by hand from either job form.
--   * No index: nothing filters or sorts on this. Two values plus NULL would
--     never be selective enough for the planner to use one.
-- No price, total, tax, payout, pay-rate or payment column is touched by this
-- file, and no existing enum is altered.

CREATE TYPE "PropertyType" AS ENUM ('APARTMENT_CONDO', 'HOUSE');

ALTER TABLE "Job"
  ADD COLUMN "propertyType" "PropertyType";
