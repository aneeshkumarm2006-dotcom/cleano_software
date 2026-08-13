// Established display aliases over @/lib/timezone.
//
// @/lib/timezone is the single source of truth for the store timezone and the
// civil-date ⇄ instant boundary (read its header before touching date logic).
// The `fmt*` / `tz*` names below have ~50 call sites across the admin, so they
// stay as-is; only the constant and the implementations behind them moved.
// New code should import from @/lib/timezone directly.

import {
  STORE_TZ,
  STORE_LOCALE,
  formatDate,
  formatDateTime,
  formatTime,
  startOfStoreDay,
  storeInputParts,
  storeWallClockToUtc,
} from "./timezone";

const TZ = STORE_TZ;

export function fmtTime(date: Date | string): string {
  return formatTime(date);
}

export function fmtDate(date: Date | string, opts?: Intl.DateTimeFormatOptions): string {
  return formatDate(date, opts);
}

export function fmtDateTime(date: Date | string): string {
  return formatDateTime(date);
}

// Returns HH:MM:SS AM/PM in the store timezone — for live clocks
export function fmtClockTz(d: Date): string {
  const parts = new Intl.DateTimeFormat(STORE_LOCALE, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: TZ,
  }).formatToParts(d);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "00";
  const dayPeriod = parts.find(p => p.type === "dayPeriod")?.value ?? "AM";
  return `${get("hour")}:${get("minute")}:${get("second")} ${dayPeriod}`;
}

// UTC instant of midnight (start of day) in the store timezone for the given
// moment — used to split "upcoming" vs "past" jobs without a date lib.
export function startOfDayTz(d: Date = new Date()): Date {
  return startOfStoreDay(d);
}

// UTC instant for a wall-clock date/time in the store timezone. Form inputs
// ("2026-07-16" + "09:00") mean 9 AM in Montréal regardless of where the server
// runs; `new Date("...T09:00")` would interpret them as server-local (UTC on
// Vercel) and shift every manually created job by 4-5 hours.
export function tzWallClockToUtc(dateStr: string, timeStr = "00:00:00"): Date {
  return storeWallClockToUtc(dateStr, timeStr);
}

// Inverse of tzWallClockToUtc: split a stored UTC instant into the date/time
// input strings a form expects, in the STORE timezone. Using
// `new Date(x).toISOString().slice(...)` here (UTC) is what made the job edit
// modal show a 6 PM Montréal job as 10 PM — the +4/5h offset — while the jobs
// list (which formats in the store zone) showed it correctly.
export function tzInputParts(date: Date | string): { date: string; time: string } {
  return storeInputParts(date);
}

export function fmtShortTz(d: Date): string {
  return formatTime(d);
}
