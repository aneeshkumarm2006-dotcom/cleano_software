// Inventory threshold rules (awer_fixes.pdf item 14).
//
// There are TWO thresholds and they answer different questions. Keeping them
// straight is the whole point of this module — before it, some paths fell back
// from the cleaner threshold to the company one, so a cleaner holding 3 bottles
// was judged against a warehouse reorder point of 20 and flagged as critical.
//
//   COMPANY REORDER  (Product.minStock)
//       "Does Cleano need to buy more?"  Applies to company/locker stock only.
//
//   CLEANER RESTOCK  (Product.cleanerRestockThreshold)
//       "Does this cleaner need topping up?"  Applies to a cleaner's kit only.
//
// A THIRD question was missing entirely until Stage 2 of
// `_ai_context/TODO.md` (cleano_inventory_operations_fixes.pdf #4):
//
//   IS THIS EVEN A CONSUMABLE?  (Product.itemType)
//       A scraper is not "low" because a cleaner holds one — one scraper is the
//       right number. Reusable equipment reports a CONDITION instead, and no
//       refill threshold applies to it at any quantity.
//
// PURE — no DB imports — so server and client apply an identical rule.

import type { ItemType } from "./item-type";
import { usesRefillThresholds } from "./item-type";
import {
  DEFAULT_EQUIPMENT_CONDITION,
  EQUIPMENT_CONDITION_LABEL,
  LIQUID_LEVEL_LABEL,
  conditionNeedsAttention,
  levelNeedsAttention,
  type EquipmentCondition,
  type LiquidLevel,
} from "./inventory-status";

export interface CompanyThresholdInput {
  stockLevel: number;
  minStock: number;
}

export interface CleanerThresholdInput {
  /** Product.cleanerRestockThreshold. */
  cleanerRestockThreshold: number;
  /**
   * Admin's global floor (`inventory.defaultRefillThreshold`) applied when the
   * product has no cleaner threshold of its own. Omit to use the built-in.
   *
   * Every server surface must pass this — see `inventory-thresholds.server.ts`.
   * Omitting it silently drops the threshold to 1, which is how the admin tabs
   * and the cleaner's own app came to disagree about what "Low" meant.
   */
  defaultThreshold?: number | null;
  /**
   * Product.itemType. Optional so pre-Stage-1 callers still compile, but a
   * caller that omits it gets the old, type-blind answer — pass it wherever the
   * product row is at hand.
   */
  itemType?: ItemType | null;
}

/** What a low-stock alert is actually telling the admin to do. */
export type LowStockKind = "COMPANY_PURCHASE" | "CLEANER_RESTOCK";

export const LOW_STOCK_LABEL: Record<LowStockKind, string> = {
  COMPANY_PURCHASE: "Company needs to purchase",
  CLEANER_RESTOCK: "Cleaner needs restock",
};

/**
 * Fallback when no cleaner restock threshold is configured.
 *
 * A configured value of 0 would mean "only warn once they are completely empty",
 * which strands a cleaner mid-job. Default to covering at least one more job.
 */
export const DEFAULT_CLEANER_RESTOCK_THRESHOLD = 1;

/** The company reorder point for a product. */
export function companyReorderThreshold(p: { minStock: number }): number {
  return Math.max(0, p.minStock ?? 0);
}

/**
 * The restock point for ONE cleaner's kit.
 *
 * NOTE: this deliberately does NOT fall back to `minStock`. That fallback was
 * the defect — the company reorder point has no bearing on how much one cleaner
 * should carry.
 *
 * It also no longer floors on `InventoryRule.usagePerJob` (awerfixes.pdf item
 * 14). That term raised the threshold to whatever an admin had once typed into
 * the Inventory Rules tab, so a stale guess silently decided when every cleaner
 * was warned — and products with no rule got no floor at all. The configured
 * product value and the admin's global default are the two knobs that remain,
 * and both are things someone actually maintains.
 */
export function cleanerRestockThreshold(p: CleanerThresholdInput): number {
  const configured = p.cleanerRestockThreshold ?? 0;
  if (configured > 0) return configured;
  return p.defaultThreshold != null && p.defaultThreshold > 0
    ? p.defaultThreshold
    : DEFAULT_CLEANER_RESTOCK_THRESHOLD;
}

/** Is company/locker stock at or below the reorder point? */
export function isCompanyLow(p: CompanyThresholdInput): boolean {
  const threshold = companyReorderThreshold(p);
  return threshold > 0 && (p.stockLevel ?? 0) <= threshold;
}

/**
 * Is this cleaner's kit at or below their restock point?
 *
 * Reusable equipment is ALWAYS false, whatever the quantity or the configured
 * threshold (PDF #4). This is the single line that stops "2-Sided Scraper —
 * LOW — Running low (1 Scrapers left)" from ever being rendered again: a tool
 * has a condition, not a fill level, and no amount of it is "running out".
 */
export function isCleanerLow(
  quantity: number,
  p: CleanerThresholdInput
): boolean {
  if (p.itemType && !usesRefillThresholds(p.itemType)) return false;
  return (quantity ?? 0) <= cleanerRestockThreshold(p);
}

/** Whether a company threshold was explicitly configured (vs left at 0). */
export function hasCompanyThreshold(p: { minStock: number }): boolean {
  return companyReorderThreshold(p) > 0;
}

