"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import type { AvailabilitySlotDTO } from "./getAvailability.types";

/**
 * Fetch availability slots for an employee.
 * Employees can fetch their own; admins/owners can fetch anyone's.
 */
export async function getAvailability(
  employeeId?: string
): Promise<
  | { success: true; slots: AvailabilitySlotDTO[] }
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

    const slots = await db.employeeAvailability.findMany({
      where: { employeeId: targetId },
      orderBy: { day: "asc" },
    });

    return { success: true, slots };
  } catch (error) {
    console.error("Error loading availability:", error);
    return { success: false, error: "Failed to load availability" };
  }
}
