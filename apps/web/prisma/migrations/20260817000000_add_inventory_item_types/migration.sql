-- Stage 1 of `_ai_context/TODO.md` — inventory item-type classification.
-- Implements cleano_inventory_operations_fixes.pdf #1 (p.2, classification) and
-- the schema half of #4 (p.3, "admin should be able to set each inventory item
-- type").
--
-- ── Why ────────────────────────────────────────────────────────────────────
-- The only classifier a Product has today is `ProductCategory`, whose stated
-- job is "determines how cleaners log usage at clock-out". It says nothing
-- about whether the item is consumed at all, so durable goods (Bucket, Toilet
-- Brush, scrapers, mop pads) were seeded as OTHER and ran through the same
-- cleaner refill thresholds as a bottle of Windex. That is the direct cause of
-- the screenshot in the PDF: "2-Sided Scraper — LOW — Running low (1 Scrapers
-- left) — request a refill", for a cleaner who needs exactly one scraper.
--
-- `ItemType` answers the different question — what KIND of thing is this — and
-- is what Stages 2 and 3 branch their threshold/reporting rules on.
--
-- ── Blast radius ───────────────────────────────────────────────────────────
-- Everything here is additive and defaulted, so the app behaves identically
-- until Stage 2 starts reading the new columns:
--   * `Product.itemType` is NOT NULL DEFAULT 'COUNTABLE_CONSUMABLE' — every
--     existing row lands on the type whose rules are exactly today's rules.
--     `prisma/backfillItemTypes.ts` reclassifies them afterwards, reviewably.
--   * The four new EmployeeProduct columns and two new InventoryChange columns
--     are all nullable with no default: "never reported" stays distinguishable
--     from "reported as full/available".
--   * `InventoryFlag` is a brand-new, empty table. Nothing writes it yet
--     (Stages 2-3 do); nothing reads it yet.
-- No count, price, job, or login is touched.

-- ── Enums ──────────────────────────────────────────────────────────────────
CREATE TYPE "ItemType" AS ENUM ('LIQUID', 'COUNTABLE_CONSUMABLE', 'REUSABLE_EQUIPMENT');
CREATE TYPE "LiquidLevel" AS ENUM ('FULL', 'GOOD', 'HALF', 'LOW', 'EMPTY');
CREATE TYPE "EquipmentCondition" AS ENUM ('AVAILABLE', 'MISSING', 'DAMAGED', 'NEEDS_REPLACEMENT', 'NEEDS_MAINTENANCE');
CREATE TYPE "InventoryFlagType" AS ENUM ('LOW', 'EMPTY', 'MISSING', 'DAMAGED', 'NEEDS_REPLACEMENT', 'NEEDS_MAINTENANCE', 'RESTOCK');
CREATE TYPE "InventoryFlagStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- ── Product: the classification itself ─────────────────────────────────────
ALTER TABLE "Product"
  ADD COLUMN "itemType" "ItemType" NOT NULL DEFAULT 'COUNTABLE_CONSUMABLE';

-- ── EmployeeProduct: the latest status a cleaner reported for a kit row ─────
-- Which column carries meaning depends on the product's itemType: levelStatus
-- for LIQUID, the existing `quantity` for COUNTABLE_CONSUMABLE, condition for
-- REUSABLE_EQUIPMENT.
ALTER TABLE "EmployeeProduct"
  ADD COLUMN "levelStatus"     "LiquidLevel",
  ADD COLUMN "condition"       "EquipmentCondition",
  ADD COLUMN "statusUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "statusNotes"     TEXT;

-- ── InventoryChange: status transitions in the audit trail ─────────────────
-- PDF #1 wants history to carry "previous status → new status" next to the
-- quantity columns that already exist. Free text rather than an enum because
-- one table logs three different status vocabularies (LiquidLevel,
-- EquipmentCondition, and the countable OK/LOW/EMPTY/MISSING/DAMAGED chips).
ALTER TABLE "InventoryChange"
  ADD COLUMN "previousStatus" TEXT,
  ADD COLUMN "newStatus"      TEXT;

-- ── InventoryFlag: the admin review/restock queue ──────────────────────────
-- Deliberately NOT a new kind of InventoryRequest: that model is an APPROVAL
-- queue with its own status machine, and is already flooded with 48 pending
-- auto-created rows (PDF p.5). A flag is "someone should look at this", which
-- is a different thing from "please approve N units".
CREATE TABLE "InventoryFlag" (
  "id"           TEXT NOT NULL,
  "type"         "InventoryFlagType" NOT NULL,
  "status"       "InventoryFlagStatus" NOT NULL DEFAULT 'OPEN',
  "employeeId"   TEXT NOT NULL,
  "productId"    TEXT NOT NULL,
  "jobId"        TEXT,
  "source"       TEXT NOT NULL,
  "notes"        TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt"   TIMESTAMP(3),
  "resolvedById" TEXT,

  CONSTRAINT "InventoryFlag_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InventoryFlag_status_createdAt_idx" ON "InventoryFlag"("status", "createdAt");
CREATE INDEX "InventoryFlag_employeeId_idx" ON "InventoryFlag"("employeeId");
CREATE INDEX "InventoryFlag_productId_idx" ON "InventoryFlag"("productId");

ALTER TABLE "InventoryFlag" ADD CONSTRAINT "InventoryFlag_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryFlag" ADD CONSTRAINT "InventoryFlag_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryFlag" ADD CONSTRAINT "InventoryFlag_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
