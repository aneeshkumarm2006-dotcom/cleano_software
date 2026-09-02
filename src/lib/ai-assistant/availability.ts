// What the assistant may say about openings: real, day-level availability
// computed fresh per reply from the same sources the booking page enforces
// (whole-day closures + the minimum lead time). Day-level on purpose — the
// booking page owns exact times, and an assistant promising "2 PM Tuesday"
// that a concurrent booking then takes would be worse than not answering.
import "server-only";

import { getSetting } from "@/lib/settings";
import { getBlockedDates } from "@/lib/blocked-dates";
import { STORE_TZ } from "@/lib/timezone";

const HORIZON_DAYS = 14;
const MAX_LISTED = 8;

/**
 * A short prompt section naming the next open booking days, or "" when it
 * cannot be computed (the assistant then simply doesn't discuss availability).
 */
export async function buildAvailabilitySummary(): Promise<string> {
  try {
    const [minLeadDays, blocked] = await Promise.all([
      getSetting("scheduling.minLeadDays"),
      getBlockedDates(),
    ]);
    const blockedSet = new Set(blocked);

    const dayKey = new Intl.DateTimeFormat("en-CA", {
      timeZone: STORE_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const dayLabel = new Intl.DateTimeFormat("en-CA", {
      timeZone: STORE_TZ,
      weekday: "long",
      month: "long",
      day: "numeric",
    });

    const open: string[] = [];
    const first = Math.max(0, Number(minLeadDays) || 0);
    for (let i = first; i < first + HORIZON_DAYS && open.length < MAX_LISTED; i++) {
      const d = new Date(Date.now() + i * 24 * 60 * 60 * 1000);
      if (!blockedSet.has(dayKey.format(d))) open.push(dayLabel.format(d));
    }
    if (open.length === 0) return "";

    return [
      `Days currently open for booking (times are chosen on the booking page, between 9:00 and 19:00):`,
      ...open.map((d) => `- ${d}`),
      minLeadDays > 0
        ? `Bookings need at least ${minLeadDays} day(s) of notice, which is already reflected above.`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  } catch {
    return "";
  }
}
