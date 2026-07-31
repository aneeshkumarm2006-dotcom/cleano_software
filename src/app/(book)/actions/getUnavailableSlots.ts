"use server";

import { db } from "@/db";
import { getBlockedSlots } from "@/lib/blocked-dates";

const MAX_JOBS_PER_SLOT = 2; // grey out a slot once this many jobs are booked

export async function getUnavailableSlots(date: string): Promise<string[]> {
  if (!date) return [];

  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd = new Date(`${date}T23:59:59`);

  const jobs = await db.job.findMany({
    where: {
      // An archived job doesn't occupy a booking slot (item 1).
      deletedAt: null,
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

  const fullSlots = Object.entries(counts)
    .filter(([, count]) => count >= MAX_JOBS_PER_SLOT)
    .map(([slot]) => slot);

  // Merge in admin-blocked time slots for this date.
  const blocked = await getBlockedSlots(date);
  return Array.from(new Set([...fullSlots, ...blocked]));
}