/** Whether the cleaner threshold is the fallback rather than an admin setting. */
export function usesDefaultCleanerThreshold(p: CleanerThresholdInput): boolean {
  return (p.cleanerRestockThreshold ?? 0) <= 0;
}

/* ─────────────────────── one kit row's attention state ───────────────────── */

/**
 * How loudly a row should be rendered. Deliberately not a colour: the cleaner
 * app paints `.cl-pill` classes and the admin tabs paint `Badge` variants, and
 * neither should have to agree on a hex value to agree on the meaning.
 */
export type AttentionTone = "ok" | "warn" | "critical";

interface AttentionShared {
  /** Ready-to-render badge text. */
  label: string;
  tone: AttentionTone;
  /** Counts toward "NEEDS ATTENTION" on any surface that shows a total. */
  needsAttention: boolean;
}

/**
 * THE state of one cleaner-held item — the single thing every badge, pill,
 * filter and counter in the app is derived from.
 *
 * Consumables keep the OK/LOW/EMPTY vocabulary. Equipment gets its own arm, so
 * a caller cannot accidentally render "Low" for a tool: there is no LOW value
 * to reach for on that branch.
 */
export type ItemAttentionState =
  | (AttentionShared & { kind: "OK" })
  | (AttentionShared & { kind: "LOW" })
  | (AttentionShared & { kind: "EMPTY" })
  | (AttentionShared & { kind: "LEVEL"; level: LiquidLevel })
  | (AttentionShared & { kind: "CONDITION"; condition: EquipmentCondition });

export interface AttentionInput extends CleanerThresholdInput {
  /** EmployeeProduct.quantity. */
  quantity: number;
  /** EmployeeProduct.condition — equipment only; null = never reported. */
  condition?: EquipmentCondition | null;
  /** EmployeeProduct.levelStatus — liquids only; null = never reported. */
  levelStatus?: LiquidLevel | null;
}

/**
 * Classify one kit row.
 *
 * Equipment: reports its condition. An unreported tool is AVAILABLE (see
 * `DEFAULT_EQUIPMENT_CONDITION`) — EXCEPT when the kit holds none of it, which
 * is MISSING however you label it. A cleaner who has one working scraper lands
 * on `{ kind: "CONDITION", condition: "AVAILABLE", needsAttention: false }`,
 * which is the whole point of PDF #4.
 *
 * Liquids: report a LEVEL, once anybody has reported one. This arm exists
 * because Stage 3 stopped deducting estimated millilitres — the number on a
 * bottle's kit row no longer moves on its own, so judging it against a refill
 * threshold would say "OK" forever however empty the bottle actually is. What a
 * cleaner said at clock-out is now the only honest signal, so it wins. A liquid
 * nobody has reported on falls through to the threshold rule below, which is
 * exactly what it did before.
 *
 * Countables: unchanged threshold logic — empty at or below zero, low at or
 * below the cleaner restock threshold. The count IS the report for these.
 */
export function itemAttentionState(item: AttentionInput): ItemAttentionState {
  const quantity = item.quantity ?? 0;

  if (item.itemType === "REUSABLE_EQUIPMENT") {
    const condition: EquipmentCondition =
      item.condition ??
      (quantity <= 0 ? "MISSING" : DEFAULT_EQUIPMENT_CONDITION);
    return {
      kind: "CONDITION",
      condition,
      label: EQUIPMENT_CONDITION_LABEL[condition],
      tone: equipmentTone(condition),
      needsAttention: conditionNeedsAttention(condition),
    };
  }

  if (item.itemType === "LIQUID" && item.levelStatus) {
    const level = item.levelStatus;
    return {
      kind: "LEVEL",
      level,
      label: LIQUID_LEVEL_LABEL[level],
      tone: levelTone(level),
      needsAttention: levelNeedsAttention(level),
    };
  }

  if (quantity <= 0) {
    return { kind: "EMPTY", label: "Empty", tone: "critical", needsAttention: true };
  }
  if (isCleanerLow(quantity, item)) {
    return { kind: "LOW", label: "Low", tone: "warn", needsAttention: true };
  }
  return { kind: "OK", label: "OK", tone: "ok", needsAttention: false };
}

/**
 * An empty bottle stops the next job; a low one is a warning; anything from
 * half up is fine. Same shape as `equipmentTone`, and private for the same
 * reason: the tone can only ever come from `itemAttentionState()`.
 */
function levelTone(level: LiquidLevel): AttentionTone {
  switch (level) {
    case "FULL":
    case "GOOD":
    case "HALF":
      return "ok";
    case "LOW":
      return "warn";
    case "EMPTY":
      return "critical";
  }
}

/**
 * Missing and damaged tools stop a job; worn-out and unserviced ones don't yet.
 * Kept private so the tone can only ever come from `itemAttentionState()`.
 */
function equipmentTone(condition: EquipmentCondition): AttentionTone {
  switch (condition) {
    case "AVAILABLE":
      return "ok";
    case "MISSING":
    case "DAMAGED":
      return "critical";
    case "NEEDS_REPLACEMENT":
    case "NEEDS_MAINTENANCE":
      return "warn";
  }
}

/** Does this row's item type use refill thresholds at all? */
export function tracksRefill(itemType?: ItemType | null): boolean {
  return !itemType || usesRefillThresholds(itemType);
}
