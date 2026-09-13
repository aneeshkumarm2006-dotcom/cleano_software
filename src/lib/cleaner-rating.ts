// THE one definition of "this cleaner's rating", as a pure module.
//
// WHY THIS FILE EXISTS
//
// The same cleaner used to read a different score depending on which page they
// opened. /cleaners/dashboard averaged its own `take: 30` slice of the ratings
// table and printed that capped length as "Based on N reviews"; /cleaners/my-pay
// ran a second, separate query and then floored the result at 4.0 in the markup
// — Math.max(4, …) — so a cleaner whose real average was 1.0 was told "Your
// Rating: 4.0 / 5.0" on one page and "1.0 / 5 — Based on 2 reviews" on the
// other. Two queries, two roundings, two no-reviews answers, one cleaner.
//
// Now every surface reads the number from `getCleanerRatingSummary`
// (cleaner-rating.server.ts) and formats it with the helpers here, so a third
// page cannot invent a fourth answer.
//
// Keep this module free of the db — it is imported by client components. The
// query lives in the `.server.ts` companion (same split as
// inventory-thresholds).

import { RATING_MIN, RATING_MAX } from "@/lib/policy";

export interface CleanerRatingSummary {
  /**
   * Average of every counted rating, clamped to the 1.0–5.0 scale and rounded
   * to a tenth so every page prints the identical digits.
   *
   * null means NO reviews exist. Render that as "No reviews yet" — never as a
   * number, and never as a flattering default: a made-up score on the cleaner's
   * own page is the thing this module exists to prevent.
   */
  average: number | null;
  /** How many ratings the average is built from. 0 when there are none. */
  count: number;
}

/** What a cleaner with nothing rated yet looks like. */
export const EMPTY_RATING_SUMMARY: CleanerRatingSummary = {
  average: null,
  count: 0,
};

/**
 * Turn a raw average + count into the summary every page displays. Split out
 * from the query so the rounding rule has exactly one home.
 */
export function summarizeRatings(
  avg: number | null | undefined,
  count: number
): CleanerRatingSummary {
  if (count <= 0 || avg == null) return EMPTY_RATING_SUMMARY;
  return {
    average:
      Math.round(Math.min(RATING_MAX, Math.max(RATING_MIN, avg)) * 10) / 10,
    count,
  };
}

/** "Based on 4 reviews" / "Based on 1 review" / "No reviews yet". */
export function ratingCountLabel(count: number): string {
  if (count <= 0) return "No reviews yet";
  return `Based on ${count} review${count === 1 ? "" : "s"}`;
}
