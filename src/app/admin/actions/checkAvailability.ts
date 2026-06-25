"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import type { AvailabilityDay } from "@prisma/client";
import type {
  AvailabilityResult,
  CheckAvailabilityInput,
} from "./checkAvailability.types";

const DAY_BY_INDEX: AvailabilityDay[] = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
];

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((p) => parseInt(p, 10));
  return h * 60 + m;
}

function dateMinutes(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Check whether an employee is available for a given time window.
 * Returns:
 *   AVAILABLE     – fully covered by an available slot
 *   UNAVAILABLE   – overlaps with a slot marked unavailable
 *   OUTSIDE_HOURS – has availability data but the window falls outside it
 *   NO_DATA       – the employee hasn't entered availability yet
 */
export async function checkAvailability(
  input: CheckAvailabilityInput
): Promise<
  | { success: true; result: AvailabilityResult }
  | { success: false; error: string }
> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return { success: false, error: "Not authenticated" };
    }

    const start = new Date(input.startISO);
    const end = input.endISO ? new Date(input.endISO) : start;
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return { success: false, error: "Invalid date" };
    }

    const allSlots = await db.employeeAvailability.findMany({
      where: { employeeId: input.employeeId },
    });

    if (allSlots.length === 0) {
      return { success: true, result: "NO_DATA" };
    }

    const day = DAY_BY_INDEX[start.getDay()];
    const startMin = dateMinutes(start);
    const endMin = end.getTime() === start.getTime() ? startMin : dateMinutes(end);

    const slots = allSlots.filter((s) => {
      if (s.day !== day) return false;
      if (s.effectiveFrom && start < s.effectiveFrom) return false;
      if (s.effectiveTo && start > s.effectiveTo) return false;
      return true;
    });

    if (slots.length === 0) {
      return { success: true, result: "OUTSIDE_HOURS" };
    }

    const overlaps = (s: { startTime: string; endTime: string }) => {
      const sStart = toMinutes(s.startTime);
      const sEnd = toMinutes(s.endTime);
      return startMin < sEnd && endMin > sStart;
    };

    const blockedHit = slots.find((s) => !s.isAvailable && overlaps(s));
    if (blockedHit) {
      return { success: true, result: "UNAVAILABLE" };
    }

    const availableSlots = slots.filter((s) => s.isAvailable);
    if (availableSlots.length === 0) {
      return { success: true, result: "OUTSIDE_HOURS" };
    }

    const fullyCovered = availableSlots.some((s) => {
      const sStart = toMinutes(s.startTime);
      const sEnd = toMinutes(s.endTime);
      return startMin >= sStart && endMin <= sEnd;
    });

    return {
      success: true,
      result: fullyCovered ? "AVAILABLE" : "OUTSIDE_HOURS",
    };
  } catch (error) {
    console.error("Error checking availability:", error);
    return { success: false, error: "Failed to check availability" };
  }
}
