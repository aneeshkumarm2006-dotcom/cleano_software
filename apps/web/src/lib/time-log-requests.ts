// The rules for a cleaner's clock-correction request (Sept 17 list, item 19).
//
// Pure and client-safe: the cleaner's form refuses a bad request before
// sending it, and the action refuses it again on arrival. The action is the
// one that counts — the form is a courtesy — so both call the same function
// rather than each having an opinion.

export type TimeLogRequestStatus = "PENDING" | "APPROVED" | "REJECTED";

export const TIME_LOG_REASON_MIN = 5;
export const TIME_LOG_REASON_MAX = 500;

/**
 * How far back a cleaner may ask to correct.
 *
 * Not unlimited, and not because of trust: a pay period that has been
 * generated and paid cannot absorb a change, so a request against one is a
 * conversation with the office rather than a form. Fourteen days covers the
 * two pay periods anyone is realistically still arguing about.
 */
export const TIME_LOG_REQUEST_WINDOW_DAYS = 14;

/** The longest shift a correction may claim, as a sanity bound. */
const MAX_SHIFT_HOURS = 24;

export interface TimeLogRequestInput {
  originalStart: Date | null;
  originalEnd: Date | null;
  requestedStart: Date | null;
  requestedEnd: Date | null;
  reason: string;
}

export type TimeLogRequestCheck =
  | { ok: true; reason: string }
  | { ok: false; error: string };

/**
 * Is this a request an admin could act on?
 *
 * Deliberately strict about the SHAPE and silent about whether the claim is
 * true. Whether the cleaner really started at 8:45 is not something code can
 * know, and pretending otherwise would either reject honest corrections or
 * wave through impossible ones. What it can check is that the request is
 * internally coherent, is actually a change, and is not a shift no one worked.
 */
export function checkTimeLogRequest(
  input: TimeLogRequestInput,
  now: Date = new Date(),
): TimeLogRequestCheck {
  const reason = String(input.reason ?? "").trim();
  if (reason.length < TIME_LOG_REASON_MIN) {
    return {
      ok: false,
      error: "Say what happened. The office decides from this sentence alone.",
    };
  }

  const { requestedStart, requestedEnd } = input;
  if (!requestedStart && !requestedEnd) {
    return { ok: false, error: "Enter the time you want changed." };
  }

  // A correction that changes nothing is a round trip for the office with
  // nothing at the end of it.
  const sameStart = sameInstant(requestedStart, input.originalStart);
  const sameEnd = sameInstant(requestedEnd, input.originalEnd);
  if (sameStart && sameEnd) {
    return { ok: false, error: "That's the same as what's already recorded." };
  }

  const start = requestedStart ?? input.originalStart;
  const end = requestedEnd ?? input.originalEnd;

  if (start && end) {
    if (end.getTime() <= start.getTime()) {
      return { ok: false, error: "The finish time has to be after the start time." };
    }
    const hours = (end.getTime() - start.getTime()) / 3_600_000;
    if (hours > MAX_SHIFT_HOURS) {
      return {
        ok: false,
        error: `That's ${Math.round(hours)} hours. Check the dates — a single shift can't be longer than ${MAX_SHIFT_HOURS}.`,
      };
    }
  }

  // The future is not a thing that has been worked. A small allowance, because
  // a cleaner finishing right now and correcting the minute is legitimate and
  // clocks drift.
  const futureLimit = now.getTime() + 5 * 60_000;
  for (const t of [requestedStart, requestedEnd]) {
    if (t && t.getTime() > futureLimit) {
      return { ok: false, error: "That time hasn't happened yet." };
    }
  }

  const oldest = now.getTime() - TIME_LOG_REQUEST_WINDOW_DAYS * 86_400_000;
  if (start && start.getTime() < oldest) {
    return {
      ok: false,
      error: `That shift is more than ${TIME_LOG_REQUEST_WINDOW_DAYS} days ago. Ask the office directly — it may already be paid.`,
    };
  }

  return { ok: true, reason: reason.slice(0, TIME_LOG_REASON_MAX) };
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  // To the minute. A cleaner types 8:45, not 8:45:00.000, so comparing
  // milliseconds would call every request a change.
  return Math.floor(a.getTime() / 60_000) === Math.floor(b.getTime() / 60_000);
}

/** Only a pending request can be decided. Prevents a double approval. */
export function canDecide(status: string): boolean {
  return status === "PENDING";
}

/** "8:45 AM → 9:15 AM", for the admin's list and the cleaner's history. */
export function describeChange(
  label: string,
  original: Date | null,
  requested: Date | null,
  format: (d: Date) => string,
): string | null {
  if (!requested) return null;
  if (sameInstant(original, requested)) return null;
  return `${label}: ${original ? format(original) : "none"} → ${format(requested)}`;
}
