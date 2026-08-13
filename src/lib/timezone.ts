// The store's timezone — the single source of truth for every date/time in the
// app. Client-safe: no server-only imports, so the same helpers run in server
// components, server actions, cron routes and client components alike.
//
// WHY THIS EXISTS (Stage 2 / Q9): the host runs UTC. Anything formatted or
// bucketed with the runtime default — `d.getHours()`, `toLocaleDateString()`
// with no `timeZone` — silently renders the *server's* clock. That is why the
// dashboard greeted the owner with "Good morning" at 10:13 PM: 22:13 in
// Montréal is 02:13 UTC the next day.
//
// The decision (Q9) is ONE fixed store timezone for everyone — not the viewer's
// local clock and not the server's. A cleaner opening the app while travelling
// still sees the schedule in the times the business actually runs on.
//
// ── Rules ────────────────────────────────────────────────────────────────────
//
//   • An INSTANT (a stored `Date` — job.startTime, alert.createdAt) must be
//     read through this module. Never `d.getHours()` / `d.getDate()` /
//     `toLocale*String()` without an explicit `timeZone`.
//
//   • A CIVIL DATE (a bare Y-M-D on the wall calendar — a calendar grid cell, a
//     "2026-08-12" form value) is not an instant and must NOT be re-formatted
//     through the store timezone. Cross the boundary explicitly with
//     `storeWallClockToUtc` (civil → instant) and `storeDateKey` /
//     `storeInputParts` (instant → civil). See `tz-calendar.ts`.
//
//   • Day/week/month BUCKET BOUNDARIES are civil-date questions. Use
//     `storeDayRange` / `startOfStoreWeek` / `startOfStoreMonth`, never
//     `setHours(0,0,0,0)`.
//
// The env var is kept as an override so an existing deployment can pin a
// different zone; the default is the decided store zone. `America/Montreal` is
// an IANA link to `America/Toronto` — identical wall clock, so this is a rename,
// not a behaviour change, for anyone already running on the old default.

export const STORE_TZ =
  process.env.NEXT_PUBLIC_BUSINESS_TIMEZONE ?? "America/Montreal";

/** Locale for every store-facing date/time string. Pinned so the server and
 *  the browser can never disagree about month names or field order. */
export const STORE_LOCALE = "en-US";

// ── Parts ────────────────────────────────────────────────────────────────────

export interface StoreParts {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
  /** 0-23 */
  hour: number;
  minute: number;
  second: number;
}

const PARTS_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: STORE_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const asDate = (d: Date | string | number): Date =>
  d instanceof Date ? d : new Date(d);

