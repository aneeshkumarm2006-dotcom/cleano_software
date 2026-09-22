"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { CleanerTier } from "@/lib/pay-tiers";
import { checkCleanerSeats } from "@/lib/plan-limits";
import {
  previewCleanerDeactivation,
  unassignFutureJobs,
  type DeactivationImpact,
} from "@/lib/cleaner-deactivation";

const VALID_TIERS: CleanerTier[] = ["TRAINEE", "STANDARD", "FIELD_LEAD"];

type Result =
  | { success: true; count: number }
  | { success: false; error: string };

/**
 * What switching these cleaners off would do to the schedule.
 *
 * Read-only, and separate from the write so the admin can be shown the damage
 * before agreeing to it (Sept 17, item 23). Admin-gated like everything else
 * here: how many jobs a cleaner is booked on is not public.
 */
export async function previewEmployeeDeactivation(
  ids: string[],
): Promise<
  { success: true; impact: DeactivationImpact } | { success: false; error: string }
> {
  const gate = await requireAdmin();
  if (!gate.ok) return { success: false, error: gate.error };
  try {
    return { success: true, impact: await previewCleanerDeactivation(sanitizeIds(ids)) };
  } catch (e) {
    console.error("previewEmployeeDeactivation", e);
    return { success: false, error: "Couldn't check which jobs would be affected" };
  }
}

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
    // Switching people back on is the bulk equivalent of hiring them, so it is
    // checked as a whole rather than one at a time: allowing "as many as fit"
    // out of a selection would leave an admin guessing which of the ten they
    // ticked actually came back.
    if (isActive) {
      const returning = await db.user.count({
        where: {
          id: { in: cleanIds },
          role: "EMPLOYEE",
          isActive: false,
          deletedAt: null,
        },
      });
      if (returning > 0) {
        const seats = await checkCleanerSeats(returning);
        if (!seats.ok) return { success: false, error: seats.message };
      }
    }

    const res = await db.user.updateMany({
      where: { id: { in: cleanIds }, role: { not: "CLIENT" } },
      data: { isActive },
    });

    // Sept 17, item 23. Switching someone off used to lock them out of the app
    // and nothing more, so every job they were already booked on still showed
    // them as crew — the calendar read as covered right up to the morning of
    // the clean. Upcoming jobs only; past jobs keep them for payroll.
    //
    // AFTER the access change and deliberately not inside it: the lockout is
    // the thing the admin asked for and must land even if the schedule cannot
    // be tidied. `unassignFutureJobs` never throws for the same reason.
    if (!isActive) {
      await unassignFutureJobs(cleanIds);
    }

    revalidatePath("/admin/employees");
    revalidatePath("/admin/jobs");
    revalidatePath("/admin/calendar");
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
