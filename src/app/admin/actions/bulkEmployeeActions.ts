"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { CleanerTier } from "@/lib/pay-tiers";

const VALID_TIERS: CleanerTier[] = ["TRAINEE", "STANDARD", "FIELD_LEAD"];

type Result =
  | { success: true; count: number }
  | { success: false; error: string };

async function requireAdmin(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN" && role !== "OPS_MANAGER") {
    return { ok: false, error: "Not authorized" };
  }
  return { ok: true };
}

function sanitizeIds(ids: string[]): string[] {
  return Array.from(
    new Set((ids ?? []).filter((id) => typeof id === "string" && id))
  );
}

// Bulk activate / deactivate cleaner logins (User.isActive). Never touches
// CLIENT accounts — the employees list only ever passes staff ids.
export async function bulkSetEmployeeActive(
  ids: string[],
  isActive: boolean
): Promise<Result> {
  const gate = await requireAdmin();
  if (!gate.ok) return { success: false, error: gate.error };

  const cleanIds = sanitizeIds(ids);
  if (cleanIds.length === 0)
    return { success: false, error: "Nothing selected" };

  try {
    const res = await db.user.updateMany({
      where: { id: { in: cleanIds }, role: { not: "CLIENT" } },
      data: { isActive },
    });
    revalidatePath("/admin/employees");
    return { success: true, count: res.count };
  } catch (e) {
    console.error("bulkSetEmployeeActive", e);
    return { success: false, error: "Failed to update selected cleaners" };
  }
}

// Bulk set payroll tier (User.cleanerTier). Validates the enum, same as the
// single-row setCleanerTier action.
export async function bulkSetCleanerTier(
  ids: string[],
  tier: CleanerTier
): Promise<Result> {
  const gate = await requireAdmin();
  if (!gate.ok) return { success: false, error: gate.error };

  if (!VALID_TIERS.includes(tier)) {
    return { success: false, error: "Invalid tier" };
  }

  const cleanIds = sanitizeIds(ids);
  if (cleanIds.length === 0)
    return { success: false, error: "Nothing selected" };

  try {
    const res = await db.user.updateMany({
      where: { id: { in: cleanIds }, role: { not: "CLIENT" } },
      data: { cleanerTier: tier },
    });
    revalidatePath("/admin/employees");
    return { success: true, count: res.count };
  } catch (e) {
    console.error("bulkSetCleanerTier", e);
    return { success: false, error: "Failed to update tier for selected cleaners" };
  }
}

// Bulk assign cleaners to a Field Lead group (User.fieldLeadId), or clear it
// with null. Rejects if any selected id is the Field Lead itself — a cleaner
// cannot be their own Field Lead.
export async function bulkSetFieldLead(
  ids: string[],
  fieldLeadId: string | null
): Promise<Result> {
  const gate = await requireAdmin();
  if (!gate.ok) return { success: false, error: gate.error };

  const cleanIds = sanitizeIds(ids);
  if (cleanIds.length === 0)
    return { success: false, error: "Nothing selected" };

  if (fieldLeadId && cleanIds.includes(fieldLeadId)) {
    return {
      success: false,
      error: "A cleaner cannot be their own Field Lead",
    };
  }

  try {
    const res = await db.user.updateMany({
      where: { id: { in: cleanIds }, role: { not: "CLIENT" } },
      data: { fieldLeadId: fieldLeadId || null },
    });
    revalidatePath("/admin/employees");
    return { success: true, count: res.count };
  } catch (e) {
    console.error("bulkSetFieldLead", e);
    return { success: false, error: "Failed to assign Field Lead" };
  }
}
