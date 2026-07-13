"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import {
  evaluateEmployeesAvailability,
  findAvailabilityConflicts,
} from "@/lib/job-assignments";
import {
  windowFromFields,
  windowFromInstants,
  type AvailabilityResult,
} from "@/lib/availability";
import type {
  AvailabilityConflict,
  CheckAvailabilityBatchInput,
  CheckAvailabilityInput,
  EmployeeAvailabilityStatus,
} from "./checkAvailability.types";

const STAFF_ROLES = ["OWNER", "ADMIN", "OPS_MANAGER"];

/**
 * Availability data is schedule PII. Staff may look up anyone; an employee may
 * only look up themselves. Fails closed when the session is missing.
 */
async function gate(): Promise<
  { ok: true; userId: string; isStaff: boolean } | { ok: false; error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { ok: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  return {
    ok: true,
    userId: session.user.id,
    isStaff: !!role && STAFF_ROLES.includes(role),
  };
}

/**
 * Check whether an employee is available for a given time window.
 *
 * SINGLE SOURCE OF TRUTH — recurring weekly rules (EmployeeAvailability) plus
 * one-off blocked dates (AvailabilityException). A blocked date is UNAVAILABLE
 * regardless of the weekly rule. The evaluation itself lives in
 * `@/lib/availability` and is shared with the client-side cleaner pickers.
 *
 *   AVAILABLE     – fully covered by an available slot
 *   UNAVAILABLE   – blocked date, or overlaps a slot marked unavailable
 *   OUTSIDE_HOURS – has availability data but the window falls outside it
 *   NO_DATA       – the employee hasn't entered availability yet
 */
export async function checkAvailability(
  input: CheckAvailabilityInput
): Promise<
  | { success: true; result: AvailabilityResult; reason: string | null }
  | { success: false; error: string }
> {
  try {
    const g = await gate();
    if (!g.ok) return { success: false, error: g.error };
    if (!input?.employeeId || typeof input.employeeId !== "string") {
      return { success: false, error: "Invalid employee" };
    }
    if (!g.isStaff && input.employeeId !== g.userId) {
      return { success: false, error: "Not authorized" };
    }

    const start = new Date(input.startISO);
    const end = input.endISO ? new Date(input.endISO) : null;
    if (
      Number.isNaN(start.getTime()) ||
      (end && Number.isNaN(end.getTime()))
    ) {
      return { success: false, error: "Invalid date" };
    }

    const window = windowFromInstants(start, end);
    const map = await evaluateEmployeesAvailability([input.employeeId], window);
    const ev = map.get(input.employeeId);
    if (!ev) return { success: true, result: "NO_DATA", reason: null };

    return { success: true, result: ev.result, reason: ev.reason };
  } catch (error) {
    console.error("Error checking availability:", error);
    return { success: false, error: "Failed to check availability" };
  }
}

/**
 * Batch variant for the cleaner pickers: evaluate many employees against one
 * wall-clock window in a single round trip (two queries, not N).
 */
export async function checkAvailabilityBatch(
  input: CheckAvailabilityBatchInput
): Promise<
  | { success: true; statuses: EmployeeAvailabilityStatus[] }
  | { success: false; error: string }
> {
  try {
    const g = await gate();
    if (!g.ok) return { success: false, error: g.error };

    const ids = Array.isArray(input?.employeeIds)
      ? Array.from(
          new Set(
            input.employeeIds.filter(
              (id): id is string => typeof id === "string" && !!id
            )
          )
        )
      : [];
    if (ids.length === 0) return { success: true, statuses: [] };
    // Cheap DoS guard — the picker never legitimately sends more than this.
    if (ids.length > 200) return { success: false, error: "Too many employees" };
    // A non-staff caller may only ask about themselves.
    if (!g.isStaff && ids.some((id) => id !== g.userId)) {
      return { success: false, error: "Not authorized" };
    }

    const window = windowFromFields(
      input.startDate,
      input.startTime,
      input.endDate ?? null,
      input.endTime ?? null
    );
    if (!window) return { success: false, error: "Invalid date or time" };

    const map = await evaluateEmployeesAvailability(ids, window);
    return {
      success: true,
      statuses: ids.map((employeeId) => {
        const ev = map.get(employeeId);
        return {
          employeeId,
          result: ev?.result ?? "NO_DATA",
          reason: ev?.reason ?? null,
          blockedDate: ev?.blockedDate ?? false,
        };
      }),
    };
  } catch (error) {
    console.error("Error checking availability batch:", error);
    return { success: false, error: "Failed to check availability" };
  }
}

/**
 * Availability conflicts for a proposed crew on an existing job — lets the
 * Team card / assign flow show the warning BEFORE the admin confirms. Advisory
 * only: an empty list means "no conflict", it never blocks the assignment.
 */
export async function previewAssignmentConflicts(input: {
  jobId: string;
  cleanerIds: string[];
}): Promise<
  | { success: true; conflicts: AvailabilityConflict[] }
  | { success: false; error: string }
> {
  try {
    const g = await gate();
    if (!g.ok) return { success: false, error: g.error };
    if (!g.isStaff) return { success: false, error: "Not authorized" };
    if (!input?.jobId || typeof input.jobId !== "string") {
      return { success: false, error: "Invalid job" };
    }

    const { db } = await import("@/db");
    const job = await db.job.findFirst({
      where: { id: input.jobId, deletedAt: null },
      select: { startTime: true, endTime: true },
    });
    if (!job) return { success: false, error: "Job not found" };

    const ids = Array.isArray(input.cleanerIds)
      ? input.cleanerIds.filter(
          (id): id is string => typeof id === "string" && !!id
        )
      : [];

    const conflicts = await findAvailabilityConflicts(
      ids,
      job.startTime,
      job.endTime
    );
    return { success: true, conflicts };
  } catch (error) {
    console.error("Error previewing assignment conflicts:", error);
    return { success: false, error: "Failed to check availability" };
  }
}
