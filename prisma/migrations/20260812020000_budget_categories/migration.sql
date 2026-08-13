-- Client feedback item 12 (Stage 8.1) — custom budget categories.
--
-- The client's words (V3 0:00): "these are all set categories. We should just be
-- able to write our own ... it's not necessarily under Revenue, Supplies,
-- Labour, Overhead, and Other."  They were a hard Prisma enum
-- (`TransactionCategory`), so this is a schema migration, not a UI change.
--
-- Both tables that carried the enum move together. `Budget` is the one the
-- client named, but `Transaction` is where the ACTUALS live — leaving it on the
-- enum would let an admin budget for "Marketing" and then have nowhere to file
-- the spend, so Budget vs Actuals would show every custom category stuck at
-- $0.00 forever.
--
-- Seed ids are literal and readable (`bcat_<slug>`) rather than generated:
-- the backfill below is then a pure string mapping off the enum value, the five
-- defaults are greppable in the app code, and re-running this migration on a
-- fresh database produces byte-identical ids.
--
-- `kind` is not in the original field list. It is here because every P&L,
-- income-statement, tax and bookkeeping figure in the app branches on
-- `category === "REVENUE"`, and with only a name/slug a newly-created category
-- could never be an income line — it would silently subtract from profit. The
-- five seeds reproduce today's behaviour exactly (REVENUE in, the other four
-- out); anything created later says which it is.

-- ── The category table ──────────────────────────────────────────────────────
CREATE TYPE "BudgetCategoryKind" AS ENUM ('REVENUE', 'EXPENSE');

CREATE TABLE "BudgetCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" "BudgetCategoryKind" NOT NULL DEFAULT 'EXPENSE',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BudgetCategory_slug_key" ON "BudgetCategory"("slug");
CREATE INDEX "BudgetCategory_archivedAt_idx" ON "BudgetCategory"("archivedAt");
CREATE INDEX "BudgetCategory_sortOrder_idx" ON "BudgetCategory"("sortOrder");

-- ── Seed the five enum values as default rows ───────────────────────────────
-- `slug` matches the lower-cased enum value on purpose: it is what the backfill
-- below joins on, and what the automatic writers (Stripe receipts, clock-out
-- supply costs, pay-period labour) resolve against forever after. Slugs are
-- immutable; renaming a category changes `name` only, so history follows.
INSERT INTO "BudgetCategory" ("id", "name", "slug", "kind", "isDefault", "sortOrder", "createdAt", "updatedAt") VALUES
  ('bcat_revenue',  'Revenue',  'revenue',  'REVENUE', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('bcat_supplies', 'Supplies', 'supplies', 'EXPENSE', true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('bcat_labour',   'Labour',   'labour',   'EXPENSE', true, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('bcat_overhead', 'Overhead', 'overhead', 'EXPENSE', true, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('bcat_other',    'Other',    'other',    'EXPENSE', true, 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- ── Budget.category -> Budget.categoryId ────────────────────────────────────
-- Added nullable, backfilled, then made NOT NULL: an unmappable row would fail
-- the SET NOT NULL loudly inside the transaction rather than land as a silent
-- orphan. The old unique ([category, period]) becomes ([categoryId, period]),
-- and because the enum→row mapping is 1:1 no existing pair can collide.
ALTER TABLE "Budget" ADD COLUMN "categoryId" TEXT;
UPDATE "Budget" SET "categoryId" = 'bcat_' || lower("category"::text);
ALTER TABLE "Budget" ALTER COLUMN "categoryId" SET NOT NULL;

DROP INDEX "Budget_category_period_key";
ALTER TABLE "Budget" DROP COLUMN "category";

CREATE UNIQUE INDEX "Budget_categoryId_period_key" ON "Budget"("categoryId", "period");
CREATE INDEX "Budget_categoryId_idx" ON "Budget"("categoryId");
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "BudgetCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Transaction.category -> Transaction.categoryId ──────────────────────────
ALTER TABLE "Transaction" ADD COLUMN "categoryId" TEXT;
UPDATE "Transaction" SET "categoryId" = 'bcat_' || lower("category"::text);
ALTER TABLE "Transaction" ALTER COLUMN "categoryId" SET NOT NULL;

DROP INDEX "Transaction_category_idx";
ALTER TABLE "Transaction" DROP COLUMN "category";

CREATE INDEX "Transaction_categoryId_idx" ON "Transaction"("categoryId");
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "BudgetCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RESTRICT on both FKs is deliberate: the app archives a category that still
-- has rows instead of deleting it, and this is the backstop if that check is
-- ever bypassed. Losing a year of bookkeeping to a mis-click is not recoverable.

-- ── The enum is now unreferenced ────────────────────────────────────────────
DROP TYPE "TransactionCategory";
