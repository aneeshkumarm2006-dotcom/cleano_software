"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";

interface CreateRagWashParams {
  employeeId: string;
  washDate: string;
  ragCount: number;
  padCount?: number;
  notes?: string;
}

export async function createRagWash(params: CreateRagWashParams) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };
    const role = (session.user as { role?: string }).role;
    const sessionUserId = session.user.id;

    const { employeeId, washDate, ragCount, notes } = params;
    const padCount = Math.max(0, Math.floor(params.padCount ?? 0));
    if (!employeeId) {
      return { success: false, error: "Employee is required" };
    }
    if (ragCount < 0) {
      return { success: false, error: "Rag count must be 0 or more" };
    }
    if (ragCount === 0 && padCount === 0) {
      return { success: false, error: "Log at least one rag or one pad" };
    }

    const isAdmin = role === "OWNER" || role === "ADMIN";
    const isEmployeeSelf = role === "EMPLOYEE" && employeeId === sessionUserId;

    if (!isAdmin && !isEmployeeSelf) {
      return { success: false, error: "Not authorized" };
    }

    const employee = await db.user.findUnique({ where: { id: employeeId } });
    if (!employee) return { success: false, error: "Employee not found" };

    await db.ragWash.create({
      data: {
        employeeId,
        washDate: new Date(washDate),
        ragCount,
        padCount,
        notes: notes || null,
      },
    });

    revalidatePath("/admin/inventory/rag-wash");
    revalidatePath(`/admin/inventory/rag-wash/${employeeId}`);
    revalidatePath("/cleaners/my-inventory/rag-wash");
    return { success: true };
  } catch (error) {
    console.error("Error creating rag wash:", error);
    return { success: false, error: "Failed to create rag wash entry" };
  }
}
