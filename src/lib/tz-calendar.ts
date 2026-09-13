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

// One mechanism, not two: `storeParts` in @/lib/timezone is what the dashboard
// header reads the store clock with, so the calendar reads it with the same
// function rather than keeping a second Intl formatter that could drift.
import { storeParts } from "./timezone";

const pad = (n: number) => String(n).padStart(2, "0");

/** Civil day an *instant* falls on, in the business timezone → "2026-07-13". */
export function tzDateKey(d: Date): string {
  const p = storeParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Minutes past midnight of an *instant*, in the business timezone. */
export function tzMinOfDay(d: Date): number {
  const p = storeParts(d);
  return p.hour * 60 + p.minute;
}

/** Civil key of a grid-cell date (plain wall-calendar Y-M-D, no timezone). */
export function civilKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "Today" as a civil grid date, per the business timezone (not the browser's). */
export function tzToday(now: Date = new Date()): Date {
  const p = storeParts(now);
  return new Date(p.year, p.month - 1, p.day);
}

/**
 * "Now" as a *floating* business wall-clock Date — the store's Y-M-D h:m:s
 * carried in a browser-local Date.
 *
 * WHY a second helper: `tzToday()` answers "which cell is today", but the time
 * grid also asks "how far down the column is the now-line", and that needs the
 * hour and minute in store time too. Handing the views a raw `new Date()` made
 * both answers the VIEWER's — this machine (Asia/Calcutta, a day ahead of
 * Montréal at 18:52) highlighted tomorrow's cell while the dashboard header,
 * which goes through @/lib/timezone, correctly said today.
 *
 * The shape matches what `getJobsForDay` already ships for events (floating
 * store wall-clock, no "Z"), which is exactly why the views can keep using
 * `getHours()` / `isSameDay` unchanged and still be right in every zone —
 * ahead of the store or behind it. Do NOT re-format the result through
 * STORE_TZ; that would convert a second time.
 */
export function tzNow(now: Date = new Date()): Date {
  const p = storeParts(now);
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}
