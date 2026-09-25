// Validation for admin edits of clock-in / clock-out times
// (AwerNewFixes.pdf item 4).
//
// PURE — no DB imports — so the server action and any future UI check the same
// rules, and so the rules can be tested without a database.

/** Longest shift an admin can record in one edit — guards typo'd dates. */
export const MAX_SHIFT_HOURS = 24;

export type ParsedInstant = Date | null | "invalid";

/** Parse an ISO string into a Date, null (cleared) or "invalid". */
export function parseInstant(value: string | null | undefined): ParsedInstant {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

/**
 * Check a proposed clock-in/clock-out pair.
 *
 * Returns an admin-facing error message, or null when the edit is allowed.
 * Clearing BOTH times is allowed — that's how a mistaken clock-in is undone.
 */
export function validateClockEdit(input: {
  clockIn: ParsedInstant;
  clockOut: ParsedInstant;
}): string | null {
  const { clockIn, clockOut } = input;

  if (clockIn === "invalid" || clockOut === "invalid") {
    return "Enter a valid date and time.";
  }

  // A clock-out with no clock-in isn't a shift — it produces null hours and a
  // "clocked out" state nothing can compute pay from.
  if (!clockIn && clockOut) {
    return "Set a clock-in time before recording a clock-out.";
  }

  if (clockIn && clockOut) {
    if (clockOut.getTime() <= clockIn.getTime()) {
      return "Clock-out must be after clock-in.";
    }
    const hours = (clockOut.getTime() - clockIn.getTime()) / 3_600_000;
    if (hours > MAX_SHIFT_HOURS) {
      return `That's ${hours.toFixed(1)} hours — longer than a ${MAX_SHIFT_HOURS}-hour shift. Check the dates.`;
    }
  }

  return null;
}

/**
 * The per-cleaner assignment status implied by a clock pair. Status has to
 * follow the timestamps or the Team card contradicts the times next to it.
 */
export function assignmentStatusForClock(
  clockIn: Date | null,
  clockOut: Date | null
): "ASSIGNED" | "CLOCKED_IN" | "CLOCKED_OUT" {
  if (clockOut) return "CLOCKED_OUT";
  if (clockIn) return "CLOCKED_IN";
  return "ASSIGNED";
}
