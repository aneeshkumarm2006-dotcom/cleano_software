/**
 * Seed dummy inventory data — products, categories, refill rules, and two
 * stocking locations. Idempotent: products are upserted by name, locations by
 * name, rules by productId.
 *
 * Run: npx tsx prisma/seed-inventory.ts
 */

import { PrismaClient, type ItemType, type ProductCategory } from "@prisma/client";

const db = new PrismaClient();

type Unit = string;

interface ProductSeed {
  name: string;
  description: string;
  category: ProductCategory;
  /**
   * What KIND of thing this is (inventory fixes PDF #1 + #4). Seeded explicitly
   * rather than left to the default, because the durable goods below —
   * buckets, brushes, mop pads, rags — are exactly the items that used to be
   * dumped into category OTHER and then wrongly told a cleaner they were
   * "running low" with one of them in hand.
   */
  itemType: ItemType;
  unit: Unit;
  costPerUnit: number;
  stockLevel: number;
  minStock: number;
  /**
   * Seeded into Product.cleanerRestockThreshold. Was written to
   * InventoryRule.refillThreshold until that model's editor was removed
   * (awerfixes.pdf item 14); the product column is now the only home for it.
   */
  refillThreshold: number;
}

// Twelve products straight from the Post-Job Inventory Usage spec (PDF §2 + §7),
// plus a handful of realistic extras so the inventory page has a fuller picture.
const PRODUCTS: ProductSeed[] = [
  // ─── Liquid sprays (PDF §3.1) ─────────────────────────────────────
  {
    name: "All-purpose cleaner",
    description: "General surface spray for kitchens, baths, and high-traffic areas.",
    category: "LIQUID_SPRAY",
    itemType: "LIQUID",
    unit: "ml",
    costPerUnit: 0.012,
    stockLevel: 3784, // 4 × 946ml bottles
    minStock: 946,
    refillThreshold: 150,
  },
  {
    name: "Windex",
    description: "Streak-free glass and mirror cleaner.",
    category: "LIQUID_SPRAY",
    itemType: "LIQUID",
    unit: "ml",
    costPerUnit: 0.014,
    stockLevel: 2838, // 3 × 946ml bottles
    minStock: 946,
    refillThreshold: 150,
  },
  {
    name: "CLR",
    description: "Calcium, lime, and rust remover for hard water buildup.",
    category: "LIQUID_SPRAY",
    itemType: "LIQUID",
    unit: "ml",
    costPerUnit: 0.018,
    stockLevel: 1892, // 2 × 946ml bottles
    minStock: 946,
    refillThreshold: 150,
  },
  {
    name: "Eco-friendly cleaner",
    description: "Plant-based, biodegradable all-purpose spray.",
    category: "LIQUID_SPRAY",
    itemType: "LIQUID",
    unit: "ml",
    costPerUnit: 0.016,
    stockLevel: 1892,
    minStock: 946,
    refillThreshold: 150,
  },

  // ─── Mop-based liquids (PDF §3.2) ─────────────────────────────────
  {
    name: "Floor cleaner",
    description: "Neutral pH floor solution for tile, vinyl, and laminate.",
    category: "MOP_LIQUID",
    itemType: "LIQUID",
    unit: "mop use",
    costPerUnit: 0.45,
    stockLevel: 60,
    minStock: 10,
    refillThreshold: 1,
  },
  {
    name: "Murphy Oil Soap",
    description: "Wood floor cleaner — dilute as directed.",
    category: "MOP_LIQUID",
    itemType: "LIQUID",
    unit: "mop use",
    costPerUnit: 0.55,
    stockLevel: 40,
    minStock: 8,
    refillThreshold: 1,
  },

  // ─── Disposables (PDF §3.3) ───────────────────────────────────────
  {
    name: "Sponges",
    description: "Dual-sided scrub sponges (2-pack).",
    category: "DISPOSABLE",
    itemType: "COUNTABLE_CONSUMABLE",
    unit: "ea",
    costPerUnit: 0.95,
    stockLevel: 80,
    minStock: 12,
    refillThreshold: 2,
  },
  {
    name: "Garbage bags",
    description: "13-gallon kitchen tall bags.",
    category: "DISPOSABLE",
    itemType: "COUNTABLE_CONSUMABLE",
    unit: "ea",
    costPerUnit: 0.22,
    stockLevel: 240,
    minStock: 24,
    refillThreshold: 2,
  },
  {
    name: "Paper towels",
    description: "Two-ply, full-size rolls.",
    category: "DISPOSABLE",
    itemType: "COUNTABLE_CONSUMABLE",
    unit: "roll",
    costPerUnit: 1.20,
    stockLevel: 36,
    minStock: 6,
    refillThreshold: 1,
  },
  {
    name: "Magic erasers",
    description: "Melamine foam scrub pads for marks and scuffs.",
    category: "DISPOSABLE",
    itemType: "COUNTABLE_CONSUMABLE",
    unit: "ea",
    costPerUnit: 1.10,
    stockLevel: 48,
    minStock: 6,
    refillThreshold: 1,
  },
  {
    name: "Gloves",
    description: "Nitrile disposable gloves (one pair = 1 unit).",
    category: "DISPOSABLE",
    itemType: "COUNTABLE_CONSUMABLE",
    unit: "pair",
    costPerUnit: 0.18,
    stockLevel: 200,
    minStock: 20,
    refillThreshold: 2,
  },
  {
    name: "Masks",
    description: "Disposable 3-ply masks for dusty / chemical work.",
    category: "DISPOSABLE",
    itemType: "COUNTABLE_CONSUMABLE",
    unit: "ea",
    costPerUnit: 0.15,
    stockLevel: 200,
    minStock: 20,
    refillThreshold: 2,
  },

  // ─── Extras (not in PDF, but realistic kit items) ─────────────────
  {
    name: "Microfiber rags",
    description: "Reusable microfiber cleaning cloths — laundered by cleaner.",
    category: "OTHER",
    itemType: "REUSABLE_EQUIPMENT",
    unit: "ea",
    costPerUnit: 1.50,
    stockLevel: 120,
    minStock: 30,
    refillThreshold: 6,
  },
  {
    name: "Mop pads",
    description: "Replacement mop pads (washable).",
    category: "OTHER",
    itemType: "REUSABLE_EQUIPMENT",
    unit: "ea",
    costPerUnit: 4.00,
    stockLevel: 30,
    minStock: 6,
    refillThreshold: 2,
  },
  {
    name: "Toilet brush",
    description: "Standard-handle toilet brush — replaced quarterly.",
    category: "OTHER",
    itemType: "REUSABLE_EQUIPMENT",
    unit: "ea",
    costPerUnit: 4.50,
    stockLevel: 12,
    minStock: 4,
    refillThreshold: 1,
  },
  {
    name: "Vacuum bags",
    description: "Standard upright vacuum bags.",
    category: "DISPOSABLE",
    itemType: "COUNTABLE_CONSUMABLE",
    unit: "ea",
    costPerUnit: 2.75,
    stockLevel: 36,
    minStock: 6,
    refillThreshold: 1,
  },
  {
    name: "Bucket",
    description: "8-litre mop bucket with wringer (durable).",
    category: "OTHER",
    itemType: "REUSABLE_EQUIPMENT",
    unit: "ea",
    costPerUnit: 18.00,
    stockLevel: 6,
    minStock: 2,
    refillThreshold: 1,
  },
];

