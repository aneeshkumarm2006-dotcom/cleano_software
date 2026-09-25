"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { DATE_KEY_RE, dateKeyToStoredDate } from "@/lib/availability";
import type { AvailabilityExceptionDTO } from "./getAvailability.types";

// One-off blocked dates (cleaner-app item 8). EmployeeAvailability is unique per
// (employee, weekday), so it can never express "this specific Monday is off" —
// vacation / appointment / sick days live here instead and always win over the
// recurring rule (see `evaluateAvailability` in @/lib/availability).

const MAX_REASON = 200;
/** Sanity window: no blocking dates a decade out or years in the past. */
const MAX_PAST_DAYS = 365;
const MAX_FUTURE_DAYS = 730;

/**
 * A cleaner may only manage their OWN blocked dates. OWNER/ADMIN may manage
 * anyone's. Fails closed.
 */
async function authorizeFor(
  employeeId?: string
): Promise<
  { ok: true; employeeId: string } | { ok: false; error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { ok: false, error: "Not authenticated" };

  const role = (session.user as { role?: string }).role;
  const isAdmin = role === "OWNER" || role === "ADMIN";
  const targetId = employeeId || session.user.id;

  if (!isAdmin && targetId !== session.user.id) {
    return { ok: false, error: "Not authorized" };
  }
  return { ok: true, employeeId: targetId };
}

function revalidate(employeeId: string) {
  revalidatePath("/admin/settings");
  revalidatePath("/cleaners/availability");
  revalidatePath(`/admin/employees/${employeeId}`);
  revalidatePath("/admin/calendar");
  revalidatePath("/admin/jobs/new");
}

/**
 * Block a single date for an employee. Idempotent: re-blocking the same date
 * just refreshes the reason (the row is unique per employee+date).
 */
export async function addAvailabilityException(input: {
  employeeId?: string;
  /** "YYYY-MM-DD" */
  date: string;
  reason?: string | null;
}): Promise<
  | { success: true; exception: AvailabilityExceptionDTO }
  | { success: false; error: string }
> {
  try {
    const gate = await authorizeFor(input?.employeeId);
    if (!gate.ok) return { success: false, error: gate.error };

    if (typeof input?.date !== "string" || !DATE_KEY_RE.test(input.date)) {
      return { success: false, error: "Pick a valid date" };
    }
    const stored = dateKeyToStoredDate(input.date);
    if (!stored) return { success: false, error: "Pick a valid date" };

    const now = Date.now();
    if (stored.getTime() < now - MAX_PAST_DAYS * 86_400_000) {
      return { success: false, error: "That date is too far in the past" };
    }
    if (stored.getTime() > now + MAX_FUTURE_DAYS * 86_400_000) {
      return { success: false, error: "That date is too far in the future" };
    }

    const raw = typeof input.reason === "string" ? input.reason.trim() : "";
    if (raw.length > MAX_REASON) {
      return {
        success: false,
        error: `Reason must be ${MAX_REASON} characters or fewer`,
      };
    }
    const reason = raw || null;

    // The target must be a live user (never resurrect a soft-deleted account).
    const employee = await db.user.findFirst({
      where: { id: gate.employeeId, deletedAt: null },
      select: { id: true },
    });
    if (!employee) return { success: false, error: "Employee not found" };

    const row = await db.availabilityException.upsert({
      where: {
        employeeId_date: { employeeId: gate.employeeId, date: stored },
      },
      update: { reason },
      create: { employeeId: gate.employeeId, date: stored, reason },
    });

    revalidate(gate.employeeId);

    return {
      success: true,
      exception: {
        id: row.id,
        employeeId: row.employeeId,
        date: input.date,
        reason: row.reason,
      },
    };
  } catch (error) {
    console.error("Error blocking date:", error);
    return { success: false, error: "Failed to block that date" };
  }
}

/** Unblock a date. Authorized against the row's OWNER, not the caller's claim. */
export async function deleteAvailabilityException(
  id: string
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    if (typeof id !== "string" || !id) {
      return { success: false, error: "Invalid request" };
    }

    // Look the row up first, then authorize against ITS employeeId — otherwise a
    // cleaner could delete another cleaner's exception by guessing an id (IDOR).
    const row = await db.availabilityException.findUnique({
      where: { id },
      select: { id: true, employeeId: true },
    });
    if (!row) return { success: false, error: "Not found" };

    const gate = await authorizeFor(row.employeeId);
    if (!gate.ok) return { success: false, error: gate.error };

    await db.availabilityException.delete({ where: { id: row.id } });
    revalidate(row.employeeId);
    return { success: true };
  } catch (error) {
    console.error("Error unblocking date:", error);
    return { success: false, error: "Failed to unblock that date" };
  }
}
