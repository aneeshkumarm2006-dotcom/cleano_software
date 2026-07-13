"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { dateKeyFromStoredDate } from "@/lib/availability";
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
 * Employees can fetch their own; admins/owners can fetch anyone's.
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
      return { success: false, error: "Not authorized" };
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
 * Cleaners an OWNER/ADMIN may manage availability for. Returns an empty list
 * for everyone else (the tab then simply edits the caller's own availability),
 * so this never leaks the roster to a cleaner.
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