const LOCATIONS: { name: string; address: string }[] = [
  { name: "Main Warehouse", address: "1240 Industrial Blvd, Montreal, QC" },
  { name: "Mobile Storage Locker", address: "Cleaner van #1 — rotates daily" },
];

async function upsertProducts() {
  const results: Array<{ name: string; id: string }> = [];
  for (const p of PRODUCTS) {
    const existing = await db.product.findFirst({ where: { name: p.name } });
    if (existing) {
      const updated = await db.product.update({
        where: { id: existing.id },
        data: {
          description: p.description,
          category: p.category,
          // Re-seeded like `category` (and unlike cleanerRestockThreshold):
          // these 18 rows have one correct classification, so a re-run is the
          // cheapest way to repair a bucket that drifted back to "consumable".
          itemType: p.itemType,
          unit: p.unit,
          costPerUnit: p.costPerUnit,
          stockLevel: p.stockLevel,
          minStock: p.minStock,
        },
      });
      results.push({ name: updated.name, id: updated.id });
      console.log(`  ↻ Updated  ${p.name}`);
    } else {
      const created = await db.product.create({
        data: {
          name: p.name,
          description: p.description,
          category: p.category,
          itemType: p.itemType,
          unit: p.unit,
          costPerUnit: p.costPerUnit,
          stockLevel: p.stockLevel,
          minStock: p.minStock,
          // Deliberately set on CREATE only. The update branch above leaves it
          // alone so re-running the seed cannot clobber a threshold an admin
          // has since tuned in the product editor.
          cleanerRestockThreshold: p.refillThreshold,
        },
      });
      results.push({ name: created.name, id: created.id });
      console.log(`  + Created  ${p.name}`);
    }
  }
  return results;
}

async function upsertLocations(products: Array<{ name: string; id: string }>) {
  const locationIds: string[] = [];
  for (const loc of LOCATIONS) {
    const existing = await db.inventoryLocation.findFirst({ where: { name: loc.name } });
    if (existing) {
      await db.inventoryLocation.update({
        where: { id: existing.id },
        data: { address: loc.address, isActive: true },
      });
      locationIds.push(existing.id);
      console.log(`  ↻ Location  ${loc.name}`);
    } else {
      const created = await db.inventoryLocation.create({
        data: { name: loc.name, address: loc.address, isActive: true },
      });
      locationIds.push(created.id);
      console.log(`  + Location  ${loc.name}`);
    }
  }

  // Distribute stock: 75% to Main Warehouse, 25% to Mobile Locker.
  const [main, mobile] = locationIds;
  for (const p of PRODUCTS) {
    const productId = products.find((x) => x.name === p.name)?.id;
    if (!productId) continue;
    const mainQty = Math.round(p.stockLevel * 0.75);
    const mobileQty = p.stockLevel - mainQty;
    for (const [locId, qty] of [
      [main, mainQty],
      [mobile, mobileQty],
    ] as const) {
      await db.inventoryLocationStock.upsert({
        where: { locationId_productId: { locationId: locId, productId } },
        create: { locationId: locId, productId, quantity: qty },
        update: { quantity: qty },
      });
    }
  }
  console.log(`  ✓ Per-location stock split across ${LOCATIONS.length} locations`);
}

async function main() {
  console.log("\nSeeding inventory…\n");
  console.log("• Products");
  const products = await upsertProducts();
  console.log("\n• Locations + stock");
  await upsertLocations(products);
  console.log("\n✅ Done. Seeded", PRODUCTS.length, "products into", LOCATIONS.length, "locations.\n");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
