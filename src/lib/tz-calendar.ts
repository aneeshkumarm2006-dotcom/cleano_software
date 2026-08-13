// Business-timezone helpers for calendar grids (client-safe — no server imports).
//
// The model, so the calendar can't drift from My Jobs / Job details again:
//
//   • A JOB is an *instant* (a UTC timestamp). Which day column it belongs to
//     and where it sits vertically must be derived in the BUSINESS timezone —
//     never with d.getHours() / d.getDate(), which are browser-local and put a
//     job in the wrong column (or the wrong day) for anyone outside the
//     business timezone.
//
//   • A GRID CELL is a *civil date* (a bare Y-M-D on the wall calendar). We
//     model those as local-midnight Date objects and only ever do civil
//     arithmetic on them (addDays / startOfWeek / getDate). They must NOT be
//     re-formatted through the business timezone, or a browser east of the
//     business timezone would shift the whole grid by a day.
//
// So: jobs are keyed to a civil day with tzDateKey(), cells with civilKey(),
// and the two keys are compared. Times shown for jobs go through @/lib/time.

import { STORE_TZ } from "./timezone";

const TZ = STORE_TZ;

const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

interface TzParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
}

function tzParts(d: Date): TzParts {
  const parts = PARTS.formatToParts(d);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  // Intl can emit hour "24" for midnight with hour12:false.
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Civil day an *instant* falls on, in the business timezone → "2026-07-13". */
export function tzDateKey(d: Date): string {
  const p = tzParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Minutes past midnight of an *instant*, in the business timezone. */
export function tzMinOfDay(d: Date): number {
  const p = tzParts(d);
  return p.hour * 60 + p.minute;
}

/** Civil key of a grid-cell date (plain wall-calendar Y-M-D, no timezone). */
export function civilKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "Today" as a civil grid date, per the business timezone (not the browser's). */
export function tzToday(now: Date = new Date()): Date {
  const p = tzParts(now);
  return new Date(p.year, p.month - 1, p.day);
}
