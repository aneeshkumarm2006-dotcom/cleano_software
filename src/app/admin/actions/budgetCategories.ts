"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/org-db";
import { revalidatePath } from "next/cache";
import type { BudgetCategoryKind } from "@prisma/client";
import {
  normalizeCategoryName,
  slugifyCategoryName,
} from "@/lib/budget-categories";
import { archivesInsteadOfDeleting } from "../finances/types";

/**
 * Add / rename / delete budget categories (client item 12 · Stage 8.3).
 *
 * Two rules run through all of it:
 *
 *  1. **Delete never loses money.** A category with budgets or transactions is
 *     archived — gone from every picker, still naming its history. Only an
 *     empty, non-default category is actually removed. The FKs are `RESTRICT`
 *     as a backstop.
 *  2. **`slug` is immutable.** Renaming changes the display name only, so the
 *     automatic writers (Stripe → `revenue`, clock-out → `supplies`, pay
 *     periods → `labour`) keep resolving, and every historical row picks up the
 *     new name for free.
 */

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Not authenticated" as const };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { error: "Not authorized" as const };
  }
  return { session };
}

/** Every screen that renders a category name or picker. */
function revalidateCategoryConsumers() {
  revalidatePath("/admin/settings");
  revalidatePath("/admin/finances");
  revalidatePath("/admin/analytics");
}

const MAX_NAME = 40;

function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Category name is required";
  if (trimmed.length > MAX_NAME) {
    return `Category name must be ${MAX_NAME} characters or fewer`;
  }
  return null;
}

/**
 * Case- and accent-insensitive duplicate check across ALL categories, archived
 * included: two rows both showing "Marketing" is confusing enough live, and
 * indistinguishable once one of them is only visible in history.
 */
async function nameTaken(name: string, exceptId?: string): Promise<boolean> {
  const target = normalizeCategoryName(name);
  const all = await db.budgetCategory.findMany({
    select: { id: true, name: true },
  });
  return all.some(
    (c) => c.id !== exceptId && normalizeCategoryName(c.name) === target
  );
}

