// The cleaner's available-jobs CALENDAR — grid maths and the view contract
// (Stage 13 of `_ai_context/TODO.md`; cleano_inventory_operations_fixes.pdf #13,
// p.8–9).
//
// Everything here is PURE, so `scripts/verify-stage13-available-jobs-calendar.ts`
// can *run* the rules instead of reading JSX and hoping. Client-safe: the only
// imports are `civilKey` (@/lib/tz-calendar) and `STORE_LOCALE`
// (@/lib/timezone). A second spelling of the day-key format is exactly the drift
// this codebase keeps paying for, so the grid asks the same function the rest of
// the calendar stack does rather than re-deriving "YYYY-MM-DD".
//
// ── THE MODEL (the long version lives in @/lib/tz-calendar) ──────────────────
//
//   • A JOB is an INSTANT. Which day it belongs to comes from `tzDateKey()`, in
//     the BUSINESS timezone — a cleaner opening the app from another province
//     still sees the business's Tuesday, not their own.
//
//   • A GRID CELL is a CIVIL DATE: a bare Y-M-D on the wall calendar, modelled
//     as a local-midnight `Date` and only ever compared through `civilKey()`.
//     Cells are NEVER re-formatted through the business timezone; doing so
//     shifts the whole grid by a day for anyone east of it.
//
//   Both keys are plain "YYYY-MM-DD" strings, which is what lets them be
//   compared — and, because ISO day keys sort lexicographically, ordered with
//   `<` rather than by parsing back into dates.

import { civilKey } from "./tz-calendar";
import { STORE_LOCALE } from "./timezone";

/* ── The view contract ─────────────────────────────────────────────────────── */

/** List (the original board) or Calendar (Stage 13). Never one *instead* of the
 *  other — PDF #13 asks for the calendar to work *alongside* the list. */
export type AvailableJobsView = "list" | "calendar";

export const AVAILABLE_JOBS_VIEWS: readonly AvailableJobsView[] = [
  "list",
  "calendar",
];

/**
 * List stays the default for a first-time visitor: it is what every cleaner
 * already knows, it needs no date chosen before it shows anything, and it is
 * what the server renders before the stored preference is read back.
 */
export const DEFAULT_AVAILABLE_JOBS_VIEW: AvailableJobsView = "list";

/** localStorage key for the remembered choice (step 13.1). */
export const AVAILABLE_JOBS_VIEW_KEY = "cleano.available-jobs.view";

/**
 * Marks a day's dot row may hold (step 13.2). Three, matching the reference
 * screenshot — a fourth 6px dot on a phone reads as noise rather than as one
 * more job.
 */
export const DAY_DOT_CAP = 3;

/**
 * Anything that is not one of the two known views — junk, `null`, a value
 * written by a future version — falls back to the default rather than throwing.
 * A hand-edited preference must never cost a cleaner the page.
 */
export function parseAvailableJobsView(raw: unknown): AvailableJobsView {
  return raw === "calendar" || raw === "list"
    ? raw
    : DEFAULT_AVAILABLE_JOBS_VIEW;
}

/* ── Civil-date arithmetic ─────────────────────────────────────────────────── */

/**
 * The civil date a "YYYY-MM-DD" key names, or null if the key is not one.
 *
 * The round-trip through `civilKey` is the validation: `new Date(2026, 1, 30)`
 * happily rolls over to 2 March, so "2026-02-30" would otherwise parse into a
 * date that is not the one it spells.
 */
export function civilDateFromKey(key: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return civilKey(date) === key ? date : null;
}

/** First day of the civil month containing `d`. */
export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/**
 * `n` civil months on from `d`, normalised to the **first** of the target
 * month. Normalising is the point: `setMonth` on a 31st lands on 3 March, so a
 * "next month" button that kept the day number would skip February entirely.
 */
export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

