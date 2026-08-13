"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";

interface CreateBudgetParams {
  categoryId: string;
  period: string;
  amount: number;
  notes?: string | null;
}

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Not authenticated" as const };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { error: "Not authorized" as const };
  }
  return { session };
}

export async function createBudget(params: CreateBudgetParams) {
  try {
    const guard = await requireAdmin();
    if ("error" in guard) return { success: false, error: guard.error };

    if (!params.categoryId) {
      return { success: false, error: "Category is required" };
    }
    if (!params.period?.trim()) {
      return { success: false, error: "Period is required (e.g. 2026-04)" };
    }
    if (!Number.isFinite(params.amount) || params.amount < 0) {
      return { success: false, error: "Amount must be a valid number" };
    }

    // The picker only offers live categories, but a stale tab could still
    // submit one that was archived in between.
    const category = await db.budgetCategory.findUnique({
      where: { id: params.categoryId },
      select: { archivedAt: true, name: true },
    });
    if (!category) return { success: false, error: "Category not found" };
    if (category.archivedAt) {
      return {
        success: false,
        error: `"${category.name}" has been archived — pick another category`,
      };
    }

    const budget = await db.budget.upsert({
      where: {
        categoryId_period: {
          categoryId: params.categoryId,
          period: params.period.trim(),
        },
      },
      create: {
        categoryId: params.categoryId,
        period: params.period.trim(),
        amount: params.amount,
        notes: params.notes?.trim() || null,
      },
      update: {
        amount: params.amount,
        notes: params.notes?.trim() || null,
      },
    });

    revalidatePath("/admin/finances");
    revalidatePath("/admin/settings");
    revalidatePath("/admin/analytics");
    return { success: true, id: budget.id };
  } catch (error) {
    console.error("Error creating budget:", error);
    return { success: false, error: "Failed to save budget" };
  }
}

export async function deleteBudget(id: string) {
  try {
    const guard = await requireAdmin();
    if ("error" in guard) return { success: false, error: guard.error };

    if (!id) return { success: false, error: "Budget id is required" };

    await db.budget.delete({ where: { id } });
    revalidatePath("/admin/finances");
    revalidatePath("/admin/settings");
    revalidatePath("/admin/analytics");
    return { success: true };
  } catch (error) {
    console.error("Error deleting budget:", error);
    return { success: false, error: "Failed to delete budget" };
  }
}