/** `marketing`, `marketing-2`, `marketing-3`… — slugs are permanent, so unique. */
async function uniqueSlug(name: string): Promise<string> {
  const base = slugifyCategoryName(name) || "category";
  const existing = await db.budgetCategory.findMany({
    where: { slug: { startsWith: base } },
    select: { slug: true },
  });
  const taken = new Set(existing.map((c) => c.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 500; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export async function createBudgetCategory(params: {
  name: string;
  kind: BudgetCategoryKind;
}) {
  try {
    const guard = await requireAdmin();
    if ("error" in guard) return { success: false, error: guard.error };

    const nameError = validateName(params.name);
    if (nameError) return { success: false, error: nameError };
    const name = params.name.trim();

    if (await nameTaken(name)) {
      return { success: false, error: `"${name}" already exists` };
    }

    const last = await db.budgetCategory.findFirst({
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    const created = await db.budgetCategory.create({
      data: {
        name,
        slug: await uniqueSlug(name),
        kind: params.kind === "REVENUE" ? "REVENUE" : "EXPENSE",
        isDefault: false,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });

    revalidateCategoryConsumers();
    // The created row travels back so Settings can put it in the table
    // immediately. `revalidatePath` only marks the route stale — the repaint
    // still waits on a full re-render of a page that queries every settings
    // section, which on a slow link is tens of seconds during which the admin
    // sees "added." above a table that has not changed.
    return {
      success: true,
      id: created.id,
      category: {
        id: created.id,
        name: created.name,
        slug: created.slug,
        kind: created.kind,
        isDefault: created.isDefault,
        sortOrder: created.sortOrder,
        archived: false,
        budgetCount: 0,
        transactionCount: 0,
      },
    };
  } catch (error) {
    console.error("Error creating budget category:", error);
    return { success: false, error: "Failed to create category" };
  }
}

export async function updateBudgetCategory(params: {
  id: string;
  name: string;
  kind: BudgetCategoryKind;
}) {
  try {
    const guard = await requireAdmin();
    if ("error" in guard) return { success: false, error: guard.error };

    if (!params.id) return { success: false, error: "Category id is required" };
    const nameError = validateName(params.name);
    if (nameError) return { success: false, error: nameError };
    const name = params.name.trim();

    const existing = await db.budgetCategory.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!existing) return { success: false, error: "Category not found" };

    if (await nameTaken(name, params.id)) {
      return { success: false, error: `"${name}" already exists` };
    }

    // `slug` is deliberately absent from this update — see the module note.
    await db.budgetCategory.update({
      where: { id: params.id },
      data: { name, kind: params.kind === "REVENUE" ? "REVENUE" : "EXPENSE" },
    });

    revalidateCategoryConsumers();
    return { success: true };
  } catch (error) {
    console.error("Error updating budget category:", error);
    return { success: false, error: "Failed to update category" };
  }
}

/**
 * Delete if it is safe to, archive if it is not.
 *
 * Returns `archived: true` when the row survived, so the UI can say which
 * happened instead of leaving the admin wondering why the name is still on
 * last quarter's income statement.
 */
export async function deleteBudgetCategory(id: string) {
  try {
    const guard = await requireAdmin();
    if ("error" in guard) return { success: false, error: guard.error };

    if (!id) return { success: false, error: "Category id is required" };

    const category = await db.budgetCategory.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        isDefault: true,
        archivedAt: true,
        _count: { select: { budgets: true, transactions: true } },
      },
    });
    if (!category) return { success: false, error: "Category not found" };

    // Same predicate the Settings UI uses to word the button — see
    // `archivesInsteadOfDeleting` for why each case archives.
    if (
      archivesInsteadOfDeleting({
        isDefault: category.isDefault,
        budgetCount: category._count.budgets,
        transactionCount: category._count.transactions,
      })
    ) {
      if (category.archivedAt) {
        return { success: true, archived: true, name: category.name };
      }
      await db.budgetCategory.update({
        where: { id },
        data: { archivedAt: new Date() },
      });
      revalidateCategoryConsumers();
      return { success: true, archived: true, name: category.name };
    }

    await db.budgetCategory.delete({ where: { id } });
    revalidateCategoryConsumers();
    return { success: true, archived: false, name: category.name };
  } catch (error) {
    console.error("Error deleting budget category:", error);
    return { success: false, error: "Failed to delete category" };
  }
}

export async function restoreBudgetCategory(id: string) {
  try {
    const guard = await requireAdmin();
    if ("error" in guard) return { success: false, error: guard.error };

    if (!id) return { success: false, error: "Category id is required" };

    await db.budgetCategory.update({
      where: { id },
      data: { archivedAt: null },
    });

    revalidateCategoryConsumers();
    return { success: true };
  } catch (error) {
    console.error("Error restoring budget category:", error);
    return { success: false, error: "Failed to restore category" };
  }
}

/**
 * Move one category up or down the list. Re-indexes every row sequentially
 * rather than swapping two values, so an order that has drifted (equal or
 * duplicated `sortOrder`s) is repaired by the first move instead of silently
 * refusing to budge.
 */
export async function moveBudgetCategory(id: string, direction: "up" | "down") {
  try {
    const guard = await requireAdmin();
    if ("error" in guard) return { success: false, error: guard.error };

    const all = await db.budgetCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true },
    });
    const from = all.findIndex((c) => c.id === id);
    if (from === -1) return { success: false, error: "Category not found" };

    const to = direction === "up" ? from - 1 : from + 1;
    if (to < 0 || to >= all.length) return { success: true };

    const reordered = [...all];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);

    // Interactive form, not `$transaction([...])`: the tenant client rejects
    // the array form on purpose (see org-db.ts) and runs eagerly, so the mapped
    // updates would already have fired before the throw.
    await db.$transaction(async (tx) => {
      for (const [i, c] of reordered.entries()) {
        await tx.budgetCategory.update({
          where: { id: c.id },
          data: { sortOrder: i },
        });
      }
    });

    revalidateCategoryConsumers();
    return { success: true };
  } catch (error) {
    console.error("Error reordering budget categories:", error);
    return { success: false, error: "Failed to reorder categories" };
  }
}
