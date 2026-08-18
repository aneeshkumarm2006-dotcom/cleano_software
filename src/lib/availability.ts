// Single source of truth for "is this cleaner available at this time?".
//
// PURE module — no Prisma client, no `db`, no `next/headers`. It is imported by
// server actions (checkAvailability, assignCleaners, bulkAssignCleaner) AND by
// client components (the New Job cleaner picker), so it must stay bundleable in
// both. DB reads live in `src/lib/job-assignments.ts`.
//
// Two layers stack:
//   1. EmployeeAvailability — the recurring weekly rule (unique per weekday).
//   2. AvailabilityException — one-off blocked dates (vacation / sick /
//      appointment). A blocked date always wins: UNAVAILABLE regardless of the
//      weekly rule.
//
// TIME MODEL
// Everything is evaluated as business-timezone WALL CLOCK. An instant (a Job's
// startTime) is projected into the business timezone before comparison, and the
// admin forms already speak wall clock ("2026-07-13" + "09:00"), so no timezone
// maths happens inside the evaluator itself.

import type { AvailabilityDay } from "@prisma/client";
import { STORE_TZ } from "./timezone";

const TZ = STORE_TZ;

export type AvailabilityResult =
  | "AVAILABLE"
  | "UNAVAILABLE"
  | "OUTSIDE_HOURS"
  | "NO_DATA";

const BLOCKED_PREFIX = "Blocked date — ";

/** "YYYY-MM-DD" */
export const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** "HH:MM", 24-hour */
export const TIME_RE = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;

const DAY_BY_INDEX: AvailabilityDay[] = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
];

const DAY_LABEL: Record<AvailabilityDay, string> = {
  SUNDAY: "Sunday",
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
  SATURDAY: "Saturday",
};

/** A recurring weekly rule (subset of EmployeeAvailability). */
export interface AvailabilityRuleLite {
  day: AvailabilityDay;
  startTime: string;
  endTime: string;
  isAvailable: boolean;
  effectiveFrom?: string | Date | null;
  effectiveTo?: string | Date | null;
}

/** A one-off blocked date (subset of AvailabilityException). */
export interface AvailabilityExceptionLite {
  date: string | Date;
  reason?: string | null;
}

/** The work block being tested, in business-timezone wall clock. */
export interface AvailabilityWindow {
  /** "YYYY-MM-DD" */
  dateKey: string;
  /** "HH:MM" */
  startTime: string;
  /** "HH:MM" — equal to startTime when the job has no end time. */
  endTime: string;
}

export interface AvailabilityEvaluation {
  result: AvailabilityResult;
  /** Short human explanation. Null when AVAILABLE or NO_DATA. */
  reason: string | null;
  /** True when the conflict came from a one-off blocked date. */
  blockedDate: boolean;
}

/**
 * A whole DAY's answer rather than a window's — what Stage 12's day view asks
 * ("is this cleaner working next Tuesday at all, and between which hours?").
 *
 * Deliberately a separate shape from `AvailabilityEvaluation`: that one answers
 * "does this job fit?", which needs a job. Asking it with a made-up 00:00–23:59
 * window would report OUTSIDE_HOURS for a cleaner who works 09:00–17:00 — a
 * false negative on the exact question the view exists to answer.
 */
