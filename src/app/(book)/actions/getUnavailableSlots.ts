"use server";

import { db } from "@/db";
import { getBlockedSlots } from "@/lib/blocked-dates";
import { storeCivilDayRange, storeTimeKey } from "@/lib/timezone";

const MAX_JOBS_PER_SLOT = 2; // grey out a slot once this many jobs are booked

export async function getUnavailableSlots(date: string): Promise<string[]> {
  if (!date) return [];

  // `date` is a civil date the customer picked; the window and the slot labels
  // are both store wall-clock. Parsing it with `new Date()` and reading hours
  // with getHours() used the host clock (UTC), so a 9 AM Montréal job greyed
  // out the 13:00 slot and left 09:00 bookable (Q9).
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

  const fullSlots = Object.entries(counts)
    .filter(([, count]) => count >= MAX_JOBS_PER_SLOT)
    .map(([slot]) => slot);

  // Merge in admin-blocked time slots for this date.
  const blocked = await getBlockedSlots(date);
  return Array.from(new Set([...fullSlots, ...blocked]));
}
