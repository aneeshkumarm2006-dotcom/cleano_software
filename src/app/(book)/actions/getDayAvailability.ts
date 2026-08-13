"use server";

import { db } from "@/db";
import { getDayClosureRanges, type ClosureRange } from "@/lib/blocked-dates";
import { storeCivilDayRange, storeTimeKey } from "@/lib/timezone";

const MAX_JOBS_PER_SLOT = 2; // a given exact start time is full at this many jobs

export interface DayAvailability {
  /** Admin-blocked time windows on this date. */
  ranges: ClosureRange[];
  /** Exact "HH:MM" start times already at capacity. */
  fullTimes: string[];
}

/**
 * Everything the booking time picker needs to validate an arbitrary chosen
 * time for a date: admin-blocked windows + exact start times at capacity.
 */
export async function getDayAvailability(
  date: string
): Promise<DayAvailability> {
  if (!date) return { ranges: [], fullTimes: [] };

  // `date` is a civil date the customer picked; the window and the "HH:MM"
  // slot labels are both store wall-clock. Parsing it with `new Date()` and
  // reading hours with getHours() used the host clock (UTC), so a 9 AM Montréal
  // job marked 13:00 full and left 09:00 bookable (Q9).
  const { start: dayStart, end: dayEnd } = storeCivilDayRange(date);

  const jobs = await db.job.findMany({
    where: {
      // An archived job doesn't occupy a booking slot (item 1).
      deletedAt: null,
      startTime: { gte: dayStart, lt: dayEnd },
      status: { notIn: ["CANCELLED"] },
      isFlexible: false,
    },
    select: { startTime: true },
  });

  const counts: Record<string, number> = {};
  for (const job of jobs) {
    const slot = storeTimeKey(job.startTime);
    counts[slot] = (counts[slot] ?? 0) + 1;
  }
  const fullTimes = Object.entries(counts)
    .filter(([, count]) => count >= MAX_JOBS_PER_SLOT)
    .map(([slot]) => slot);

  const ranges = await getDayClosureRanges(date);
  return { ranges, fullTimes };
}
