"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";

interface UpdateRagWashParams {
  id: string;
  washDate?: string;
  ragCount?: number;
  notes?: string;
}

export async function updateRagWash(params: UpdateRagWashParams) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };
    const role = (session.user as { role?: string }).role;
    if (role !== "OWNER" && role !== "ADMIN") {
      return { success: false, error: "Not authorized" };
    }

    const { id, washDate, ragCount, notes } = params;
    if (!id) return { success: false, error: "Rag wash ID is required" };

    const existing = await db.ragWash.findUnique({ where: { id } });
    if (!existing) return { success: false, error: "Rag wash entry not found" };

    if (ragCount !== undefined && ragCount < 1) {
      return { success: false, error: "Rag count must be at least 1" };
    }

    await db.ragWash.update({
      where: { id },
      data: {
        ...(washDate && { washDate: new Date(washDate) }),
        ...(ragCount !== undefined && { ragCount }),
        ...(notes !== undefined && { notes: notes || null }),
      },
    });

    revalidatePath("/inventory/rag-wash");
    revalidatePath(`/inventory/rag-wash/${existing.employeeId}`);
    return { success: true };
  } catch (error) {
    console.error("Error updating rag wash:", error);
    return { success: false, error: "Failed to update rag wash entry" };
  }
}

export async function deleteRagWash(id: string) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };
    const role = (session.user as { role?: string }).role;
    if (role !== "OWNER" && role !== "ADMIN") {
      return { success: false, error: "Not authorized" };
    }

    const existing = await db.ragWash.findUnique({ where: { id } });
    if (!existing) return { success: false, error: "Rag wash entry not found" };

    await db.ragWash.delete({ where: { id } });

    revalidatePath("/inventory/rag-wash");
    revalidatePath(`/inventory/rag-wash/${existing.employeeId}`);
    return { success: true };
  } catch (error) {
    console.error("Error deleting rag wash:", error);
    return { success: false, error: "Failed to delete rag wash entry" };
  }
}
