// Calendar-date formatting for the record screens (kit, availability,
// training, documents, strikes). Instants are first turned into the COMPANY's
// calendar date (via localDateKey in ./format), then written out from fixed
// month names, so "4 Sep" reads the same on every phone whatever its locale
// or zone. Date keys ("2026-10-12") are wall-calendar days and are never
// shifted by a zone at all.
import { MONTH_NAMES as MONTHS, parseDateKey, WEEKDAY_NAMES, weekdayIndex } from "@bookmops/ui-native";

import { localDateKey } from "./format";

// The names come from the month grid's lists, so a date reads the same in a
// label as on the calendar. Every short form is the first three letters.
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
const WEEKDAYS_SHORT = WEEKDAY_NAMES.map((d) => d.slice(0, 3));

/** "4 Sep" from a date key. */
export function keyDayMonth(key: string): string {
  const p = parseDateKey(key);
  return p ? `${p.day} ${MONTHS_SHORT[p.month - 1]}` : key;
}

/** "4 Sep 2026" from a date key. */
export function keyDayMonthYear(key: string): string {
  const p = parseDateKey(key);
  return p ? `${p.day} ${MONTHS_SHORT[p.month - 1]} ${p.year}` : key;
}

/** "Tue 22 Sep" from a date key. */
export function keyWeekdayDayMonth(key: string): string {
  const p = parseDateKey(key);
  return p ? `${WEEKDAYS_SHORT[weekdayIndex(key)]} ${p.day} ${MONTHS_SHORT[p.month - 1]}` : key;
}

/** "4 Sep" for an instant, on the company's calendar. */
export function dayMonth(iso: string, timeZone: string): string {
  return keyDayMonth(localDateKey(iso, timeZone));
}

/** "4 Sep 2026" for an instant, on the company's calendar. */
export function dayMonthYear(iso: string, timeZone: string): string {
  return keyDayMonthYear(localDateKey(iso, timeZone));
}

/**
 * A span of days, as short as it reads clearly:
 * "12 October", "12 – 19 October", "30 September – 2 October",
 * and the year only when the span crosses one.
 */
export function rangeLabel(from: string, to: string): string {
  const a = parseDateKey(from);
  const b = parseDateKey(to);
  if (!a || !b) return `${from} – ${to}`;
  if (from === to) return `${a.day} ${MONTHS[a.month - 1]}`;
  if (a.year !== b.year) return `${a.day} ${MONTHS_SHORT[a.month - 1]} ${a.year} – ${b.day} ${MONTHS_SHORT[b.month - 1]} ${b.year}`;
  if (a.month === b.month) return `${a.day} – ${b.day} ${MONTHS[b.month - 1]}`;
  return `${a.day} ${MONTHS[a.month - 1]} – ${b.day} ${MONTHS[b.month - 1]}`;
}

/** "1 day", "8 days". */
export function dayCount(n: number): string {
  return `${n} day${n === 1 ? "" : "s"}`;
}

export { daysBetween as daysBetweenKeys } from "@bookmops/ui-native";
