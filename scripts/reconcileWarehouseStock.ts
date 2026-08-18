// One-time (and idempotent) reconciliation of the two warehouse stores —
// STAGE 4 of `_ai_context/TODO.md`, cleano_inventory_operations_fixes.pdf #5.
//
//   npx tsx scripts/reconcileWarehouseStock.ts --dry-run   # report only
//   npx tsx scripts/reconcileWarehouseStock.ts             # apply
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY
//
// Until Stage 4 there were two independent numbers per product:
//
//   Product.stockLevel            — what every admin screen reads
//   SUM(InventoryLocationStock)   — what the pickup + Quick Assign flows read
//
// Three writers moved only one of them, so they drifted. That is the p.5
// screenshot pair: the Edit Product modal showing "Warehouse Stock = 8" for a
// Bucket while all 48 pending requests warned "⚠ Only 0 Buckets in warehouse"
// and refused to be approved.
//
// From Stage 4 on, per-location rows are the TRUTH and `stockLevel` is a cache
// maintained to equal their sum (decision D5), written only by
// `src/lib/stock.server.ts`. This script makes that true of the data that
// already exists, applying exactly the same rule the app now applies:
//
//   • stock cached but NO location rows → seed the default location from the
//     cache (the product predates locations; the cache is all we know).
//   • otherwise                          → stockLevel = SUM(location rows).
//
// RUN THIS BEFORE SHIPPING Stage 4's reads, or admins watch numbers jump.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT IT DOES NOT DO
//
// It writes no `InventoryChange` rows. Nothing physically moved — this is a
// representation fix — and inventing "+8" entries in a product's Stock History
// would put a fiction in the permanent record to explain a bug. The report
// below IS the record; keep its output.
//
// Archived products (`deletedAt != null`) are included on purpose: they can
// still sit in cleaner kits and still hold warehouse stock, and an invisible
// mismatch is the worst kind.

import { PrismaClient } from "@prisma/client";
import { reconcileProductStock } from "../src/lib/stock.server";

const db = new PrismaClient();

const DRY_RUN = process.argv.includes("--dry-run");

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

async function main() {
  console.log(
    DRY_RUN
      ? "DRY RUN — reporting mismatches, writing nothing.\n"
      : "APPLYING — Product.stockLevel will be set to SUM(location rows).\n"
  );

  const products = await db.product.findMany({
    select: { id: true, name: true, unit: true, stockLevel: true, deletedAt: true },
    orderBy: { name: "asc" },
  });

  const locationRows = await db.inventoryLocationStock.findMany({
    select: { productId: true, quantity: true },
  });
  const sumByProduct = new Map<string, number>();
  const rowsByProduct = new Map<string, number>();
  for (const row of locationRows) {
    sumByProduct.set(
      row.productId,
      (sumByProduct.get(row.productId) ?? 0) + row.quantity
    );
    rowsByProduct.set(row.productId, (rowsByProduct.get(row.productId) ?? 0) + 1);
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;

  interface Mismatch {
    name: string;
    unit: string;
    archived: boolean;
    cached: number;
    sum: number;
    rows: number;
    /** What the reconciled number will be. */
    resolved: number;
    /** "seed" = create the default-location row; "sum" = trust the rows. */
    fix: "seed" | "sum";
  }

  const mismatches: Mismatch[] = [];
  for (const p of products) {
    const cached = round2(p.stockLevel);
    const sum = round2(sumByProduct.get(p.id) ?? 0);
    const rows = rowsByProduct.get(p.id) ?? 0;
    if (rows === 0 && cached === 0) continue;
    if (rows > 0 && sum === cached) continue;

    const seed = rows === 0;
    mismatches.push({
      name: p.name,
      unit: p.unit,
      archived: p.deletedAt !== null,
      cached,
      sum,
      rows,
      resolved: seed ? cached : sum,
      fix: seed ? "seed" : "sum",
    });
  }

  // The review table. Print it whether or not we are applying — an admin has to
  // be able to see what moved after the fact, not just before.
  if (mismatches.length === 0) {
    console.log(
      `All ${products.length} product(s) already agree: stockLevel === SUM(location rows).`
    );
  } else {
    const label = (m: Mismatch) => m.name + (m.archived ? " (archived)" : "");
    const w = Math.max(24, ...mismatches.map((m) => label(m).length));
    console.log(
      `${"PRODUCT".padEnd(w)}  ${"CACHED".padStart(8)}  ${"LOCATIONS".padStart(10)}  ${"ROWS".padStart(4)}  ${"→ BECOMES".padStart(10)}  FIX`
    );
    console.log("-".repeat(w + 52));
    for (const m of mismatches) {
      console.log(
        `${label(m).padEnd(w)}  ` +
          `${fmt(m.cached).padStart(8)}  ${fmt(m.sum).padStart(10)}  ` +
          `${String(m.rows).padStart(4)}  ${fmt(m.resolved).padStart(10)}  ` +
          `${m.fix === "seed" ? "seed default location from cache" : "trust location rows"}`
      );
    }
    console.log(
      `\n${mismatches.length} of ${products.length} product(s) disagree ` +
        `(${mismatches.filter((m) => m.fix === "seed").length} need a location row seeded, ` +
        `${mismatches.filter((m) => m.fix === "sum").length} have a stale cache).`
    );
  }

  if (DRY_RUN) {
    console.log("\nDry run — nothing written. Re-run without --dry-run to apply.");
    return;
  }

  // Apply per product, each in its own transaction: one bad row must not roll
  // back the other 200, and the operation is idempotent so a partial run can
  // simply be re-run.
  let fixed = 0;
  for (const p of products) {
    const result = await db.$transaction((tx) => reconcileProductStock(tx, p.id));
    if (result.changed) fixed++;
  }

  console.log(`\nReconciled ${fixed} product(s). Re-run to confirm 0 remain.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
