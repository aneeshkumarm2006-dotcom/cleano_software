-- awer_fixes.pdf item 14 — split inventory refill thresholds.
--
-- Before this, "low stock" was two unrelated ideas sharing one number:
--   • Product.minStock              -> company/locker reorder point
--   • InventoryRule.refillThreshold -> per-cleaner kit restock point
-- and some read paths fell back from the cleaner threshold to minStock, so a
-- cleaner holding 3 bottles was judged against a WAREHOUSE reorder point of 20
-- and reported as critically low. The two thresholds now live side by side on
-- Product so admin edits them in one place and neither can stand in for the other.

ALTER TABLE "Product" ADD COLUMN "cleanerRestockThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Carry over every configured per-cleaner threshold so existing setups keep
-- behaving identically. InventoryRule.refillThreshold stays in place (read-only
-- legacy) rather than being dropped, so this migration is reversible and no
-- historical configuration is destroyed.
UPDATE "Product" p
SET "cleanerRestockThreshold" = r."refillThreshold"
FROM "InventoryRule" r
WHERE r."productId" = p."id"
  AND r."refillThreshold" > 0;
