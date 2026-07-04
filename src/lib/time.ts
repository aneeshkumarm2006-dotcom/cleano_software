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

export function fmtShortTz(d: Date): string {
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: TZ,
  });
}
