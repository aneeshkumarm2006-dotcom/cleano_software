"use server";

import { db } from "@/db";
import { revalidatePath } from "next/cache";
import { requireOwnerAdmin } from "@/lib/action-guards";
import { normalizeAllowedCategories } from "@/lib/service-permissions";

// Admin restricts which service categories an employee may work
// (awerfixes.pdf item 3). An EMPTY list means "no restriction — every category",
// so clearing every checkbox is a legitimate save, not a no-op.
//
// Gated with requireOwnerAdmin: this decides what work a cleaner can see and
// claim, so ops managers and field leads may not change it.
export async function setEmployeeServiceCategories(
  employeeId: string,
  categories: string[]
): Promise<{ success: true; categories: string[] } | { success: false; error: string }> {
  const gate = await requireOwnerAdmin();
  if (!gate.ok) return { success: false, error: gate.error };

  if (typeof employeeId !== "string" || !employeeId || employeeId.length > 64) {
    return { success: false, error: "Employee not found" };
  }

  // Never trust the submitted keys — a stale client bundle or a hand-rolled POST
  // could otherwise write a category that matches nothing and silently lock the
  // cleaner out of every job.
  const allowedServiceCategories = normalizeAllowedCategories(categories);

  try {
    await db.user.update({
      where: { id: employeeId },
      data: { allowedServiceCategories },
    });
  } catch (error) {
    console.error("Error setting service categories:", error);
    return { success: false, error: "Failed to save service categories" };
  }

  revalidatePath(`/admin/employees/${employeeId}`);
  revalidatePath("/admin/employees");
  // The cleaner's own board is derived from this list.
  revalidatePath("/cleaners/available-jobs");
  return { success: true, categories: allowedServiceCategories };
}
