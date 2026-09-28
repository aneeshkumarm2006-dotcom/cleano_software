import type { BudgetCategoryKind } from "@prisma/client";

export type { BudgetCategoryKind };

/**
 * A budget/transaction category as the finance screens see it.
 *
 * Rows carry only `categoryId`; the name is looked up through this list rather
 * than denormalized onto each row, so renaming a category in Settings updates
 * every historical transaction, budget, statement line and chart label at once
 * — which is exactly what "renames it and history follows" has to mean.
 *
 * Archived categories stay in this list (that is how old rows keep a name) and
 * are filtered out of the pickers by `pickableCategories`.
 */
export interface BudgetCategoryOption {
  id: string;
  name: string;
  slug: string;
  kind: BudgetCategoryKind;
  isDefault: boolean;
  sortOrder: number;
  archived: boolean;
  /** Rows pointing at it — drives archive-instead-of-delete in the editor. */
  budgetCount: number;
  transactionCount: number;
}

export interface TransactionRow {
  id: string;
  date: string;
  categoryId: string;
  amount: number;
  description: string | null;
  notes: string | null;
  jobId: string | null;
  jobClientName: string | null;
  source: string | null;
  taxAmount: number;
  isAuto: boolean;
}

export interface BudgetRow {
  id: string;
  categoryId: string;
  period: string;
  amount: number;
  notes: string | null;
}

export interface TaxConfig {
  gstRate: number;
  qstRate: number;
  gstNumber: string;
  qstNumber: string;
}

export interface JobOption {
  id: string;
  label: string;
}

// ── Category lookups ────────────────────────────────────────────────────────

export type CategoryIndex = Map<string, BudgetCategoryOption>;

export function indexCategories(
  categories: BudgetCategoryOption[]
): CategoryIndex {
  return new Map(categories.map((c) => [c.id, c]));
}

/**
 * Display name for a row's category. The fallback should be unreachable — the
 * FK is NOT NULL and the page hands down every category including archived
 * ones — but a statement line reading "Unknown category" beats a blank cell.
 */
export function categoryLabel(index: CategoryIndex, id: string): string {
  return index.get(id)?.name ?? "Unknown category";
}

/**
 * Money in vs money out. This is what `category === "REVENUE"` used to be, and
 * it is now a property of the category rather than a hardcoded name, so an
 * admin can add a second income line ("Tips", "Product sales") without it
 * silently subtracting from profit.
 */
export function isRevenueCategory(index: CategoryIndex, id: string): boolean {
  return index.get(id)?.kind === "REVENUE";
}

/** Selectable in a form: archived categories keep history but take no new rows. */
export function pickableCategories(
  categories: BudgetCategoryOption[]
): BudgetCategoryOption[] {
  return categories.filter((c) => !c.archived);
}

export function categoryOptions(
  categories: BudgetCategoryOption[]
): { value: string; label: string }[] {
  return pickableCategories(categories).map((c) => ({
    value: c.id,
    label: c.name,
  }));
}

/**
 * Does "Delete" archive this category rather than remove it?
 *
 * Exported (rather than inlined at both sites) because the server action and
 * the Settings UI must agree: the button has to promise the same thing the
 * action will do, or an admin clicks "Delete" and finds the category still on
 * last quarter's income statement.
 *
 *  - carries budgets or transactions → archive; deleting it would take the
 *    history with it, and `onDelete: Restrict` would refuse anyway;
 *  - one of the five defaults → archive; `revenue`, `supplies` and `labour`
 *    are the buckets the app posts to automatically.
 */
export function archivesInsteadOfDeleting(category: {
  isDefault: boolean;
  budgetCount: number;
  transactionCount: number;
}): boolean {
  return (
    category.isDefault ||
    category.budgetCount > 0 ||
    category.transactionCount > 0
  );
}

export function formatMonth(isoDate: string): string {
  const d = new Date(isoDate);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function formatCurrency(n: number): string {
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
