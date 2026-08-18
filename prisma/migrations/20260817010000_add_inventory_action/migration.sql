-- Stage 3 of `_ai_context/TODO.md` — what an inventory change RECORDS.
-- Implements step 3.1: `InventoryAction` + `InventoryChange.action`, which
-- retires the reason-string pattern matching in
-- `getInventoryActivity.ts::deriveAction`.
--
-- ── Why ────────────────────────────────────────────────────────────────────
-- The activity log worked out what a row meant by reading its `reason`
-- sentence: `startsWith("warehouse pickup")`, `includes("handed to")`,
-- `startsWith("assigned via kit")`. Those sentences are written in eleven
-- different action files, so rewording any one of them silently reclassified
-- history — "Assigned from Main Warehouse" would have become "Adjusted" the day
-- someone changed the copy to "Issued from Main Warehouse". The verb is now
-- decided by the code that performs the movement and stored alongside it.
--
-- ── Blast radius ───────────────────────────────────────────────────────────
-- Additive and nullable. Nothing existing is rewritten:
--   * Every row already in the table keeps `action = NULL` and goes on being
--     labelled from its prose by `legacyActionLabel()`. That is deliberate —
--     back-filling would bake the guess we are retiring into the permanent
--     record, and it is the only reading of those rows anyone has ever had.
--   * Every writer from this release forward sets `action`, so the derived
--     path applies to history and only to history.
-- No count, price, job, or login is touched.

CREATE TYPE "InventoryAction" AS ENUM (
  'RECOUNT',
  'STATUS_REPORT',
  'ASSIGN',
  'PICKUP',
  'ADMIN_SET',
  'JOB_REPORT',
  'REQUEST_FULFILLED',
  'ISSUE',
  'IMPORT'
);

ALTER TABLE "InventoryChange"
  ADD COLUMN "action" "InventoryAction";
