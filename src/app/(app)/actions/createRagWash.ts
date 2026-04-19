"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";

interface CreateRagWashParams {
  employeeId: string;
  washDate: string;
  ragCount: number;
  notes?: string;
}

export async function createRagWash(params: CreateRagWashParams) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };
    const role = (session.user as { role?: string }).role;
    if (role !== "OWNER" && role !== "ADMIN") {
      return { success: false, error: "Not authorized" };
    }

    const { employeeId, washDate, ragCount, notes } = params;
    if (!employeeId) {
      return { success: false, error: "Employee is required" };
    }
    if (ragCount < 1) {
      return { success: false, error: "Rag count must be at least 1" };
    }

    const employee = await db.user.findUnique({ where: { id: employeeId } });
    if (!employee) return { success: false, error: "Employee not found" };

    await db.ragWash.create({
      data: {
        employeeId,
        washDate: new Date(washDate),
        ragCount,
        notes: notes || null,
      },
    });

    revalidatePath("/inventory/rag-wash");
    revalidatePath(`/inventory/rag-wash/${employeeId}`);
    return { success: true };
  } catch (error) {
    console.error("Error creating rag wash:", error);
    return { success: false, error: "Failed to create rag wash entry" };
  }
}
