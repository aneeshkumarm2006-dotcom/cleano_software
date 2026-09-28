import type {
  AvailabilityResult,
  AvailabilityEvaluation,
} from "@/lib/availability";

export type { AvailabilityResult, AvailabilityEvaluation };

export interface CheckAvailabilityInput {
  employeeId: string;
  /** ISO datetime string for the start of the work block. */
  startISO: string;
  /** ISO datetime string for the end. If omitted, treats as a single moment. */
  endISO?: string;
}

/**
 * Wall-clock variant used by the admin New Job form, whose date/time inputs are
 * already business-timezone wall clock ("2026-07-13" + "09:00"). Passing the raw
 * fields avoids a browser-local → UTC → business-TZ round trip that can shift
 * the evaluated day for an admin browsing from another timezone.
 */
export interface CheckAvailabilityBatchInput {
  employeeIds: string[];
  /** "YYYY-MM-DD" */
  startDate: string;
  /** "HH:MM" */
  startTime: string;
  /** "YYYY-MM-DD" — optional, defaults to startDate. */
  endDate?: string | null;
  /** "HH:MM" — optional; without it the start is treated as a moment. */
  endTime?: string | null;
}

export interface EmployeeAvailabilityStatus extends AvailabilityEvaluation {
  employeeId: string;
}

/** One cleaner's availability conflict for an assignment, ready to display. */
export interface AvailabilityConflict extends AvailabilityEvaluation {
  cleanerId: string;
  cleanerName: string;
  /** Pre-formatted, non-blocking warning line. */
  warning: string;
}
