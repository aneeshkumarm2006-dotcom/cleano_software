"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import { TransactionCategory } from "@prisma/client";

interface UpdateTransactionParams {
  id: string;
  date: string;
  category: TransactionCategory;
  amount: number;
  description?: string | null;
  notes?: string | null;
  jobId?: string | null;
  source?: string | null;
  taxAmount?: number;
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

export async function updateTransaction(params: UpdateTransactionParams) {
  try {
    const guard = await requireAdmin();
    if ("error" in guard) return { success: false, error: guard.error };

    if (!params.id) {
      return { success: false, error: "Transaction id is required" };
    }
    if (!params.category) {
      return { success: false, error: "Category is required" };
    }
    if (!Number.isFinite(params.amount) || params.amount <= 0) {
      return { success: false, error: "Amount must be a positive number" };
    }
    const date = new Date(params.date);
    if (isNaN(date.getTime())) {
      return { success: false, error: "Invalid date" };
    }

    await db.transaction.update({
      where: { id: params.id },
      data: {
        date,
        category: params.category,
        amount: params.amount,
        description: params.description?.trim() || null,
        notes: params.notes?.trim() || null,
        jobId: params.jobId || null,
        source: params.source?.trim() || null,
        taxAmount: params.taxAmount ?? 0,
      },
    });

    revalidatePath("/finances");
    return { success: true };
  } catch (error) {
    console.error("Error updating transaction:", error);
    return { success: false, error: "Failed to update transaction" };
  }
}
