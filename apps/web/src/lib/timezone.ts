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

// ── Per-tenant zones (Sept 10 list, item 6, part 2) ─────────────────────────
//
// `STORE_TZ` above is one value for the whole deployment. With a second tenant
// that is wrong by construction: Cleano is in Montreal and CleanoCalgary is
// two hours behind it, and a single constant cannot be right for both.
//
// `Organization.timezone` already exists and `OrgContext` already carries it.
// What was missing is anything reading it. This is that.
//
// WHY REGISTERED RESOLVERS RATHER THAN IMPORTS. This module is client-safe on
// purpose — the same helpers run in server components, server actions, cron
// routes and the browser — and neither place the answer comes from can be
// imported here. The organization context is built on `node:async_hooks`,
// which a browser cannot load; the request-scoped answer is built on React's
// per-request cache, which only exists in the server build. So each one
// registers itself, and a browser loads neither.
//
// THE THREE PLACES AN ANSWER COMES FROM, in the order they are asked:
//
//   1. `runAsOrg` — cron jobs, webhooks and scripts announce their tenant
//      outright. It wins, because announcing is the whole point of it: a
//      platform admin acting on another workspace inside a request must get
//      that workspace's clock, not the one they are signed in to.
//   2. The REQUEST — resolved from the host and remembered for the render.
//      See `store-tz.server.ts`.
//   3. The BROWSER — the server stamps the answer on `window` before any of
//      our script runs, so a client component formats in the same zone as the
//      server-rendered half of the same page. The alternative was worse than
//      doing nothing: one page printing two clocks.
//
// The fallback is the deployment default, which is today's behaviour exactly,
// so nothing moves where no answer is available.

type StoreTzResolver = () => string | undefined;

/** Who is answering. The order of this list IS the precedence above. */
type StoreTzSource = "context" | "request";
const RESOLVER_ORDER: readonly StoreTzSource[] = ["context", "request"];

const resolvers = new Map<StoreTzSource, StoreTzResolver>();

/**
 * Let a server-side source answer "which zone are we in".
 *
 * Keyed rather than a single slot, because there are two sources and module
 * load order does not decide which of them is right — the list above does. Not
 * for general use, hence the name.
 */
export function __setStoreTzResolver(
  source: StoreTzSource,
  fn: StoreTzResolver,
): void {
  resolvers.set(source, fn);
}

/** What the server stamped on the page, in a browser. Undefined anywhere else. */
function browserStoreTz(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const tz = (window as unknown as { __cleanoTz?: unknown }).__cleanoTz;
  return typeof tz === "string" && tz.length > 0 ? tz : undefined;
}

// A zone name that Intl does not recognise makes `new Intl.DateTimeFormat`
// throw a RangeError, and every date on the page is formatted through one. An
// organization's timezone is an editable text column, so one bad save would
// otherwise take the whole workspace down rather than printing the wrong hour.
// Checked once per distinct string: a deployment has a handful.
const TZ_IS_USABLE = new Map<string, boolean>();

/**
 * Is this a zone `Intl` actually knows?
 *
 * Exported because the two places a workspace's zone is SET — the platform
 * console when a workspace is created, and Settings → General — must refuse a
 * value the rest of the app cannot use. CleanoCalgary's row said "Toronto",
 * which is not an IANA zone at all, so the guard below was carrying a live
 * tenant rather than covering a hypothetical.
 */
export function isValidTimeZone(tz: unknown): tz is string {
  return typeof tz === "string" && tz.length > 0 && isUsableTz(tz);
}

function isUsableTz(tz: string): boolean {
  let ok = TZ_IS_USABLE.get(tz);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      ok = true;
    } catch {
      ok = false;
    }
    TZ_IS_USABLE.set(tz, ok);
  }
  return ok;
}

/** The zone to read and write wall clocks in, right now. */
export function storeTz(): string {
  // Server sources first, in the documented order, then the browser. Only one
  // of the two can ever exist — resolvers are never registered in a browser,
  // and `window` is never defined on the server — so the order costs nothing
  // and keeps the precedence above true rather than incidental.
  const answer = serverStoreTz() ?? browserStoreTz();
  if (answer && answer !== STORE_TZ && isUsableTz(answer)) return answer;
  return STORE_TZ;
}

function serverStoreTz(): string | undefined {
  for (const source of RESOLVER_ORDER) {
    try {
      const tz = resolvers.get(source)?.();
      if (tz) return tz;
    } catch {
      // A resolver that throws must not take the page with it.
    }
  }
  return undefined;
}

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

// One formatter per zone, built once and kept. Constructing an
// Intl.DateTimeFormat is expensive and this runs on every date the app prints;
// the old code built it once for the only zone there was. A deployment serves a
// handful of tenants, so the cache is small and never needs eviction.
const PARTS_FMT_BY_TZ = new Map<string, Intl.DateTimeFormat>();

function partsFmt(tz: string): Intl.DateTimeFormat {
  let fmt = PARTS_FMT_BY_TZ.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    PARTS_FMT_BY_TZ.set(tz, fmt);
  }
  return fmt;
}

const asDate = (d: Date | string | number): Date =>
  d instanceof Date ? d : new Date(d);

/** Split an *instant* into its store wall-clock components. */
export function storeParts(d: Date | string | number = new Date()): StoreParts {
  const parts = partsFmt(storeTz()).formatToParts(asDate(d));
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
    timeZone: storeTz(),
  });
}

/** "8/12/2026" by default; pass `opts` for anything else. */
export function formatDate(
  d: Date | string | number,
  opts?: Intl.DateTimeFormatOptions
): string {
  return asDate(d).toLocaleDateString(STORE_LOCALE, {
    ...opts,
    timeZone: storeTz(),
  });
}

/**
 * "Eastern Time" / "Mountain Time" — the clock this page's times are on.
 *
 * For labelling a form, so an admin in Calgary editing a Montreal job can see
 * which clock the time they type will be read in (Sept 10, item 6: "UI should
 * make timezone clear where needed"). The season is stripped: "Eastern
 * Daylight Time" is precise, nobody schedules by it, and keeping it would make
 * the label change under people twice a year for no reason.
 */
export function storeTzLabel(d: Date | string | number = new Date()): string {
  const tz = storeTz();
  try {
    const name = new Intl.DateTimeFormat(STORE_LOCALE, {
      timeZone: tz,
      timeZoneName: "long",
    })
      .formatToParts(asDate(d))
      .find((p) => p.type === "timeZoneName")?.value;
    if (name) return name.replace(/\b(Standard|Daylight|Summer)\s+/i, "");
  } catch {
    // Falls through to the city name below.
  }
  // "America/Argentina/Buenos_Aires" -> "Buenos Aires". Never empty.
  return tz.split("/").pop()?.replace(/_/g, " ") || tz;
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
    timeZone: storeTz(),
  });
}
