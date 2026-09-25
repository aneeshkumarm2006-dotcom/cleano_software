"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

// Assigns a cleaner to a Field Lead's group (or clears it with null). Used for
// the Field Lead's weekly group-revenue bonus (src/lib/field-lead-bonus.ts).
export async function setFieldLead(
  employeeId: string,
  fieldLeadId: string | null
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { success: false, error: "Not authenticated" };

  const role = (session.user as any).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { success: false, error: "Not authorized" };
  }

  if (fieldLeadId === employeeId) {
    return { success: false, error: "A cleaner cannot be their own Field Lead" };
  }

  await db.user.update({
    where: { id: employeeId },
    data: { fieldLeadId: fieldLeadId || null },
  });

  revalidatePath(`/admin/employees/${employeeId}`);
  return { success: true };
}
