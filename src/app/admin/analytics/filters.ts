// Analytics page filters (item 11 · Q7).
//
// Before this, `AnalyticsPage()` took no searchParams at all: it fired 14
// unfiltered queries, derived every metric server-side and handed the view 19
// finished props. So this is not "add a dropdown" — it is giving the page a
// filter concept it never had, and the industry control and the date range ride
// on the same plumbing because they land in exactly the same place.
//
// Kept free of server-only imports so it can be exercised directly by a test
// and read from a client component if one ever needs the same predicate.

import { jobMatchesIndustry, parseIndustryFilter } from "@/lib/calendar-labels";
import type { IndustryFilter } from "@/lib/calendar-labels";
import { storeCivilDayRange } from "@/lib/timezone";

export interface AnalyticsFilterState {
  industry: IndustryFilter;
  /** Civil dates ("2026-08-01") exactly as the pickers hold them, or null. */
  from: string | null;
  to: string | null;
  /** Instants bounding the civil range in STORE_TZ, `[rangeFrom, rangeTo)`. */
  rangeFrom: Date | null;
  rangeTo: Date | null;
  hasDateRange: boolean;
  isFiltered: boolean;
}

/** Any job row the predicate can read. Prisma rows and DTOs both satisfy it. */
export interface FilterableJob {
  jobType: string | null;
  startTime: Date;
}

/** First value of a possibly-repeated query param. */
export function oneParam(
  v: string | string[] | undefined
): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Accept only a civil date the store-timezone helpers can read. */
export function civilDateParam(v: string | undefined): string | null {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/**
 * Parse `?industry=&from=&to=` into the page's filter state.
 *
 * Range boundaries are STORE_TZ civil days (Stage 2): `new Date("2026-08-01")`
 * is UTC midnight, which is 8 PM on July 31 in Montréal, so a naive parse would
 * put the window four hours out from the dates on screen — the same bug Stage 2
 * found in the Payments tab. `rangeTo` is the NEXT store midnight, so the
 * comparison stays half-open and the last day is whole.
 */
export function parseAnalyticsFilters(params: {
  [key: string]: string | string[] | undefined;
}): AnalyticsFilterState {
  const industry = parseIndustryFilter(oneParam(params.industry));
  let from = civilDateParam(oneParam(params.from));
  let to = civilDateParam(oneParam(params.to));
  // A backwards range is a slip, not an intent to see nothing.
  if (from && to && from > to) [from, to] = [to, from];

  const rangeFrom = from ? storeCivilDayRange(from).start : null;
  const rangeTo = to ? storeCivilDayRange(to).end : null;
  const hasDateRange = Boolean(rangeFrom || rangeTo);

  return {
    industry,
    from,
    to,
    rangeFrom,
    rangeTo,
    hasDateRange,
    isFiltered: industry !== "ALL" || hasDateRange,
  };
}

/** Does this job fall inside the date range, ignoring industry? */
export function jobInDateRange(
  job: FilterableJob,
  f: Pick<AnalyticsFilterState, "rangeFrom" | "rangeTo">
): boolean {
  if (f.rangeFrom && job.startTime < f.rangeFrom) return false;
  if (f.rangeTo && job.startTime >= f.rangeTo) return false;
  return true;
}

/**
 * The one filter predicate. Date basis is `startTime` — the same basis
 * `revenueWhere()` uses in metrics.ts, so a given range yields the same number
 * here as it does on the Dashboard.
 */
export function jobMatchesAnalyticsFilter(
  job: FilterableJob,
  f: AnalyticsFilterState
): boolean {
  return jobMatchesIndustry(job.jobType, f.industry) && jobInDateRange(job, f);
}
