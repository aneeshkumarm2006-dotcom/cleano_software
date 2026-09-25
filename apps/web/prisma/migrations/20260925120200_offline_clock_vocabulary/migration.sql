-- One vocabulary for phone clock corrections, the one the v1 contract uses
-- (packages/api/src/v1/manager-approvals.ts: TIME_ITEM_KINDS, OFFLINE_REASONS).
--
-- 20260925120000 named the two sources CLEANER and PHONE. The manager side's
-- contract, written alongside, calls them CLEANER_REQUEST and OFFLINE_CLOCK and
-- says WHY an offline event came to the office. Rather than translate between
-- two vocabularies forever, the stored values become the contract's, and the
-- reason gets a column of its own.
--
-- Additive and safe on a live table: the default changes, rows written under
-- the old names (staging only; nothing has reached production) are renamed, and
-- a nullable column is added. Reverses by renaming back and dropping it.

ALTER TABLE "TimeLogChangeRequest" ALTER COLUMN "source" SET DEFAULT 'CLEANER_REQUEST';
UPDATE "TimeLogChangeRequest" SET "source" = 'CLEANER_REQUEST' WHERE "source" = 'CLEANER';
UPDATE "TimeLogChangeRequest" SET "source" = 'OFFLINE_CLOCK' WHERE "source" = 'PHONE';

-- OFFLINE_CLOCK only: GAP_OVER_LIMIT | NOT_PROVEN_OFFLINE | COULD_NOT_APPLY.
ALTER TABLE "TimeLogChangeRequest" ADD COLUMN IF NOT EXISTS "offlineReason" TEXT;
