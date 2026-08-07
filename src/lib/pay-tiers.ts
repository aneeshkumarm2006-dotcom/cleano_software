// Cleaner payroll tiers and the proportional split-job pay calculation.
//
// This module is PURE (no DB / server imports) so it can be imported from both
// server actions and client components.
//
// THE RATE (awerfixes.pdf item 1, Decision 1, 2026-08-06):
//
//     rate = tier base rate × the cleaner's rating multiplier
//
//   • Tier base rates: Trainee 30%, Standard 40%, Field Lead 46%.
//   • The multiplier is ADMIN-CONFIGURABLE in Settings → Pay Rate Multipliers,
//     one value per 0.1 rating step from 4.0 to 5.0 (see pay-multiplier.ts).
//     It is resolved per cleaner in cleaner-rates.ts from their ALL-TIME
//     average of non-excluded ratings, and arrives here on CleanerRateInput.
//   • Every tier is LOCKED at its bare base rate until the cleaner has at
//     least STANDARD_RATINGS_REQUIRED ratings.
//
//   The PDF's own worked example: Standard 40% × 1.13 = 45.2% → $45.20 on $100.
//
// This REPLACES the hardcoded 40→45% ladder (standardRateForRating, below,
// now deprecated). Running both would pay the rating premium twice.
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
/** Standard's BASE rate. Also its floor — configured multipliers start at 1.00. */
export const STANDARD_FLOOR_RATE = 0.4;

/**
 * @deprecated Retired by Decision 1 (2026-08-06). Standard's ceiling is no
 * longer a constant: it is STANDARD_FLOOR_RATE × the highest multiplier
 * configured in Settings → Pay Rate Multipliers. Kept only so a stale import
 * fails loudly at review. Do not use.
 */
export const STANDARD_MAX_RATE = 0.45;

// Ratings required before ANY multiplier above 1.00 applies — every tier, not
// just Standard (Decision 2). Below this a cleaner earns their bare tier base.
export const STANDARD_RATINGS_REQUIRED = 5;

/**
 * @deprecated Retired by awer_fixes.pdf item 3 — paired jobs no longer share a
 * halved pool. Kept only so any stale import fails loudly at review rather than
 * silently reintroducing the halving. Do not use.
 */
export const SPLIT_POOL_FRACTION = 0.5;

/**
 * Hard ceiling on any ONE cleaner's rate. Not a business policy — a last-resort
 * guard so a malformed multiplier can never pay a cleaner more than the
 * customer paid. Settings validation and sanitizeRatingMultiplierMap keep the
 * worst legal value at 0.46 × 2 = 0.92, so this should never fire.
 */
export const MAX_INDIVIDUAL_RATE = 1;

/**
 * @deprecated Retired by Decision 1 (2026-08-06). The hardcoded 40→45% ladder
 * is REPLACED by the admin-configurable map: `rate = tier base × multiplier`.
 * Running both would pay the rating premium twice. Kept, unused by any pay
 * path, only so a stale import fails loudly at review — same trick as
 * SPLIT_POOL_FRACTION. The one legitimate importer left is
 * scripts/probe-pay-multiplier-delta.ts, which needs it to reproduce the OLD
 * number in its before/after comparison. Do not use.
 */
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
  /**
   * ALL-TIME average of the cleaner's non-excluded ratings (Decision 2); null
   * when they have none. The same window the profile and the pay tier show.
   */
  avgRating: number | null;
  /** Number of non-excluded ratings (drives the 5-rating gate below). */
  ratingCount: number;
  /**
   * The admin-configured rating→pay multiplier this cleaner has earned, read
   * from the `multipliers.ratings` setting. 1 = no premium.
   *
   * REQUIRED on purpose. Optional-with-`?? 1` would let a call site that forgot
   * to supply it compile clean and quietly pay the bare tier base — a money bug
   * that never throws. Resolved once per batch by getCleanerRateInputs(); where
   * a cleaner is MISSING from that map, use fallbackRateInput().
   */
  multiplier: number;
  /**
   * The user's role, when known. Used ONLY to stop an admin/owner who was
   * auto-stamped onto Job.employeeId from being paid as if they worked the job
   * (see jobParticipantIds in cleaner-earnings.ts). Never affects the rate.
   */
  role?: string | null;
}

/**
 * THE rate input for a cleaner missing from getCleanerRateInputs()'s map (a
 * deleted user, a stale id on a legacy row). Deliberately the lowest-risk
 * shape: Standard tier, no ratings, no multiplier — so a lookup miss can only
 * ever UNDER-pay by the base rate, never over-pay.
 *
 * Defined once so the call sites that need a fallback cannot drift apart.
 */
export function fallbackRateInput(id: string): CleanerRateInput {
  return {
    id,
    tier: "STANDARD",
    avgRating: null,
    ratingCount: 0,
    multiplier: 1,
  };
}

/** The tier's base rate, BEFORE the rating multiplier. */
export function tierBaseRate(tier: CleanerTier): number {
  switch (tier) {
    case "TRAINEE":
      return TRAINEE_RATE;
    case "FIELD_LEAD":
      return FIELD_LEAD_RATE;
    case "STANDARD":
    default:
      return STANDARD_FLOOR_RATE;
  }
}

// Rates are money-facing: 4dp is exactly two decimals of a percent (45.20%),
// and it keeps float noise (0.4 * 1.13 = 0.45200000000000007) out of the books.
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * A cleaner's individual pay rate as a fraction of the job price.
 *
 *     rate = tier base rate × rating multiplier      (Decision 1, 2026-08-06)
 *
 * The PDF's worked example: Standard 40% × 1.13 = 45.2% → $45.20 on $100.
 */
export function individualRate(c: CleanerRateInput): number {
  const base = tierBaseRate(c.tier);

  // The 5-rating gate. getCleanerRateInputs() already applies it when it
  // resolves `multiplier`; repeating it here means a hand-built
  // CleanerRateInput can never leak a premium the cleaner has not earned.
  // Belt and braces, because this is money.
  const earned =
    c.avgRating != null && c.ratingCount >= STANDARD_RATINGS_REQUIRED;
  const multiplier =
    earned && Number.isFinite(c.multiplier) ? c.multiplier : 1;

  return Math.min(
    MAX_INDIVIDUAL_RATE,
    Math.max(0, round4(base * multiplier))
  );
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

/** Percent with two decimals, e.g. 0.452 → "45.20%". */
export function formatRatePct(rate: number): string {
  return `${(Math.round(rate * 10000) / 100).toFixed(2)}%`;
}

/**
 * Human-readable rate description for admin UIs, e.g.
 * "40.00% × 1.13 = 45.20% (rating 4.52)" or "46.00% (base — 2/5 ratings)".
 */
export function rateExplanation(c: CleanerRateInput): string {
  const base = tierBaseRate(c.tier);
  if (c.avgRating == null || c.ratingCount < STANDARD_RATINGS_REQUIRED) {
    return `${formatRatePct(base)} (base — ${c.ratingCount}/${STANDARD_RATINGS_REQUIRED} ratings)`;
  }
  return `${formatRatePct(base)} × ${c.multiplier.toFixed(2)} = ${formatRatePct(
    individualRate(c)
  )} (rating ${c.avgRating.toFixed(2)})`;
}
