"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { dateKeyFromStoredDate } from "@/lib/availability";
import {
  fieldLeadGroupIds,
  isFieldLeadGroupMember,
} from "@/lib/field-lead-group.server";
import type {
  AvailabilityEmployeeDTO,
  AvailabilityExceptionDTO,
  AvailabilitySlotDTO,
} from "./getAvailability.types";

/** How far back blocked dates are returned (older ones are history, not useful). */
const EXCEPTION_LOOKBACK_DAYS = 60;
const EXCEPTION_LIMIT = 400;

/**
 * Fetch availability for an employee: the recurring weekly slots AND the
 * one-off blocked dates (vacation / appointment / sick day) layered on top.
 *
 * Employees can fetch their own; admins/owners can fetch anyone's; a FIELD_LEAD
 * can fetch a member of THEIR OWN GROUP (Stage 7 / PDF #7 — "a Field Lead should
 * see each group member's availability"). Group membership is resolved
 * server-side from `User.fieldLeadId`, so the id the client sends is checked, not
 * trusted.
 *
 * READ only. Availability WRITES stay OWNER/ADMIN-only — see `setAvailability.ts`
 * and `availabilityExceptions.ts::authorizeFor`, neither of which this stage
 * touches.
 */
export async function getAvailability(
  employeeId?: string
): Promise<
  | {
      success: true;
      slots: AvailabilitySlotDTO[];
      exceptions: AvailabilityExceptionDTO[];
    }
  | { success: false; error: string }
> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return { success: false, error: "Not authenticated" };
    }

    const role = (session.user as { role?: string }).role;
    const isAdmin = role === "OWNER" || role === "ADMIN";
    const targetId = employeeId || session.user.id;

    if (!isAdmin && targetId !== session.user.id) {
      // The one exception: a Field Lead reading their own group. Checked against
      // the database, and only ever reached for a FIELD_LEAD session — every
      // other role still fails closed exactly as before.
      const allowed =
        role === "FIELD_LEAD" &&
        (await isFieldLeadGroupMember(session.user.id, targetId));
      if (!allowed) return { success: false, error: "Not authorized" };
    }

    const since = new Date(
      Date.now() - EXCEPTION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
    );

    const [slots, exceptions] = await Promise.all([
      db.employeeAvailability.findMany({
        where: { employeeId: targetId },
        orderBy: { day: "asc" },
      }),
      db.availabilityException.findMany({
        where: { employeeId: targetId, date: { gte: since } },
        orderBy: { date: "asc" },
        take: EXCEPTION_LIMIT,
      }),
    ]);

    return {
      success: true,
      slots,
      exceptions: exceptions.map((e) => ({
        id: e.id,
        employeeId: e.employeeId,
        date: dateKeyFromStoredDate(e.date),
        reason: e.reason,
      })),
    };
  } catch (error) {
    console.error("Error loading availability:", error);
    return { success: false, error: "Failed to load availability" };
  }
}

/**
 * Every group member's availability in one round trip — the read behind the
 * Field Lead's My Team availability tab (Stage 7 / PDF #7).
 *
 * Deliberately a SEPARATE entry point rather than FIELD_LEAD being added to
 * `listAvailabilityEmployees` below. That function feeds the Settings
 * availability tab's employee PICKER, and its picker leads to `setAvailability`,
 * which is OWNER/ADMIN-only: handing a Field Lead a picker there would have
 * produced a screen that reads fine and fails on save. Read access and write
 * access are different questions, so they get different doors.
 *
 * An OWNER/ADMIN may pass `leadId` to inspect a specific lead's group. A
 * FIELD_LEAD's own `leadId` argument is IGNORED — they always get their own
 * group, so there is no id for them to substitute.
 */
export async function getGroupAvailability(leadId?: string): Promise<
  | {
      success: true;
      leadId: string;
      slots: AvailabilitySlotDTO[];
      exceptions: AvailabilityExceptionDTO[];
    }
  | { success: false; error: string }
> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return { success: false, error: "Not authenticated" };

    const role = (session.user as { role?: string }).role;
    let resolvedLeadId: string;
    if (role === "FIELD_LEAD") {
      resolvedLeadId = session.user.id;
    } else if (role === "OWNER" || role === "ADMIN") {
      if (typeof leadId !== "string" || !leadId.trim()) {
        return { success: false, error: "Pick a Field Lead to view" };
      }
      resolvedLeadId = leadId.trim();
    } else {
      return { success: false, error: "Not authorized" };
    }

    const groupIds = await fieldLeadGroupIds(resolvedLeadId);
    if (groupIds.length === 0) {
      return { success: true, leadId: resolvedLeadId, slots: [], exceptions: [] };
    }

    const since = new Date(
      Date.now() - EXCEPTION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
    );

    const [slots, exceptions] = await Promise.all([
      db.employeeAvailability.findMany({
        where: { employeeId: { in: groupIds } },
        orderBy: [{ employeeId: "asc" }, { day: "asc" }],
      }),
      db.availabilityException.findMany({
        where: { employeeId: { in: groupIds }, date: { gte: since } },
        orderBy: { date: "asc" },
        // Same cap as the single-employee read, scaled by the group size so a
        // 6-person group isn't silently truncated to one person's worth.
        take: EXCEPTION_LIMIT * Math.min(groupIds.length, 20),
      }),
    ]);

    return {
      success: true,
      leadId: resolvedLeadId,
      slots,
      exceptions: exceptions.map((e) => ({
        id: e.id,
        employeeId: e.employeeId,
        date: dateKeyFromStoredDate(e.date),
        reason: e.reason,
      })),
    };
  } catch (error) {
    console.error("Error loading group availability:", error);
    return { success: false, error: "Failed to load availability" };
  }
}

/**
 * Cleaners an OWNER/ADMIN may manage availability for. Returns an empty list
 * for everyone else (the tab then simply edits the caller's own availability),
 * so this never leaks the roster to a cleaner.
 *
 * FIELD_LEAD is deliberately NOT added here — see `getGroupAvailability` above
 * for why a read path and a manage path must not share one list.
 */
export async function listAvailabilityEmployees(): Promise<
  AvailabilityEmployeeDTO[]
> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    const role = (session?.user as { role?: string } | undefined)?.role;
    if (role !== "OWNER" && role !== "ADMIN") return [];

    return await db.user.findMany({
      where: {
        role: { in: ["EMPLOYEE", "FIELD_LEAD"] },
        deletedAt: null,
        isActive: true,
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
  } catch (error) {
    console.error("Error loading availability employees:", error);
    return [];
  }
}
