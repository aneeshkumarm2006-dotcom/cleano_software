-- Fix 2 of cleano_new_fixes.pdf — explicit pricing modes.
--
-- The two modes already existed in the arithmetic (`addOnMoneyBasis` in
-- src/lib/job-money.ts branched ADDITIVE vs INCLUSIVE off `bookingSource`), but
-- they were invisible, not an admin choice, and losable: retyping the price of a
-- web/imported job silently flipped it to itemized. This column makes the mode a
-- stored, admin-selectable property of the job.
--
-- ── Why the column is NULLABLE ──────────────────────────────────────────────
-- NULL means "never stamped". `resolvePricingMode()` falls back to the old
-- `bookingSource` rule for those rows, so a job this migration does not touch
-- prices exactly as it did the day before. Nothing about the rollout depends on
-- the backfill below landing.
--
-- ── Why the backfill below cannot move a single number ──────────────────────
-- It is the `addOnMoneyBasis()` truth table, written out in SQL:
--
--     bookingSource IN ('web', 'web %', 'bookingkoala_import')  -> INCLUSIVE
--     everything else, NULL included                            -> ADDITIVE
--
-- and FINAL_PRICE is the INCLUSIVE branch, ITEMIZED the ADDITIVE one. So every
-- row is stamped with the mode it was already being priced under. This is worth
-- stating because of what the Stage 0 probe found on live data
-- (_ai_context/TODO.md § 0.4b): `bookingSource` is NULL on all 472 rows, so the
-- FINAL_PRICE half matches ZERO rows today and every existing job lands on
-- ITEMIZED. That is the correct outcome — those jobs are already priced
-- ADDITIVE — but it is a stamp on the whole table, so the counts are logged
-- below rather than left to be inferred.
--
-- The `LIKE 'web %'` arm mirrors `key.startsWith("web ")` in addOnMoneyBasis,
-- which is what catches 'web (referral)'. Matching is case-insensitive and
-- trimmed for the same reason the TypeScript does it.

CREATE TYPE "JobPricingMode" AS ENUM ('ITEMIZED', 'FINAL_PRICE');

ALTER TABLE "Job" ADD COLUMN "pricingMode" "JobPricingMode";

-- The sources whose stored subtotal ALREADY contains their add-ons.
UPDATE "Job"
SET "pricingMode" = 'FINAL_PRICE'
WHERE lower(trim("bookingSource")) = 'web'
   OR lower(trim("bookingSource")) LIKE 'web %'
   OR lower(trim("bookingSource")) = 'bookingkoala_import';

-- Everything else — every admin-authored job, and every NULL source.
UPDATE "Job"
SET "pricingMode" = 'ITEMIZED'
WHERE "pricingMode" IS NULL;

-- ── Post-deploy sanity check (Stage 7.1) ────────────────────────────────────
-- Deliberately NOT a `DO $$ … RAISE NOTICE $$` block: Prisma's migration engine
-- discards Postgres notices, so the counts would be written to nowhere while
-- adding a procedural block this repo has no other precedent for. Run this
-- read-only query against prod straight after `prisma migrate deploy` instead,
-- and record the result beside the migration:
--
--   SELECT COALESCE("pricingMode"::text, 'NULL — unstamped') AS mode, count(*)
--   FROM "Job" GROUP BY 1 ORDER BY 2 DESC;
--
-- Expected on the database the Stage 0 probe measured (472 jobs, every
-- `bookingSource` NULL): 472 ITEMIZED, 0 FINAL_PRICE, 0 unstamped. A non-zero
-- FINAL_PRICE count means web/BookingKoala rows landed between the probe and
-- the deploy, which is fine — those are exactly the rows that should be on it.