export interface DayAvailabilitySummary {
  result: AvailabilityResult;
  /** Short human explanation. Null when AVAILABLE or NO_DATA. */
  reason: string | null;
  blockedDate: boolean;
  /** The open windows on that date. Empty unless `result` is AVAILABLE. */
  windows: Array<{ startTime: string; endTime: string }>;
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((p) => parseInt(p, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

/** Business-timezone calendar date ("YYYY-MM-DD") for an instant. */
export function dateKeyTz(d: Date): string {
  // en-CA renders as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Business-timezone wall clock ("HH:MM") for an instant. */
export function timeKeyTz(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  // Some ICU builds render midnight as "24".
  const hour = Number(get("hour")) % 24;
  return `${String(hour).padStart(2, "0")}:${get("minute")}`;
}

/**
 * STORAGE CONVENTION for AvailabilityException.date: midnight UTC of the
 * business-timezone calendar date (e.g. 2026-07-13T00:00:00.000Z). Date-only,
 * DST-proof, and round-trips through `exceptionDateKey` exactly. Every writer
 * must go through this helper so `@@unique([employeeId, date])` actually
 * de-duplicates.
 */
export function dateKeyToStoredDate(dateKey: string): Date | null {
  if (!DATE_KEY_RE.test(dateKey)) return null;
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  // Rejects impossible dates like 2026-02-31 (which JS would roll over).
  if (dateKeyFromStoredDate(dt) !== dateKey) return null;
  return dt;
}

/** Inverse of `dateKeyToStoredDate`. */
export function dateKeyFromStoredDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Normalize any stored/serialized exception date back to "YYYY-MM-DD". */
export function exceptionDateKey(date: string | Date): string {
  if (typeof date === "string") {
    return DATE_KEY_RE.test(date) ? date : date.slice(0, 10);
  }
  return dateKeyFromStoredDate(date);
}

/** Weekday of a calendar date key, with no timezone involvement. */
export function dayFromDateKey(dateKey: string): AvailabilityDay | null {
  if (!DATE_KEY_RE.test(dateKey)) return null;
  const [y, m, d] = dateKey.split("-").map(Number);
  return DAY_BY_INDEX[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function dayLabel(day: AvailabilityDay): string {
  return DAY_LABEL[day];
}

/**
 * Add `n` civil days to a date key. Pure calendar arithmetic on a UTC proxy —
 * no timezone is involved, because a date key is a civil date and not an
 * instant (see the boundary rules at the top of `src/lib/timezone.ts`).
 *
 * Returns null for a malformed key rather than a plausible-looking wrong date.
 */
export function addDateKeyDays(dateKey: string, n: number): string | null {
  if (!DATE_KEY_RE.test(dateKey)) return null;
  const [y, m, d] = dateKey.split("-").map(Number);
  return dateKeyFromStoredDate(new Date(Date.UTC(y, m - 1, d + n)));
}

/**
 * The MONDAY of the week containing `dateKey`.
 *
 * Monday-start because that is the order the availability grid has always shown
 * (`DAYS` runs Mon…Sun, and `AvailabilityDay` is entered that way in the
 * editor). Not to be confused with `startOfStoreWeek` in `timezone.ts`, which
 * answers a different question — the *instant* a Sunday-start reporting week
 * begins at — and is used for pay periods, not for this table.
 */
export function startOfWeekDateKey(dateKey: string): string | null {
  if (!DATE_KEY_RE.test(dateKey)) return null;
  const [y, m, d] = dateKey.split("-").map(Number);
  // getUTCDay: 0 = Sunday … 6 = Saturday. With a Monday start, Sunday sits six
  // days INTO the week, which is what the +6 rotation expresses.
  const back = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addDateKeyDays(dateKey, -back);
}

/** Mon…Sun date keys of the week containing `dateKey`. Empty on a bad key. */
export function weekDateKeys(dateKey: string): string[] {
  const start = startOfWeekDateKey(dateKey);
  if (!start) return [];
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const key = addDateKeyDays(start, i);
    if (key) out.push(key);
  }
  return out;
}

/**
 * Project a job's start/end instants onto a business-timezone wall-clock window.
 * Jobs that run past midnight are clamped to the end of the start day — the
 * weekly rule is per-weekday, so the start day is what we can meaningfully test.
 */
export function windowFromInstants(
  start: Date,
  end?: Date | null
): AvailabilityWindow {
  const dateKey = dateKeyTz(start);
  const startTime = timeKeyTz(start);
  let endTime = startTime;
  if (end && end.getTime() > start.getTime()) {
    endTime = dateKeyTz(end) === dateKey ? timeKeyTz(end) : "23:59";
  }
  if (toMinutes(endTime) < toMinutes(startTime)) endTime = "23:59";
  return { dateKey, startTime, endTime };
}

/** Build a window straight from admin form fields (already wall clock). */
export function windowFromFields(
  startDate: string,
  startTime: string,
  endDate?: string | null,
  endTime?: string | null
): AvailabilityWindow | null {
  if (!DATE_KEY_RE.test(startDate) || !TIME_RE.test(startTime)) return null;
  let end = startTime;
  if (endTime && TIME_RE.test(endTime)) {
    const sameDay = !endDate || endDate === startDate;
    end = sameDay ? endTime : "23:59";
  }
  if (toMinutes(end) < toMinutes(startTime)) end = "23:59";
  return { dateKey: startDate, startTime, endTime: end };
}

function effectiveKey(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  return exceptionDateKey(v);
}

/**
 * The weekly rules that actually apply on a given calendar date: the right
 * weekday, and inside the rule's effective range.
 *
 * Extracted so `evaluateAvailability` and `summarizeDayAvailability` cannot
 * disagree about which rules a date sees. A grid that showed 09:00–17:00 while
 * the assignment check said "no availability set" — because one of them forgot
 * `effectiveFrom` — is precisely the drift Stage 12 exists to prevent.
 */
export function rulesForDate(
  dateKey: string,
  rules: AvailabilityRuleLite[]
): AvailabilityRuleLite[] {
  const day = dayFromDateKey(dateKey);
  if (!day) return [];
  return rules.filter((r) => {
    if (r.day !== day) return false;
    const from = effectiveKey(r.effectiveFrom);
    if (from && dateKey < from) return false;
    const to = effectiveKey(r.effectiveTo);
    if (to && dateKey > to) return false;
    return true;
  });
}

/** The one-off block covering `dateKey`, or null. Blocked always beats weekly. */
function blockedOn(
  dateKey: string,
  exceptions: AvailabilityExceptionLite[]
): AvailabilityExceptionLite | null {
  return exceptions.find((e) => exceptionDateKey(e.date) === dateKey) ?? null;
}

/** The single wording every surface uses for a blocked date. */
function blockedReason(blocked: AvailabilityExceptionLite): string {
  const why = blocked.reason?.trim();
  return why ? `${BLOCKED_PREFIX}${why}` : "Blocked date (time off)";
}

/**
 * Evaluate one window against one employee's rules + blocked dates.
 *
 *   AVAILABLE     – window sits fully inside an available slot
 *   UNAVAILABLE   – the date is blocked, or the window hits a slot the employee
 *                   explicitly marked unavailable
 *   OUTSIDE_HOURS – rules exist but the window falls outside them
 *   NO_DATA       – the employee has not entered any availability
 */
export function evaluateAvailability(
  window: AvailabilityWindow,
  rules: AvailabilityRuleLite[],
  exceptions: AvailabilityExceptionLite[] = []
): AvailabilityEvaluation {
  // 1. One-off blocked date beats the weekly rule, always.
  const blocked = blockedOn(window.dateKey, exceptions);
  if (blocked) {
    return {
      result: "UNAVAILABLE",
      reason: blockedReason(blocked),
      blockedDate: true,
    };
  }

  if (!rules || rules.length === 0) {
    return { result: "NO_DATA", reason: null, blockedDate: false };
  }

  const day = dayFromDateKey(window.dateKey);
  if (!day) return { result: "NO_DATA", reason: null, blockedDate: false };
  const label = DAY_LABEL[day];

  const dayRules = rulesForDate(window.dateKey, rules);

  if (dayRules.length === 0) {
    return {
      result: "OUTSIDE_HOURS",
      reason: `No availability set for ${label}`,
      blockedDate: false,
    };
  }

  const startMin = toMinutes(window.startTime);
  const endMin = Math.max(toMinutes(window.endTime), startMin);
  // A zero-length window (job with no end time) still has to "touch" a slot.
  const overlapEnd = endMin === startMin ? startMin + 1 : endMin;

  const overlaps = (r: AvailabilityRuleLite) =>
    startMin < toMinutes(r.endTime) && overlapEnd > toMinutes(r.startTime);

  const hardBlock = dayRules.find((r) => !r.isAvailable && overlaps(r));
  if (hardBlock) {
    return {
      result: "UNAVAILABLE",
      reason: `Marked unavailable on ${label}`,
      blockedDate: false,
    };
  }

  const open = dayRules.filter((r) => r.isAvailable);
  if (open.length === 0) {
    return {
      result: "OUTSIDE_HOURS",
      reason: `Not available on ${label}s`,
      blockedDate: false,
    };
  }

  const covered = open.some(
    (r) => startMin >= toMinutes(r.startTime) && endMin <= toMinutes(r.endTime)
  );
  if (covered) {
    return { result: "AVAILABLE", reason: null, blockedDate: false };
  }

  const hours = open.map((r) => `${r.startTime}–${r.endTime}`).join(", ");
  return {
    result: "OUTSIDE_HOURS",
    reason: `Outside ${label} hours (${hours})`,
    blockedDate: false,
  };
}

/**
 * Evaluate a whole DAY for one employee — the day view of /admin/availability.
 *
 * Same four results and the same precedence as `evaluateAvailability`, and it
 * reads the rules through the same `rulesForDate`, so the two can never disagree
 * about which weekly rule a date sees. What differs is only the QUESTION:
 *
 *   AVAILABLE     – the employee works that day; `windows` are the open hours
 *   UNAVAILABLE   – the date is blocked, or the day is explicitly marked off
 *   OUTSIDE_HOURS – rules exist, but none of them covers this weekday
 *   NO_DATA       – the employee has not entered any availability at all
 *
 * `UNAVAILABLE` for a day marked unavailable is deliberate. `evaluateAvailability`
 * can answer OUTSIDE_HOURS in that case, because it is asking whether a specific
 * window *touches* the blocked slot; a day-level question has no window to miss.
 */
export function summarizeDayAvailability(
  dateKey: string,
  rules: AvailabilityRuleLite[],
  exceptions: AvailabilityExceptionLite[] = []
): DayAvailabilitySummary {
  const blocked = blockedOn(dateKey, exceptions);
  if (blocked) {
    return {
      result: "UNAVAILABLE",
      reason: blockedReason(blocked),
      blockedDate: true,
      windows: [],
    };
  }

  if (!rules || rules.length === 0) {
    return { result: "NO_DATA", reason: null, blockedDate: false, windows: [] };
  }

  const day = dayFromDateKey(dateKey);
  if (!day) {
    return { result: "NO_DATA", reason: null, blockedDate: false, windows: [] };
  }
  const label = DAY_LABEL[day];

  const dayRules = rulesForDate(dateKey, rules);
  if (dayRules.length === 0) {
    return {
      result: "OUTSIDE_HOURS",
      reason: `No availability set for ${label}`,
      blockedDate: false,
      windows: [],
    };
  }

  const open = dayRules.filter((r) => r.isAvailable);
  if (open.length === 0) {
    return {
      result: "UNAVAILABLE",
      reason: `Marked unavailable on ${label}`,
      blockedDate: false,
      windows: [],
    };
  }

  return {
    result: "AVAILABLE",
    reason: null,
    blockedDate: false,
    windows: open
      .map((r) => ({ startTime: r.startTime, endTime: r.endTime }))
      .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime)),
  };
}

/**
 * Warning copy for the assignment UIs. Returns null when there is nothing to
 * warn about (available, or the employee never entered availability — we don't
 * nag admins about cleaners who simply haven't filled the form in).
 */
export function availabilityWarning(
  name: string,
  ev: AvailabilityEvaluation
): string | null {
  if (ev.result === "AVAILABLE" || ev.result === "NO_DATA") return null;
  if (ev.blockedDate) {
    const detail = ev.reason?.startsWith(BLOCKED_PREFIX)
      ? ev.reason.slice(BLOCKED_PREFIX.length)
      : null;
    return `${name} has this date blocked off${detail ? ` (${detail})` : ""}`;
  }
  return `${name} is being assigned outside their availability — ${ev.reason ?? "availability conflict"}`;
}
