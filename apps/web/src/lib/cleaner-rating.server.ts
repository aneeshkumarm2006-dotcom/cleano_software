// Server-side companion to `cleaner-rating.ts` — the single query behind every
// rating a cleaner is shown. See that file for why one definition exists at all.

import { db } from "@/lib/org-db";
import { summarizeRatings, type CleanerRatingSummary } from "@/lib/cleaner-rating";

/**
 * The cleaner's running rating: average + how many ratings it is built from.
 *
 * The window matches the one payroll already uses (see `getCleanerRateInputs`,
 * Decision 2, 2026-08-06): ALL TIME, `excludedAt: null`. Admin-excluded ratings
 * — one left on a test job, a mis-tap, a complaint the office resolved in the
 * cleaner's favour (AwerNewFixes.pdf item 5) — stay in the table for review but
 * drop out of the average AND out of the count. A cleaner therefore sees the
 * same number their pay multiplier is computed from.
 *
 * No ratings yields `average: null`, never a default star count: the page has
 * to say "No reviews yet" rather than print a score nobody gave.
 */
export async function getCleanerRatingSummary(
  employeeId: string
): Promise<CleanerRatingSummary> {
  const agg = await db.employeeRating.aggregate({
    where: { employeeId, excludedAt: null },
    _avg: { rating: true },
    _count: { rating: true },
  });

  return summarizeRatings(agg._avg.rating, agg._count.rating ?? 0);
}
