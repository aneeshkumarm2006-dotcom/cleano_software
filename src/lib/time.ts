const TZ = process.env.NEXT_PUBLIC_BUSINESS_TIMEZONE ?? "America/Toronto";

export function fmtTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: TZ,
  });
}

export function fmtDate(date: Date | string, opts?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", { timeZone: TZ, ...opts });
}

export function fmtDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: TZ,
  });
}

// Returns HH:MM:SS AM/PM in business timezone — for live clocks
export function fmtClockTz(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
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

// UTC instant of midnight (start of day) in the business timezone for the
// given moment — used to split "upcoming" vs "past" jobs without a date lib.
export function startOfDayTz(d: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const msIntoDay =
    ((get("hour") % 24) * 3600 + get("minute") * 60 + get("second")) * 1000 +
    d.getMilliseconds();
  return new Date(d.getTime() - msIntoDay);
}

// Offset of the business timezone from UTC at instant `d` (Toronto in July =
// -4h). Derived via Intl so DST is handled without a date library.
function tzOffsetMs(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wallAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second")
  );
  return wallAsUtc - (d.getTime() - d.getMilliseconds());
}

// UTC instant for a wall-clock date/time in the business timezone. Form inputs
// ("2026-07-16" + "09:00") mean 9 AM in America/Toronto regardless of where
// the server runs; `new Date("...T09:00")` would interpret them as server-local
// (UTC on Vercel) and shift every manually created job by 4-5 hours.
export function tzWallClockToUtc(dateStr: string, timeStr = "00:00:00"): Date {
  const [y, mo, day] = dateStr.split("-").map(Number);
  const [h = 0, mi = 0, s = 0] = timeStr.split(":").map(Number);
  const wallAsUtc = Date.UTC(y, (mo ?? 1) - 1, day ?? 1, h, mi, s);
  let offset = tzOffsetMs(new Date(wallAsUtc));
  // Re-derive once in case the first guess crossed a DST boundary.
  const refined = tzOffsetMs(new Date(wallAsUtc - offset));
  if (refined !== offset) offset = refined;
  return new Date(wallAsUtc - offset);
}

export function fmtShortTz(d: Date): string {
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: TZ,
  });
}