/** Split an *instant* into its store wall-clock components. */
export function storeParts(d: Date | string | number = new Date()): StoreParts {
  const parts = PARTS_FMT.formatToParts(asDate(d));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // Intl emits hour "24" for midnight under hour12:false.
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Hour of day (0-23) of an *instant*, in the store timezone. */
export function getStoreHour(d: Date | string | number = new Date()): number {
  return storeParts(d).hour;
}

/** Minutes past store midnight of an *instant*. */
export function getStoreMinuteOfDay(d: Date | string | number): number {
  const p = storeParts(d);
  return p.hour * 60 + p.minute;
}

/** Weekday (0 = Sunday) of the store civil day an *instant* falls on. */
export function storeWeekday(d: Date | string | number = new Date()): number {
  const p = storeParts(d);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

/** Civil day an *instant* falls on, in the store timezone → "2026-08-12". */
export function storeDateKey(d: Date | string | number = new Date()): string {
  const p = storeParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Store wall-clock time of an *instant* → "09:30" (24h, sortable). */
export function storeTimeKey(d: Date | string | number): string {
  const p = storeParts(d);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Year-month bucket key of an *instant* → "2026-08". Matches `Budget.period`. */
export function storeMonthPeriod(d: Date | string | number = new Date()): string {
  const p = storeParts(d);
  return `${p.year}-${pad(p.month)}`;
}

/** Human month bucket label of an *instant* → "Aug 26" (chart axes). */
export function storeMonthKey(d: Date | string | number = new Date()): string {
  return formatDate(d, { month: "short", year: "2-digit" });
}

/** Instant → the `<input type="date">` / `<input type="time">` pair a form
 *  expects, in store wall-clock. Inverse of `storeWallClockToUtc`. */
export function storeInputParts(d: Date | string | number): {
  date: string;
  time: string;
} {
  const p = storeParts(d);
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
  };
}

// ── Civil date → instant ─────────────────────────────────────────────────────

/** Offset of the store timezone from UTC at instant `d`, in ms
 *  (Montréal in August = -4h). Derived via Intl so DST needs no date library. */
function storeOffsetMs(d: Date): number {
  const p = storeParts(d);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallAsUtc - (d.getTime() - d.getMilliseconds());
}

/**
 * UTC instant for a wall-clock date/time **in the store timezone**.
 * "2026-08-12" + "09:00" means 9 AM in Montréal wherever this runs;
 * `new Date("2026-08-12T09:00")` would read it as server-local (UTC on Vercel)
 * and shift the result by 4-5 hours.
 */
export function storeWallClockToUtc(dateStr: string, timeStr = "00:00:00"): Date {
  const [y, mo, day] = dateStr.split("-").map(Number);
  const [h = 0, mi = 0, s = 0] = timeStr.split(":").map(Number);
  const wallAsUtc = Date.UTC(y, (mo ?? 1) - 1, day ?? 1, h, mi, s);
  let offset = storeOffsetMs(new Date(wallAsUtc));
  // Re-derive once in case the first guess landed on the other side of a DST
  // boundary; the second reading is taken from the corrected instant.
  const refined = storeOffsetMs(new Date(wallAsUtc - offset));
  if (refined !== offset) offset = refined;
  return new Date(wallAsUtc - offset);
}

// ── Bucket boundaries ────────────────────────────────────────────────────────

/** The instant at which the store's civil day containing `d` begins. */
export function startOfStoreDay(d: Date | string | number = new Date()): Date {
  return storeWallClockToUtc(storeDateKey(d));
}

/**
 * Half-open `[start, end)` instant range covering a **civil date** ("2026-08-12")
 * in the store timezone. End-exclusive on purpose: a `lt: end` query can't
 * double-count 23:59:59.999, and the next day's midnight is never missed.
 */
export function storeCivilDayRange(dateStr: string): { start: Date; end: Date } {
  const [y, mo, day] = dateStr.split("-").map(Number);
  const start = storeWallClockToUtc(dateStr);
  // Step the civil calendar rather than adding 86 400 000 ms — a DST day is 23
  // or 25 hours long, so a fixed millisecond offset lands in the wrong place.
  const next = new Date(Date.UTC(y, (mo ?? 1) - 1, (day ?? 1) + 1));
  const end = storeWallClockToUtc(
    `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`
  );
  return { start, end };
}

/** Half-open `[start, end)` instant range covering the store civil day that the
 *  *instant* `d` falls on. */
export function storeDayRange(d: Date | string | number = new Date()): {
  start: Date;
  end: Date;
} {
  return storeCivilDayRange(storeDateKey(d));
}

/** Start of the store civil week (Sunday) containing `d`. */
export function startOfStoreWeek(d: Date | string | number = new Date()): Date {
  const p = storeParts(d);
  // Weekday of the civil date, computed on a UTC proxy so the host clock can't
  // shift it.
  const proxy = new Date(Date.UTC(p.year, p.month - 1, p.day));
  proxy.setUTCDate(proxy.getUTCDate() - proxy.getUTCDay());
  return storeWallClockToUtc(
    `${proxy.getUTCFullYear()}-${pad(proxy.getUTCMonth() + 1)}-${pad(proxy.getUTCDate())}`
  );
}

/** Start of the store civil month containing `d`. */
export function startOfStoreMonth(d: Date | string | number = new Date()): Date {
  const p = storeParts(d);
  return storeWallClockToUtc(`${p.year}-${pad(p.month)}-01`);
}

/** Add `n` civil days to an instant, keeping its store wall-clock time. */
export function addStoreDays(d: Date | string | number, n: number): Date {
  const p = storeParts(d);
  const proxy = new Date(Date.UTC(p.year, p.month - 1, p.day + n));
  return storeWallClockToUtc(
    `${proxy.getUTCFullYear()}-${pad(proxy.getUTCMonth() + 1)}-${pad(proxy.getUTCDate())}`,
    `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`
  );
}

/** Add `n` civil months to an instant, keeping its store wall-clock time.
 *  Clamps to the last day of the target month (Jan 31 + 1mo → Feb 28). */
export function addStoreMonths(d: Date | string | number, n: number): Date {
  const p = storeParts(d);
  const target = new Date(Date.UTC(p.year, p.month - 1 + n, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  return storeWallClockToUtc(
    `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(
      Math.min(p.day, lastDay)
    )}`,
    `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`
  );
}

// ── Formatting ───────────────────────────────────────────────────────────────

/** "9:30 AM" */
export function formatTime(
  d: Date | string | number,
  opts?: Intl.DateTimeFormatOptions
): string {
  return asDate(d).toLocaleTimeString(STORE_LOCALE, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    ...opts,
    timeZone: STORE_TZ,
  });
}

/** "8/12/2026" by default; pass `opts` for anything else. */
export function formatDate(
  d: Date | string | number,
  opts?: Intl.DateTimeFormatOptions
): string {
  return asDate(d).toLocaleDateString(STORE_LOCALE, {
    ...opts,
    timeZone: STORE_TZ,
  });
}

/** "Aug 12, 9:30 AM" */
export function formatDateTime(
  d: Date | string | number,
  opts?: Intl.DateTimeFormatOptions
): string {
  return asDate(d).toLocaleString(STORE_LOCALE, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    ...opts,
    timeZone: STORE_TZ,
  });
}
