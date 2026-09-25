// Formatting for the screens. Every time is shown in the COMPANY's zone (from
// /me), never the phone's: a cleaner whose phone is set to another zone still
// sees the time the job actually starts. The locale is explicit for the same
// reason the core rules forbid an implicit one.
const LOCALE = "en-CA";

const cache = new Map<string, Intl.DateTimeFormat>();
function dtf(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = timeZone + JSON.stringify(options);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALE, { timeZone, ...options });
    cache.set(key, f);
  }
  return f;
}

/** "9:00", "13:30": 24-hour, as the schedules are written. */
export function clockTime(iso: string, timeZone: string): string {
  // en-CA pads the hour ("06:00") even when asked for "numeric"; schedules
  // write "6:00", so the leading zero is dropped.
  return dtf(timeZone, { hour: "numeric", minute: "2-digit", hourCycle: "h23" })
    .format(new Date(iso))
    .replace(/^0(?=\d)/, "");
}

/** The hour alone, for the day rail: "9", "13". */
export function hourMark(iso: string, timeZone: string): string {
  return String(Number(dtf(timeZone, { hour: "numeric", hourCycle: "h23" }).format(new Date(iso))));
}

/** "Tuesday 22 September". */
export function longDate(iso: string, timeZone: string): string {
  const parts = dtf(timeZone, { weekday: "long", day: "numeric", month: "long" }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}`;
}

/** "Tue 22 Sep", for list sections. */
export function shortDate(iso: string, timeZone: string): string {
  const parts = dtf(timeZone, { weekday: "short", day: "numeric", month: "short" }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value.replace(".", "") ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}`;
}

/** The calendar date in the company's zone, "2026-09-22", for grouping. */
export function localDateKey(iso: string, timeZone: string): string {
  return dtf(timeZone, { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** Jobs grouped under the calendar day they start on in the company's zone, in the order given. */
export function groupByDay<T extends { startsAt: string }>(items: readonly T[], timeZone: string): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const job of items) {
    const key = localDateKey(job.startsAt, timeZone);
    const list = groups.get(key);
    if (list) list.push(job);
    else groups.set(key, [job]);
  }
  return [...groups];
}

/** "MD" for "Marie D.", "JM" for "Jean Morin": a person's avatar. */
export function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((p) => p[0]!.toUpperCase()).join("") || "?";
}

const money = new Map<string, Intl.NumberFormat>();
/** "$96.00". Cents in, never floats. */
export function formatMoney(cents: number, currency: string): string {
  let f = money.get(currency);
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, { style: "currency", currency, currencyDisplay: "narrowSymbol" });
    money.set(currency, f);
  }
  return f.format(cents / 100);
}

/** "$412", for totals where cents are noise. */
export function formatMoneyWhole(cents: number, currency: string): string {
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100));
}

/** "48 min", "2 h 5 min", for "starts in …". */
export function duration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "Morning", "Afternoon", "Evening", by the company's clock. */
export function partOfDay(now: Date, timeZone: string): "Morning" | "Afternoon" | "Evening" {
  const hour = Number(dtf(timeZone, { hour: "numeric", hourCycle: "h23" }).format(now));
  return hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
}
