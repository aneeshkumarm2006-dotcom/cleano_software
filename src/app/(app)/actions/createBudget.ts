"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import { TransactionCategory } from "@prisma/client";

interface CreateBudgetParams {
  category: TransactionCategory;
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

    if (!params.category) {
      return { success: false, error: "Category is required" };
    }
    if (!params.period?.trim()) {
      return { success: false, error: "Period is required (e.g. 2026-04)" };
    }
    if (!Number.isFinite(params.amount) || params.amount < 0) {
      return { success: false, error: "Amount must be a valid number" };
    }

    const budget = await db.budget.upsert({
      where: {
        category_period: {
          category: params.category,
          period: params.period.trim(),
        },
      },
      create: {
        category: params.category,
        period: params.period.trim(),
        amount: params.amount,
        notes: params.notes?.trim() || null,
      },
      update: {
        amount: params.amount,
        notes: params.notes?.trim() || null,
      },
    });

    revalidatePath("/finances");
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
    revalidatePath("/finances");
    return { success: true };
  } catch (error) {
    console.error("Error deleting budget:", error);
    return { success: false, error: "Failed to delete budget" };
  }
}