/** Do two civil dates fall in the same calendar month? */
export function sameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/** Sortable month bucket of a civil date → "2026-08". */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const MONTH_FMT = new Intl.DateTimeFormat(STORE_LOCALE, {
  month: "long",
  year: "numeric",
});
const DAY_FMT = new Intl.DateTimeFormat(STORE_LOCALE, {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

/**
 * "August 2026" — the grid heading.
 *
 * Deliberately formatted with NO `timeZone`, unlike everything that renders a
 * job. A cell is a civil date, so the runtime's own zone reads back the same
 * Y-M-D that built it; pushing it through the business timezone is what would
 * make a browser east of Montréal render the 1st as the previous month.
 */
export function monthLabel(d: Date): string {
  return MONTH_FMT.format(d);
}

/** "Tuesday, August 18, 2026" — the accessible name of a day cell. */
export function dayLabel(d: Date): string {
  return DAY_FMT.format(d);
}

/* ── The grid ──────────────────────────────────────────────────────────────── */

/**
 * The cells of the month grid containing `anchor`: whole Sunday→Saturday weeks,
 * leading and trailing days from the neighbouring months included so the rows
 * are square.
 *
 * The row count is **derived, not fixed at six**. A fixed 42 cells costs
 * February 2026 (which starts on a Sunday and ends after exactly four weeks) two
 * entire rows of dimmed, dot-less March — a third of the grid, on the phone
 * screen this feature exists for. The price is that the card's height changes by
 * one row between some months, which is the cheaper of the two.
 */
export function monthGridCells(anchor: Date): Date[] {
  const first = startOfMonth(anchor);
  const lead = first.getDay(); // 0 = Sunday
  const daysInMonth = new Date(
    first.getFullYear(),
    first.getMonth() + 1,
    0
  ).getDate();
  const weeks = Math.ceil((lead + daysInMonth) / 7);
  // Negative / overflowing day numbers roll into the neighbouring months, which
  // is exactly what the leading and trailing cells are.
  return Array.from(
    { length: weeks * 7 },
    (_, i) => new Date(first.getFullYear(), first.getMonth(), 1 - lead + i)
  );
}

/**
 * How many jobs land on each civil day, from the day keys of the jobs the active
 * filters left visible. Takes keys rather than jobs so the rule has no opinion
 * about the shape of a job — and so the verify script can exercise it.
 */
export function countJobsByDay(dayKeys: Iterable<string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const key of dayKeys) out.set(key, (out.get(key) ?? 0) + 1);
  return out;
}

/**
 * The dots to draw under a day: one per job, up to `DAY_DOT_CAP` **marks** —
 * and when there are more jobs than marks, the last mark becomes the count.
 * So 3 jobs are `● ● ●` and 5 are `● ● +3`.
 *
 * The badge taking a dot's slot rather than being added beside three of them is
 * a measured constraint, not a stylistic one: three 6px dots *plus* a
 * three-character badge is wider than a day cell on a 320px phone, and the
 * overflow lands on the neighbouring day. Either way the arithmetic reads
 * straight — `dots + extra` is always the number of jobs.
 */
export function dayDotPlan(count: number): { dots: number; extra: number } {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  if (n <= DAY_DOT_CAP) return { dots: n, extra: 0 };
  const dots = DAY_DOT_CAP - 1;
  return { dots, extra: n - dots };
}

/**
 * The first day on or after `fromKey` that has jobs, or null. Powers the "next
 * open day" jump on an empty day, so a cleaner who taps a blank Tuesday is not
 * left hunting the month for a dot.
 *
 * Lexicographic on purpose — ISO day keys sort as dates, so this needs no
 * parsing and cannot be confused by a timezone.
 */
export function nextDayKeyWithJobs(
  fromKey: string,
  dayKeys: Iterable<string>
): string | null {
  let best: string | null = null;
  for (const key of dayKeys) {
    if (key < fromKey) continue;
    if (best === null || key < best) best = key;
  }
  return best;
}

/**
 * How far the month navigation may run: from the earliest month that has
 * anything in it (or this month, whichever is earlier) to the latest.
 *
 * Bounds are computed from the cleaner's WHOLE claimable set, never the filtered
 * one — otherwise picking an area filter would silently lock the arrows, and
 * clearing it would not obviously unlock them. Claimable jobs are always ahead
 * of `now`, so in practice `min` is this month; it is computed rather than
 * assumed so a job that slips into the current hour can still be reached.
 */
export function monthNavBounds(
  dayKeys: Iterable<string>,
  today: Date
): { min: Date; max: Date } {
  let min = startOfMonth(today);
  let max = min;
  for (const key of dayKeys) {
    const date = civilDateFromKey(key);
    if (!date) continue;
    const month = startOfMonth(date);
    if (+month < +min) min = month;
    if (+month > +max) max = month;
  }
  return { min, max };
}

/** `anchor` pulled back inside `[min, max]`, by month. */
export function clampMonth(anchor: Date, min: Date, max: Date): Date {
  const month = startOfMonth(anchor);
  if (+month < +startOfMonth(min)) return startOfMonth(min);
  if (+month > +startOfMonth(max)) return startOfMonth(max);
  return month;
}
