export type AvailabilityResult =
  | "AVAILABLE"
  | "UNAVAILABLE"
  | "OUTSIDE_HOURS"
  | "NO_DATA";

export interface CheckAvailabilityInput {
  employeeId: string;
  /** ISO datetime string for the start of the work block. */
  startISO: string;
  /** ISO datetime string for the end. If omitted, treats as a single moment. */
  endISO?: string;
}
