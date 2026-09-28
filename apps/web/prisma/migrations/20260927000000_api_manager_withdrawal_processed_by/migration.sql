-- API v1, manager side (packages/api/src/v1/manager-approvals.ts).
--
-- Additive only: one nullable column on an existing table. No row is
-- rewritten and nothing the web reads changes meaning. Reverses by dropping
-- the column. No new table, so no new RLS policy or grant: the column
-- inherits its table's.
--
--   Withdrawal.processedById   who last moved the withdrawal (approved, marked
--                              paid or rejected it), from the web's payouts
--                              panel or the phone. processedAt stays the time
--                              it was completed or rejected, as before.

ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "processedById" TEXT;
