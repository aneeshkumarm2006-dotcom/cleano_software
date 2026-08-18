// Inventory item-type classification (cleano_inventory_operations_fixes.pdf
// #1 + #4). Stage 1 of `_ai_context/TODO.md`.
//
// `ProductCategory` answers "how did the cleaner log usage at clock-out?".
// `ItemType` answers the different, more basic question — WHAT KIND of thing is
// this — and is what every threshold and status rule branches on from Stage 2
// onward:
//
//   LIQUID                liquids & dilutables  → level reporting (Full…Empty)
//   COUNTABLE_CONSUMABLE  gloves, bags, rolls   → quantity + status reporting
//   REUSABLE_EQUIPMENT    scrapers, brooms,     → condition reporting only;
//                         vacuums, mops,          refill thresholds NEVER apply
//                         buckets
//
// PURE — no DB, no framework imports — so the product modal, the server
// actions, the CSV importer and the one-off backfill script all classify a
// product exactly the same way.

/** The item types, in the order they are offered in the UI. */
export const ITEM_TYPES = [
  "LIQUID",
  "COUNTABLE_CONSUMABLE",
  "REUSABLE_EQUIPMENT",
] as const;

export type ItemType = (typeof ITEM_TYPES)[number];

/** Default for anything unclassified: today's rules, unchanged. */
export const DEFAULT_ITEM_TYPE: ItemType = "COUNTABLE_CONSUMABLE";

/** Short label — what fits in a table chip. */
export const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  LIQUID: "Liquid",
  COUNTABLE_CONSUMABLE: "Countable",
  REUSABLE_EQUIPMENT: "Equipment",
};

/** Full label — what a picker or a bulk-action button says. */
export const ITEM_TYPE_NAME: Record<ItemType, string> = {
  LIQUID: "Liquid / dilutable",
  COUNTABLE_CONSUMABLE: "Countable consumable",
  REUSABLE_EQUIPMENT: "Reusable equipment / tool",
};

/** The PDF's plain-English description, shown next to each option. */
export const ITEM_TYPE_DESCRIPTION: Record<ItemType, string> = {
  LIQUID:
    "Sprays, floor solutions, dilutables — reported as a level (Full / Good / Half / Low / Empty)",
  COUNTABLE_CONSUMABLE:
    "Gloves, bags, rolls, sponges — reported as a count plus a status; gets refill thresholds",
  REUSABLE_EQUIPMENT:
    "Scrapers, brooms, vacuums, mops, buckets — reported by condition only; never runs low",
};

/** Type guard for anything arriving from a form, a CSV cell, or an API body. */
export function isItemType(value: unknown): value is ItemType {
  return (
    typeof value === "string" && (ITEM_TYPES as readonly string[]).includes(value)
  );
}

/** Parse an untrusted value, falling back to `fallback` when it isn't valid. */
export function parseItemType(
  value: unknown,
  fallback: ItemType = DEFAULT_ITEM_TYPE
): ItemType {
  return isItemType(value) ? value : fallback;
}

/** Refill/low thresholds are meaningless for a tool the cleaner keeps. */
export function usesRefillThresholds(itemType: ItemType): boolean {
  return itemType !== "REUSABLE_EQUIPMENT";
}

/**
 * Names that mean "this is a tool, not a consumable".
 *
 * The `mop(?!.*(soap|solution|liquid))` lookahead keeps "Mop pads" (equipment)
 * apart from "Mop liquid"/"Murphy Oil Soap" (liquid), and `bag(?! liner)` keeps
 * a reusable tool bag apart from a box of bag liners.
 *
 * A heuristic is a starting point, not an answer: `prisma/backfillItemTypes.ts`
 * prints everything it matched for admin review, and the products list has a
 * bulk "Set item type" action to fix whatever it got wrong.
 */
export const EQUIPMENT_NAME_PATTERN =
  /scraper|broom|vacuum|steam|mop(?!.*(soap|solution|liquid))|bucket|cart|brush|squeegee|caddy|duster|steamer|bag(?! liner)|rag/i;

/** Item type implied by a product name alone, or null when nothing matches. */
export function inferItemTypeFromName(name: string): ItemType | null {
  return EQUIPMENT_NAME_PATTERN.test(name ?? "") ? "REUSABLE_EQUIPMENT" : null;
}

/**
 * Best guess for a product that has no item type yet.
 *
 * The legacy category is trusted where it is actually informative — a
 * LIQUID_SPRAY is a liquid, a DISPOSABLE is a countable consumable. Only
 * `OTHER`, the bucket everything durable was dumped into, falls through to the
 * name heuristic; anything it doesn't recognise stays a countable consumable,
 * which is the status quo.
 */
export function inferItemType(p: {
  name: string;
  category?: string | null;
}): ItemType {
  switch (p.category) {
    case "LIQUID_SPRAY":
    case "MOP_LIQUID":
      return "LIQUID";
    case "DISPOSABLE":
      return "COUNTABLE_CONSUMABLE";
    default:
      return inferItemTypeFromName(p.name) ?? DEFAULT_ITEM_TYPE;
  }
}
