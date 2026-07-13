import type { AvailabilityDay } from "@prisma/client";

export interface AvailabilitySlotDTO {
  id: string;
  employeeId: string;
  day: AvailabilityDay;
  startTime: string;
  endTime: string;
  isAvailable: boolean;
  isRecurring: boolean;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
}

/**
 * A one-off blocked date (vacation / appointment / sick day) layered on top of
 * the recurring weekly rules. `date` is a plain "YYYY-MM-DD" calendar key so the
 * UI never has to think about timezones.
 */
export interface AvailabilityExceptionDTO {
  id: string;
  employeeId: string;
  /** "YYYY-MM-DD" */
  date: string;
  reason: string | null;
}

/** Employees an admin may manage availability for (cleaner picker). */
export interface AvailabilityEmployeeDTO {
  id: string;
  name: string;
}
