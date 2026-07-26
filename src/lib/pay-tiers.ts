// Cleaner payroll tiers and the proportional split-job pay calculation.
//
// This module is PURE (no DB / server imports) so it can be imported from both
// server actions and client components. It implements the spec in
// software_changes_updated.pdf items 1–6:
//
//   • Trainee individual rate       = 30% of job price
//   • Standard individual rate       = 40%–45% of job price (rating-based; see below)
//   • Field Lead individual rate     = 46% of job price
//
//   • Standard cleaners are LOCKED at 40% until they have at least 5 ratings.
//     After 5 ratings, pay tracks their running rating via STANDARD_RATE_TABLE,
//     with 40% as a hard floor (rating can never drop pay below 40%).
//
//   • EVERY cleaner on the job earns individualRate × jobPrice — solo or paired.
//
// The 50% "split pool" (paired jobs shared half the price, divided
// proportionally by rate) was RETIRED per awer_fixes.pdf item 3, which
// supersedes the earlier spec. Its three worked examples are the acceptance
// test and none of them halve anything:
//
//     $112 at 40%           → $44.80
//     $112 at 45% (5-star)  → $50.40
//     $220 at Tanya's 45%   → $99.00   ("not $55.00 or 25%")
//
// $55.00 is exactly what the old model produced for a 45% cleaner on a paired
// $220 job (half the price, split two ways), which is the number the client
// rejected by name.
//
// CONSEQUENCE, deliberately accepted by the client: a 2-cleaner job now costs
// ~80–90% of the job price in labour rather than 50%. That is a pricing
// decision, not a defect. Item 11's "split evenly between assigned cleaners"
// governs a fixed/custom TOTAL payout (the FLAT / HOURLY path in
// cleaner-earnings.ts), not this percentage model.

export type CleanerTier = "TRAINEE" | "STANDARD" | "FIELD_LEAD";

export const TRAINEE_RATE = 0.3;
export const FIELD_LEAD_RATE = 0.46;
export const STANDARD_FLOOR_RATE = 0.4;
export const STANDARD_MAX_RATE = 0.45;

// Standard pay only starts tracking rating once this many ratings exist.
export const STANDARD_RATINGS_REQUIRED = 5;

/**
 * @deprecated Retired by awer_fixes.pdf item 3 — paired jobs no longer share a
 * halved pool. Kept only so any stale import fails loudly at review rather than
 * silently reintroducing the halving. Do not use.
 */
export const SPLIT_POOL_FRACTION = 0.5;

// Standard rating → rate table (only applied after STANDARD_RATINGS_REQUIRED).
// Bands are inclusive of the low end: 4.0–4.19 → 40%, 4.2–4.39 → 41%, etc.
export function standardRateForRating(avgRating: number): number {
  if (avgRating >= 5.0) return 0.45;
  if (avgRating >= 4.8) return 0.44;
  if (avgRating >= 4.6) return 0.43;
  if (avgRating >= 4.4) return 0.42;
  if (avgRating >= 4.2) return 0.41;
  return STANDARD_FLOOR_RATE; // 4.0–4.19 and anything below → 40% floor
}

export interface CleanerRateInput {
  id: string;
  tier: CleanerTier;
  /** Running average rating; null when the cleaner has no ratings yet. */
  avgRating: number | null;
  /** Number of ratings logged (drives the 5-rating lock for Standard). */
  ratingCount: number;
  /**
   * The user's role, when known. Used ONLY to stop an admin/owner who was
   * auto-stamped onto Job.employeeId from being paid as if they worked the job
   * (see jobParticipantIds in cleaner-earnings.ts). Never affects the rate.
   */
  role?: string | null;
}

// A cleaner's individual pay rate as a fraction of the job price.
export function individualRate(c: CleanerRateInput): number {
  switch (c.tier) {
    case "TRAINEE":
      return TRAINEE_RATE;
    case "FIELD_LEAD":
      return FIELD_LEAD_RATE;
    case "STANDARD":
    default:
      // Locked at the 40% floor until 5 ratings have been logged.
      if (c.ratingCount < STANDARD_RATINGS_REQUIRED || c.avgRating == null) {
        return STANDARD_FLOOR_RATE;
      }
      return standardRateForRating(c.avgRating);
  }
}

export interface PayoutShare {
  id: string;
  /** Individual rate fraction used for this cleaner. */
  rate: number;
  /** Dollar payout for this cleaner. */
  amount: number;
}

export interface JobPayout {
  /** Total cleaner cost of the job — the sum of every cleaner's share. */
  pool: number;
  /** True when 2+ cleaners are on the job. Each is still paid their full rate. */
  isSplit: boolean;
  shares: PayoutShare[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Core calculation: given the job price and the assigned cleaners, return each
// cleaner's payout. Tips and multipliers are handled separately by callers.
export function computeJobPayout(
  price: number | null | undefined,
  cleaners: CleanerRateInput[]
): JobPayout {
  const valid = cleaners.filter((c): c is CleanerRateInput => !!c && !!c.id);
  const p = price ?? 0;

  if (valid.length === 0) {
    return { pool: 0, isSplit: false, shares: [] };
  }

  // Every cleaner earns their own rate on the FULL job price, whether they are
  // working alone or paired. No halving, no proportional redistribution — see
  // the worked examples in the module header (awer_fixes.pdf item 3).
  const base = Math.max(0, p);
  const shares: PayoutShare[] = valid.map((c) => {
    const rate = individualRate(c);
    return { id: c.id, rate, amount: round2(base * rate) };
  });

  return {
    pool: round2(shares.reduce((sum, s) => sum + s.amount, 0)),
    isSplit: valid.length > 1,
    shares,
  };
}

export const TIER_LABEL: Record<CleanerTier, string> = {
  TRAINEE: "Trainee",
  STANDARD: "Standard",
  FIELD_LEAD: "Field Lead",
};

// Human-readable rate description for admin UIs (e.g. "40% (locked — 2/5 ratings)").
export function rateExplanation(c: CleanerRateInput): string {
  const rate = individualRate(c);
  const pct = `${Math.round(rate * 100)}%`;
  if (c.tier === "STANDARD") {
    if (c.ratingCount < STANDARD_RATINGS_REQUIRED || c.avgRating == null) {
      return `${pct} (locked — ${c.ratingCount}/${STANDARD_RATINGS_REQUIRED} ratings)`;
    }
    return `${pct} (rating ${c.avgRating.toFixed(2)})`;
  }
  return pct;
}
