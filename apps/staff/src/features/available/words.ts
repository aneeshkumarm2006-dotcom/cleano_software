// How an available job reads to a cleaner deciding whether to take it: short,
// and honest about what isn't known yet.
import type { AvailableJobSummary } from "@bookmops/api/v1";

import { duration, formatMoney, localDateKey, shortDate } from "@/lib/format";

/** "$96.00", "$24.00/h", or null when the office sets it per assignment. */
export function payText(pay: AvailableJobSummary["pay"], currency: string): string | null {
  if (pay.type === "HOURLY" && pay.hourlyRateCents != null) return `${formatMoney(pay.hourlyRateCents, currency)}/h`;
  if (pay.estimateCents != null) return formatMoney(pay.estimateCents, currency);
  return null;
}

/** The job's scheduled length in ms, or null when there's no end yet. */
export function lengthMs(job: Pick<AvailableJobSummary, "startsAt" | "endsAt">): number | null {
  if (!job.endsAt) return null;
  const ms = new Date(job.endsAt).getTime() - new Date(job.startsAt).getTime();
  return ms > 0 ? ms : null;
}

/** "3 h", or "Length TBC" when the office hasn't set an end. */
export function lengthText(job: Pick<AvailableJobSummary, "startsAt" | "endsAt">): string {
  const ms = lengthMs(job);
  return ms ? duration(ms) : "Length TBC";
}

/** "Condo · 3 bed · 2 bath", leaving out whatever wasn't recorded. */
export function propertyText(p: { type: string | null; beds: number | null; baths: number | null }): string {
  return [p.type, p.beds != null ? `${p.beds} bed` : null, p.baths != null ? `${p.baths} bath` : null]
    .filter(Boolean)
    .join(" · ");
}

/** "1 of 2 spots left". */
export function spotsText(crew: AvailableJobSummary["crew"]): string {
  const left = Math.max(0, crew.required - crew.claimed);
  return crew.required <= 1 ? "Solo job" : `${left} of ${crew.required} spots left`;
}

/** "Today", "Tomorrow", or "Thu 24 Sep", by the company's calendar. */
export function dayLabel(iso: string, timeZone: string, now: Date): string {
  const key = localDateKey(iso, timeZone);
  if (key === localDateKey(now.toISOString(), timeZone)) return "Today";
  if (key === localDateKey(new Date(now.getTime() + 86_400_000).toISOString(), timeZone)) return "Tomorrow";
  return shortDate(iso, timeZone);
}

/** Within this long of the start, a job gets the "starts in" cue. */
export const SOON_MS = 12 * 3_600_000;

/** "Starts in 3 h", when it's soon; otherwise null. */
export function soonText(startsAt: string, now: Date): string | null {
  const ms = new Date(startsAt).getTime() - now.getTime();
  return ms > 0 && ms <= SOON_MS ? `Starts in ${duration(ms)}` : null;
}
