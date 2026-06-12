"use server";

import { db } from "@/db";
import { getDayClosureRanges, type ClosureRange } from "@/lib/blocked-dates";

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

  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd = new Date(`${date}T23:59:59`);

  const jobs = await db.job.findMany({
    where: {
      startTime: { gte: dayStart, lte: dayEnd },
      status: { notIn: ["CANCELLED"] },
      isFlexible: false,
    },
    select: { startTime: true },
  });

  const counts: Record<string, number> = {};
  for (const job of jobs) {
    const h = String(job.startTime.getHours()).padStart(2, "0");
    const m = String(job.startTime.getMinutes()).padStart(2, "0");
    const slot = `${h}:${m}`;
    counts[slot] = (counts[slot] ?? 0) + 1;
  }
  const fullTimes = Object.entries(counts)
    .filter(([, count]) => count >= MAX_JOBS_PER_SLOT)
    .map(([slot]) => slot);

  const ranges = await getDayClosureRanges(date);
  return { ranges, fullTimes };
}
