"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import { TransactionCategory } from "@prisma/client";

interface UpdateBudgetParams {
  id: string;
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

export async function updateBudget(params: UpdateBudgetParams) {
  try {
    const guard = await requireAdmin();
    if ("error" in guard) return { success: false, error: guard.error };

    if (!params.id) {
      return { success: false, error: "Budget id is required" };
    }
    if (!params.category) {
      return { success: false, error: "Category is required" };
    }
    if (!params.period?.trim()) {
      return { success: false, error: "Period is required" };
    }
    if (!Number.isFinite(params.amount) || params.amount < 0) {
      return { success: false, error: "Amount must be a valid number" };
    }

    await db.budget.update({
      where: { id: params.id },
      data: {
        category: params.category,
        period: params.period.trim(),
        amount: params.amount,
        notes: params.notes?.trim() || null,
      },
    });

    revalidatePath("/finances");
    return { success: true };
  } catch (error) {
    console.error("Error updating budget:", error);
    return { success: false, error: "Failed to update budget" };
  }
}
