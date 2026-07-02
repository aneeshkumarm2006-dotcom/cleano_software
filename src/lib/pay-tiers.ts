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
//   • Solo job (1 cleaner): payout = individualRate × jobPrice.
//   • Split job (2+ cleaners): the combined pay pool = 50% of jobPrice, divided
//     PROPORTIONALLY by each cleaner's individual rate — NOT an even split.
//         share_i = (rate_i / Σ rate) × pool
//
// Worked example from the spec: $196 job, pool = $98.
//   Trainee (0.30) + Field Lead (0.46) → combined 0.76
//   Field Lead payout = 0.46/0.76 × $98 = $59.32
//   Trainee    payout = 0.30/0.76 × $98 = $38.68

export type CleanerTier = "TRAINEE" | "STANDARD" | "FIELD_LEAD";

export const TRAINEE_RATE = 0.3;
export const FIELD_LEAD_RATE = 0.46;
export const STANDARD_FLOOR_RATE = 0.4;
export const STANDARD_MAX_RATE = 0.45;

// Standard pay only starts tracking rating once this many ratings exist.
export const STANDARD_RATINGS_REQUIRED = 5;

// Fraction of the job price that forms the combined pool on a split (2+) job.
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
  /** Total cleaner pay pool for the job (sum of shares). */
  pool: number;
  /** True when 2+ cleaners share the 50% pool. */
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

  // Solo job: individual rate applied directly to the full price.
  if (valid.length === 1) {
    const rate = individualRate(valid[0]);
    const amount = round2(Math.max(0, p) * rate);
    return { pool: amount, isSplit: false, shares: [{ id: valid[0].id, rate, amount }] };
  }

  // Split job: pool = 50% of price, divided proportionally by individual rate.
  const pool = Math.max(0, p) * SPLIT_POOL_FRACTION;
  const rates = valid.map(individualRate);
  const combined = rates.reduce((s, r) => s + r, 0);

  const shares: PayoutShare[] = valid.map((c, i) => ({
    id: c.id,
    rate: rates[i],
    amount:
      combined > 0
        ? round2(pool * (rates[i] / combined))
        : round2(pool / valid.length),
  }));

  return { pool: round2(pool), isSplit: true, shares };
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
