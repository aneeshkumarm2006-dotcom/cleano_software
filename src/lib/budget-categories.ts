import { db } from "@/lib/org-db";
import type { BudgetCategory, BudgetCategoryKind } from "@prisma/client";
// Type-only, so nothing from this server module leaks into the client bundle.
// The DTO is declared next to the screens that consume it.
import type { BudgetCategoryOption } from "@/app/admin/finances/types";

/**
 * Budget / transaction categories (client item 12 · Stage 8).
 *
 * These were the `TransactionCategory` enum until the `20260812020000_budget_categories`
 * migration. They now live in a table so the client can add their own, and this
 * module is the one place that knows about the five seeded defaults.
 *
 * The rule that keeps everything else working: **a category's `slug` is its
 * permanent identity**. It is assigned once, at creation, and renaming never
 * touches it. Every automatic writer below resolves by slug, so an admin can
 * rename "Labour" to "Payroll" and the pay-period posting still lands in the
 * right bucket — with the new name, on every historical row.
 */

/** Slugs the application itself writes to. Never renamed, never hard-deleted. */
export const SYSTEM_CATEGORY_SLUGS = ["revenue", "supplies", "labour"] as const;
export type SystemCategorySlug = (typeof SYSTEM_CATEGORY_SLUGS)[number];

export interface DefaultCategorySeed {
  slug: string;
  name: string;
  kind: BudgetCategoryKind;
  sortOrder: number;
}

/**
 * Mirrors the seed block in `20260812020000_budget_categories/migration.sql`.
 * Kept here so `requireBudgetCategoryId` can re-create a default row that some
 * future hand-edit deletes: an automatic payment posting must never fail
 * because a category row went missing.
 */
export const DEFAULT_BUDGET_CATEGORIES: readonly DefaultCategorySeed[] = [
  { slug: "revenue", name: "Revenue", kind: "REVENUE", sortOrder: 0 },
  { slug: "supplies", name: "Supplies", kind: "EXPENSE", sortOrder: 1 },
  { slug: "labour", name: "Labour", kind: "EXPENSE", sortOrder: 2 },
  { slug: "overhead", name: "Overhead", kind: "EXPENSE", sortOrder: 3 },
  { slug: "other", name: "Other", kind: "EXPENSE", sortOrder: 4 },
];

/**
 * Category id for one of the seeded slugs, for the code paths that post money
 * automatically (Stripe receipts and refunds → `revenue`, clock-out supply
 * usage → `supplies`, completed pay periods → `labour`).
 *
 * Deliberately uncached: a stale id would silently misfile money, and these
 * callers already run several queries. Self-heals if the row is missing so a
 * payment webhook can't 500 on a bookkeeping detail.
 */
export async function requireBudgetCategoryId(slug: string): Promise<string> {
  const found = await db.budgetCategory.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (found) return found.id;

  const seed = DEFAULT_BUDGET_CATEGORIES.find((c) => c.slug === slug);
  if (!seed) {
    throw new Error(`Unknown budget category slug: ${slug}`);
  }
  const created = await db.budgetCategory.upsert({
    where: { slug: seed.slug },
    create: { ...seed, isDefault: true },
    update: {},
    select: { id: true },
  });
  return created.id;
}

/** Every category in display order, archived ones included. */
export async function listBudgetCategories(): Promise<BudgetCategory[]> {
  return db.budgetCategory.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

/**
 * The category list every finance screen is handed. **Archived categories are
 * included on purpose** — they are how a transaction filed under a since-retired
 * category still renders a name. The pickers drop them (`pickableCategories`).
 *
 * The row counts come along because the editor needs them to decide whether
 * "Delete" means delete or archive, and to say so before the admin clicks.
 */
export async function getBudgetCategoryOptions(): Promise<
  BudgetCategoryOption[]
> {
  const rows = await db.budgetCategory.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { budgets: true, transactions: true } } },
  });
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    kind: c.kind,
    isDefault: c.isDefault,
    sortOrder: c.sortOrder,
    archived: c.archivedAt !== null,
    budgetCount: c._count.budgets,
    transactionCount: c._count.transactions,
  }));
}

/**
 * URL-safe identity for a new category name. Only ever runs at creation —
 * see the module note on why renames leave the slug alone.
 */
export function slugifyCategoryName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Free of accents, case and spacing — what "already exists?" should mean. */
export function normalizeCategoryName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
