"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { AvailabilityDay } from "@prisma/client";
import type { AvailabilitySlotInput } from "./setAvailability.types";

interface SetAvailabilityInput {
  employeeId?: string;
  slots: AvailabilitySlotInput[];
}

const DAYS: AvailabilityDay[] = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];

const TIME_RE = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;

export async function setAvailability(input: SetAvailabilityInput) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return { success: false, error: "Not authenticated" };
    }

    const role = (session.user as { role?: string }).role;
    const isAdmin = role === "OWNER" || role === "ADMIN";
    const targetEmployeeId = input.employeeId || session.user.id;

    if (!isAdmin && targetEmployeeId !== session.user.id) {
      return { success: false, error: "Not authorized" };
    }

    if (!Array.isArray(input.slots)) {
      return { success: false, error: "Invalid slots payload" };
    }

    for (const slot of input.slots) {
      if (!DAYS.includes(slot.day)) {
        return { success: false, error: `Invalid day: ${slot.day}` };
      }
      if (!TIME_RE.test(slot.startTime) || !TIME_RE.test(slot.endTime)) {
        return { success: false, error: "Time must be HH:MM (24-hour)" };
      }
      if (slot.startTime >= slot.endTime) {
        return {
          success: false,
          error: `End time must be after start time (${slot.day})`,
        };
      }
    }

    const data = input.slots.map((s) => ({
      employeeId: targetEmployeeId,
      day: s.day,
      startTime: s.startTime,
      endTime: s.endTime,
      isAvailable: s.isAvailable,
      isRecurring: s.isRecurring,
      effectiveFrom: s.effectiveFrom ? new Date(s.effectiveFrom) : null,
      effectiveTo: s.effectiveTo ? new Date(s.effectiveTo) : null,
    }));

    await db.$transaction(async (tx) => {
      await tx.employeeAvailability.deleteMany({
        where: { employeeId: targetEmployeeId },
      });
      if (data.length > 0) {
        await tx.employeeAvailability.createMany({ data });
      }
    });

    revalidatePath("/admin/settings");
    revalidatePath(`/admin/employees/${targetEmployeeId}`);
    revalidatePath("/admin/calendar");
    revalidatePath("/admin/jobs/new");

    return { success: true };
  } catch (error) {
    console.error("Error setting availability:", error);
    return { success: false, error: "Failed to save availability" };
  }
}
