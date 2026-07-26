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
// PURE — no DB imports — so server and client apply an identical rule.

export interface CompanyThresholdInput {
  stockLevel: number;
  minStock: number;
}

export interface CleanerThresholdInput {
  /** Product.cleanerRestockThreshold. */
  cleanerRestockThreshold: number;
  /** InventoryRule.usagePerJob, when configured. Used only for the default. */
  usagePerJob?: number | null;
  /**
   * Admin's global floor (`inventory.defaultRefillThreshold`) applied when the
   * product has no cleaner threshold of its own. Omit to use the built-in.
   */
  defaultThreshold?: number | null;
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
 */
export function cleanerRestockThreshold(p: CleanerThresholdInput): number {
  const configured = p.cleanerRestockThreshold ?? 0;
  if (configured > 0) return configured;
  const floor =
    p.defaultThreshold != null && p.defaultThreshold > 0
      ? p.defaultThreshold
      : DEFAULT_CLEANER_RESTOCK_THRESHOLD;
  return Math.max(floor, p.usagePerJob ?? 0);
}

/** Is company/locker stock at or below the reorder point? */
export function isCompanyLow(p: CompanyThresholdInput): boolean {
  const threshold = companyReorderThreshold(p);
  return threshold > 0 && (p.stockLevel ?? 0) <= threshold;
}

/** Is this cleaner's kit at or below their restock point? */
export function isCleanerLow(
  quantity: number,
  p: CleanerThresholdInput
): boolean {
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
