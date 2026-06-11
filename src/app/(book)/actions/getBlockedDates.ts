"use server";

import { getBlockedDates as readBlockedDates } from "@/lib/blocked-dates";

// Public reader for the customer booking flow — exposes the admin-configured
// closed dates so the date picker can grey them out.
export async function getBlockedDates(): Promise<string[]> {
  return readBlockedDates();
}
