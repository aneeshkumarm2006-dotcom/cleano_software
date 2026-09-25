// Times of day as the web stores them: "08:00", 24-hour. Stepped in half
// hours on the phone, which is how schedules are written; a time already on
// record off the half hour ("08:15") is kept until it is stepped.
import type { DayOff } from "@bookmops/api/v1";
import { daysBetween } from "@bookmops/ui-native";

export const STEP = 30;
export const LAST = 23 * 60 + 30;

export function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function fromMinutes(n: number): string {
  const c = Math.min(LAST, Math.max(0, n));
  return `${String(Math.floor(c / 60)).padStart(2, "0")}:${String(c % 60).padStart(2, "0")}`;
}

/** The next half hour after `t`, or before it. */
export function step(t: string, dir: 1 | -1): string {
  const n = toMinutes(t);
  const next = dir === 1 ? Math.floor(n / STEP) * STEP + STEP : Math.ceil(n / STEP) * STEP - STEP;
  return fromMinutes(next);
}

/** "8:00", "17:30": as the schedules are written. */
export function show(t: string): string {
  return t.replace(/^0(?=\d)/, "");
}

export interface DaysOffGroup {
  from: string;
  to: string;
  days: number;
  reason: string | null;
}

/** Back-to-back days off with the same reason read as one stretch: "12 – 19 October". */
export function groupDaysOff(days: readonly DayOff[]): DaysOffGroup[] {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const groups: DaysOffGroup[] = [];
  for (const d of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.reason === d.reason && daysBetween(last.to, d.date) === 1) {
      last.to = d.date;
      last.days += 1;
    } else {
      groups.push({ from: d.date, to: d.date, days: 1, reason: d.reason });
    }
  }
  return groups;
}
