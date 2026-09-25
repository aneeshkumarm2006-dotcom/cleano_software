// Sample times for development builds, written in the sample company's own
// zone. Built from the phone's clock instead, a simulator set to another zone
// would show a 10:00 job at 0:30.
import { addDays, parseDateKey } from "@bookmops/ui-native";

import { previewMe } from "./jobs";

const TZ = previewMe().company.timezone;

/** Today's date in the company's zone, "2026-09-25". */
export const companyToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());

/** The instant that is `hh:mm` on `key` in the company's zone. */
export function at(key: string, hh: number, mm: number): string {
  const p = parseDateKey(key)!;
  const guess = Date.UTC(p.year, p.month - 1, p.day, hh, mm);
  // How far the zone's wall clock is from UTC at that moment, then correct.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(guess));
  const n = (t: string) => Number(parts.find((x) => x.type === t)?.value);
  const shown = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"));
  return new Date(guess - (shown - guess)).toISOString();
}

/** The hour now on the company's clock, 0–23. */
export const companyHour = () => Number(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(new Date()));

/** `hh:mm`, `days` from today, in the company's zone. */
export const daysFromToday = (days: number, hh: number, mm = 0) => new Date(at(addDays(companyToday(), days), hh, mm));
