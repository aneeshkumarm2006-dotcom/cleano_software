"use server";

import { getBlockedDayClosures } from "@/lib/blocked-dates";

// Public reader for the customer booking flow — whole-day closures with their
// reason, so the date picker can disable them and explain why.
export async function getDateClosures(): Promise<
  { date: string; reason: string | null }[]
> {
  return getBlockedDayClosures();
}
