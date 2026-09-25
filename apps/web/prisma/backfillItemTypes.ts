/**
 * One-time, idempotent backfill for Stage 1 of `_ai_context/TODO.md`:
 * classify every existing Product as LIQUID / COUNTABLE_CONSUMABLE /
 * REUSABLE_EQUIPMENT, and mark the equipment already sitting in cleaner kits as
 * AVAILABLE so nothing reads as "condition unknown" on day one.
 *
 *   npx tsx prisma/backfillItemTypes.ts            # apply
 *   npx tsx prisma/backfillItemTypes.ts --dry-run  # report only, write nothing
 *
 * Mirrors the style of `prisma/backfillLocationStock.ts`: safe to run twice, the
 * second run changes 0 rows.
 *
 * ── Read the table it prints ───────────────────────────────────────────────
 * The rule is `inferItemType()` in `src/lib/item-type.ts`: the legacy category
 * decides liquids and disposables, and only `OTHER` — the bucket every durable
 * good was dumped into — falls through to a name regex. A regex cannot know
 * that "Magic erasers" are disposable and a "2-Sided Scraper" is not, so this
 * script PRINTS every classification rather than silently trusting itself.
 * Fix whatever it got wrong from the products list: select the rows →
 * "Set item type". Nothing here is irreversible.
 *
 * Archived (soft-deleted) products are included on purpose — they can still sit
 * in a cleaner's kit, and Stage 5 has to be able to edit those rows.
 */

import { PrismaClient } from "@prisma/client";
import {
  ITEM_TYPE_LABEL,
  inferItemType,
  type ItemType,
} from "../src/lib/item-type";

const db = new PrismaClient();

const DRY_RUN = process.argv.includes("--dry-run");

function pad(s: string, width: number): string {
  return s.length >= width ? s.slice(0, width) : s + " ".repeat(width - s.length);
}

async function main() {
  // No `deletedAt: null` filter — archived products are still assigned to
  // cleaners and still need a type.
  const products = await db.product.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      category: true,
      itemType: true,
      deletedAt: true,
    },
  });

  console.log(
    `\nClassifying ${products.length} product(s)${DRY_RUN ? " (dry run)" : ""}…\n`
  );
  console.log(
    `  ${pad("PRODUCT", 30)} ${pad("CATEGORY", 14)} ${pad("FROM", 11)} ${pad("TO", 11)} CHANGE`
  );
  console.log(`  ${"─".repeat(85)}`);

  const counts: Record<ItemType, number> = {
    LIQUID: 0,
    COUNTABLE_CONSUMABLE: 0,
    REUSABLE_EQUIPMENT: 0,
  };
  let changed = 0;

  for (const p of products) {
    const target = inferItemType({ name: p.name, category: p.category });
    counts[target]++;
    const isChange = p.itemType !== target;
    if (isChange) changed++;

    console.log(
      `  ${pad(p.name + (p.deletedAt ? " (archived)" : ""), 30)} ` +
        `${pad(p.category, 14)} ` +
        `${pad(ITEM_TYPE_LABEL[p.itemType], 11)} ` +
        `${pad(ITEM_TYPE_LABEL[target], 11)} ` +
        `${isChange ? "← updated" : "unchanged"}`
    );

    if (isChange && !DRY_RUN) {
      await db.product.update({
        where: { id: p.id },
        data: { itemType: target },
      });
    }
  }

  // Equipment a cleaner already holds is, absent any report to the contrary,
  // available. Only rows with no condition yet are touched, so a re-run cannot
  // overwrite a DAMAGED/MISSING report someone has since filed.
  const equipmentIds = products
    .filter((p) => inferItemType({ name: p.name, category: p.category }) === "REUSABLE_EQUIPMENT")
    .map((p) => p.id);

  let conditionsSet = 0;
  if (equipmentIds.length > 0) {
    if (DRY_RUN) {
      conditionsSet = await db.employeeProduct.count({
        where: { productId: { in: equipmentIds }, condition: null },
      });
    } else {
      const res = await db.employeeProduct.updateMany({
        where: { productId: { in: equipmentIds }, condition: null },
        data: { condition: "AVAILABLE" },
      });
      conditionsSet = res.count;
    }
  }

  console.log(
    `\n  Totals: ${counts.LIQUID} liquid · ` +
      `${counts.COUNTABLE_CONSUMABLE} countable · ` +
      `${counts.REUSABLE_EQUIPMENT} equipment`
  );
  console.log(
    DRY_RUN
      ? `  Would update ${changed} product(s) and set ${conditionsSet} kit row(s) to AVAILABLE. Nothing written.`
      : `  Updated ${changed} product(s); set ${conditionsSet} kit row(s) to condition AVAILABLE.`
  );
  console.log(
    `\n  Review the table above. Anything misclassified can be fixed in one pass:` +
      `\n  Admin → Inventory → Products → select rows → "Set item type".\n`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
