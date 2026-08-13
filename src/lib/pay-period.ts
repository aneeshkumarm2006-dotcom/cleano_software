// Pay periods run Monday 00:00:00 → Sunday 23:59:59.999 in the BUSINESS
// timezone (item 2). Every consumer — payroll creation, My Pay, My Income —
// must derive its week boundaries from here so the same job always lands in the
// same period.
//
// This module is PURE (no DB / next imports) so it can be used from server
// actions, server components and client components alike.
//
// All returned Dates are absolute instants (UTC) that correspond to the
// business-timezone wall-clock boundaries, so a job stored at 2026-07-13T03:00Z
// (Sunday 11pm in Toronto) is correctly counted in the week that CONTAINS it.

import { STORE_TZ } from "./timezone";

/** @deprecated Import `STORE_TZ` from `@/lib/timezone` instead. */
export const BUSINESS_TZ = STORE_TZ;

export interface PayPeriodRange {
  /** Monday 00:00:00.000, business timezone. */
  start: Date;
  /** Sunday 23:59:59.999, business timezone. */
  end: Date;
}

interface Civil {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

// Wall-clock fields of an instant in the business timezone.
function civilInTz(d: Date): Civil {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24, // Intl can emit "24" for midnight
    minute: get("minute"),
    second: get("second"),
  };
}

// How far ahead of UTC the business timezone is at the given instant (ms).
function tzOffsetMs(d: Date): number {
  const c = civilInTz(d);
  const asUtc = Date.UTC(
    c.year,
    c.month - 1,
    c.day,
    c.hour,
    c.minute,
    c.second
  );
  // Drop sub-second precision on both sides so the offset is exact.
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

// Instant for a business-timezone wall-clock time. Out-of-range day values are
// normalized by Date.UTC (e.g. day = 0 → last day of the previous month), which
// is what makes the "monday = day - n" math below safe across month/year edges.
function fromCivil(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const offset = tzOffsetMs(new Date(guess));
  let ts = guess - offset;
  // One refinement pass handles DST transitions (the offset at the guessed
  // instant can differ from the offset at the real instant).
  const refined = tzOffsetMs(new Date(ts));
  if (refined !== offset) ts = guess - refined;
  return new Date(ts);
}

/** Day of week in the business timezone: 0 = Sunday … 6 = Saturday. */
export function weekdayTz(d: Date): number {
  const c = civilInTz(d);
  return new Date(Date.UTC(c.year, c.month - 1, c.day)).getUTCDay();
}

/** The Monday–Sunday pay-period week that CONTAINS the given instant. */
export function payPeriodRangeFor(d: Date): PayPeriodRange {
  const c = civilInTz(d);
  const dow = new Date(Date.UTC(c.year, c.month - 1, c.day)).getUTCDay();
  const backToMonday = (dow + 6) % 7; // Mon → 0, Sun → 6
  return {
    start: fromCivil(c.year, c.month, c.day - backToMonday),
    end: fromCivil(c.year, c.month, c.day - backToMonday + 6, 23, 59, 59, 999),
  };
}

/** The week that contains `now`. */
export function currentPayPeriodRange(now: Date = new Date()): PayPeriodRange {
  return payPeriodRangeFor(now);
}

/** The week before the one that contains `now`. */
export function previousPayPeriodRange(now: Date = new Date()): PayPeriodRange {
  const { start } = payPeriodRangeFor(now);
  // 3 days back from Monday 00:00 lands on the previous Friday in every DST
  // scenario, so this always resolves to the previous week.
  return payPeriodRangeFor(new Date(start.getTime() - 3 * 24 * 60 * 60 * 1000));
}

/** True when both instants fall in the same Mon–Sun pay-period week. */
export function isSamePayPeriodWeek(a: Date, b: Date): boolean {
  return (
    payPeriodRangeFor(a).start.getTime() === payPeriodRangeFor(b).start.getTime()
  );
}

/** True when the instant falls inside the range (inclusive). */
export function isWithinRange(d: Date, range: PayPeriodRange): boolean {
  const t = d.getTime();
  return t >= range.start.getTime() && t <= range.end.getTime();
}

/**
 * Parse a `YYYY-MM-DD` form value as MIDNIGHT IN THE BUSINESS TIMEZONE.
 * `new Date("2026-07-13")` would parse as UTC midnight — a day early in
 * Toronto — so form dates must always come through here.
 * Returns null for anything that isn't a real calendar date.
 */
export function parseBusinessDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = fromCivil(year, month, day);
  const c = civilInTz(d);
  // Rejects impossible dates (2026-02-31 would have rolled into March).
  if (c.year !== year || c.month !== month || c.day !== day) return null;
  return d;
}

/** "Jul 7 – Jul 13, 2026" style label for a range, in the business timezone. */
export function formatPayPeriodRange(range: PayPeriodRange): string {
  const fmt = (d: Date, withYear: boolean) =>
    d.toLocaleDateString("en-US", {
      timeZone: BUSINESS_TZ,
      month: "short",
      day: "numeric",
      ...(withYear ? { year: "numeric" as const } : {}),
    });
  return `${fmt(range.start, false)} – ${fmt(range.end, true)}`;
}
