import { db } from "@/lib/org-db";
import { TIME_SLOTS } from "@/app/(book)/book/types";

// AppSetting key holding the admin-configured booking closures.
// Current shape: { closures: Closure[] }
// Legacy shape (still read): { dates: string[]; slots: { date; times[] }[] }
export const BLOCKED_DATES_KEY = "booking.blockedDates";

export interface Closure {
  id: string;
  date: string; // "YYYY-MM-DD"
  allDay: boolean;
  start: string | null; // "HH:MM" when !allDay
  end: string | null; // "HH:MM" when !allDay
  reason: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HH_MM = /^\d{2}:\d{2}$/;

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function normClosure(raw: unknown): Closure | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const date = str(r.date);
  if (!date || !ISO_DATE.test(date)) return null;
  const allDay = r.allDay === true;
  const start = str(r.start) && HH_MM.test(str(r.start)!) ? (r.start as string) : null;
  const end = str(r.end) && HH_MM.test(str(r.end)!) ? (r.end as string) : null;
  const reasonRaw = str(r.reason);
  const reason = reasonRaw && reasonRaw.trim() ? reasonRaw.trim() : null;
  if (!allDay && (!start || !end)) return null; // a range closure needs both ends
  const id = str(r.id) || `${date}-${allDay ? "all" : `${start}-${end}`}`;
  return { id, date, allDay, start, end, reason };
}

/** True when a fixed booking slot ("HH:MM") falls inside a closure's range. */
function slotInRange(slot: string, start: string, end: string): boolean {
  if (start === end) return slot === start; // legacy single-slot closure
  return slot >= start && slot < end; // [start, end)
}

/**
 * Reads and normalizes all closures, tolerating the legacy `{ dates, slots }`
 * shape (whole-day dates → allDay closures, discrete slots → single-slot ranges).
 */
export async function getClosures(): Promise<Closure[]> {
  try {
    const setting = await db.appSetting.findUnique({
      where: { key: BLOCKED_DATES_KEY },
    });
    const v = setting?.value as Record<string, unknown> | null;
    if (!v) return [];

    if (Array.isArray(v.closures)) {
      return v.closures
        .map(normClosure)
        .filter((c): c is Closure => c !== null);
    }

    // Legacy fallback
    const out: Closure[] = [];
    if (Array.isArray(v.dates)) {
      for (const d of v.dates) {
        if (typeof d === "string" && ISO_DATE.test(d)) {
          out.push({ id: `${d}-all`, date: d, allDay: true, start: null, end: null, reason: null });
        }
      }
    }
    if (Array.isArray(v.slots)) {
      for (const s of v.slots) {
        if (!s || typeof s !== "object") continue;
        const r = s as { date?: unknown; times?: unknown };
        const date = str(r.date);
        if (!date || !ISO_DATE.test(date)) continue;
        const times = Array.isArray(r.times)
          ? r.times.filter((t): t is string => typeof t === "string" && HH_MM.test(t))
          : [];
        for (const t of times) {
          out.push({ id: `${date}-${t}`, date, allDay: false, start: t, end: t, reason: null });
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Whole-day closures ("YYYY-MM-DD") — the date is disabled entirely. */
export async function getBlockedDates(): Promise<string[]> {
  const closures = await getClosures();
  return Array.from(
    new Set(closures.filter((c) => c.allDay).map((c) => c.date))
  );
}

/**
 * Whole-day closures with their reason, for surfacing to the customer when they
 * try to pick a closed day. One entry per date (prefers a closure that has a
 * reason if several exist for the same date).
 */
export async function getBlockedDayClosures(): Promise<
  { date: string; reason: string | null }[]
> {
  const closures = await getClosures();
  const map = new Map<string, string | null>();
  for (const c of closures) {
    if (!c.allDay) continue;
    if (!map.has(c.date) || (!map.get(c.date) && c.reason)) {
      map.set(c.date, c.reason);
    }
  }
  return [...map.entries()].map(([date, reason]) => ({ date, reason }));
}

export interface ClosureRange {
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  reason: string | null;
}

/**
 * Time-range closures for a specific date (non-whole-day). Used by the booking
 * time picker to grey out / reject arbitrary times that fall inside a blocked
 * window. Whole-day closures are handled separately (they disable the date).
 */
export async function getDayClosureRanges(
  date: string
): Promise<ClosureRange[]> {
  if (!date) return [];
  const closures = await getClosures();
  return closures
    .filter((c) => c.date === date && !c.allDay && c.start && c.end)
    .map((c) => ({ start: c.start!, end: c.end!, reason: c.reason }));
}

/**
 * True when an arbitrary "HH:MM" time falls inside any range closure on `date`.
 * Range-aware (unlike getBlockedSlots, which only tests the legacy fixed slots),
 * so it correctly validates a customer-chosen time like "10:24".
 */
export async function isTimeBlocked(
  date: string,
  time: string
): Promise<{ blocked: boolean; reason: string | null }> {
  for (const r of await getDayClosureRanges(date)) {
    if (slotInRange(time, r.start, r.end)) {
      return { blocked: true, reason: r.reason };
    }
  }
  return { blocked: false, reason: null };
}

/**
 * Fixed booking slots ("HH:MM") blocked for a specific date — any TIME_SLOTS
 * that fall inside a range closure on that date. Whole-day closures are handled
 * separately (they disable the date outright).
 */
export async function getBlockedSlots(date: string): Promise<string[]> {
  if (!date) return [];
  const closures = await getClosures();
  const blocked = new Set<string>();
  for (const c of closures) {
    if (c.date !== date || c.allDay || !c.start || !c.end) continue;
    for (const slot of TIME_SLOTS) {
      if (slotInRange(slot, c.start, c.end)) blocked.add(slot);
    }
  }
  return [...blocked];
}
