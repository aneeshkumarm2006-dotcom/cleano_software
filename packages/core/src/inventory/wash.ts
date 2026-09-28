/**
 * Cleano Self-Wash System — projection and credit math.
 *
 *  Projected rags  = 8 + (bedrooms × 4) + (bathrooms × 3) + add-on rag delta
 *  Projected pads  = 1 + add-on pad delta
 *  Credits awarded = projected amounts (the formula is the expected average
 *                    for a job of that size, so no hard cap is applied).
 *                    1 credit per rag, 2 credits per pad.
 *  Per-category reference ranges still exist as a soft signal: when the
 *  projection exceeds the range, `ragsHitCap`/`padsHitCap` is set so admin
 *  can flag the job for review (manager override clears the flag without
 *  changing the credit).
 *  Payouts: 50 rag credits → $3.00, 20 pad credits → $2.00 (paid manually
 *  alongside the cleaner's regular pay, not via Stripe).
 */

export interface ProjectionInput {
  bedCount: number | null | undefined;
  bathCount: number | null | undefined;
  jobType?: string | null;
  addOnNames?: string[]; // case-insensitive substring matched
}

export interface ProjectionResult {
  /** Raw projection from the formula. */
  projectedRags: number;
  projectedPads: number;
  /** Amount credited to the cleaner. Equals the projection (the formula is
   *  itself the expected average), kept under the legacy name so call sites
   *  do not need to change. */
  cappedRags: number;
  cappedPads: number;
  /** Which job category the reference range came from. */
  category: JobCategory;
  /** True when the projection exceeds the per-category reference range.
   *  Used to flag oversize jobs for admin review; the credited amount is
   *  unaffected. */
  ragsHitCap: boolean;
  padsHitCap: boolean;
}

export type JobCategory = "STUDIO" | "ONE_TWO_BR" | "THREE_PLUS_BR" | "MOVE_IN";

interface AddOnRule {
  /** Case-insensitive substring patterns. Any match awards the delta. */
  patterns: string[];
  rags: number;
  pads: number;
}

const BASE_RAGS = 8;
const BASE_PADS = 1;

const ADD_ON_RULES: AddOnRule[] = [
  { patterns: ["oven"], rags: 3, pads: 0 },
  { patterns: ["fridge"], rags: 3, pads: 0 },
  { patterns: ["baseboard"], rags: 2, pads: 1 },
  { patterns: ["shower", "tile"], rags: 3, pads: 1 },
  { patterns: ["wall"], rags: 2, pads: 1 },
  { patterns: ["cabinet"], rags: 2, pads: 0 },
  { patterns: ["move-in", "move in", "movein"], rags: 5, pads: 1 },
  { patterns: ["couch", "upholstery", "sofa"], rags: 1, pads: 0 },
];

/** Per-category reference ranges. The projection is no longer clamped to
 *  these (we credit the formula's output directly), but a projection above
 *  the range raises the review flag. */
const CAPS: Record<JobCategory, { rags: number; pads: number }> = {
  STUDIO: { rags: 20, pads: 2 },
  ONE_TWO_BR: { rags: 30, pads: 3 },
  THREE_PLUS_BR: { rags: 35, pads: 4 },
  MOVE_IN: { rags: 35, pads: 4 },
};

/** Material credit rules (per spec §"Credit and Payout Model"). */
export const CREDIT_PER_RAG = 1;
export const CREDIT_PER_PAD = 2;
export const RAG_PAYOUT_THRESHOLD = 50;
export const PAD_PAYOUT_THRESHOLD = 20;
export const RAG_PAYOUT_AMOUNT = 3.0;
export const PAD_PAYOUT_AMOUNT = 2.0;

/** A job exceeding the projection by ≥10% should be flagged for review. */
export const OVER_PROJECTION_FLAG_PCT = 0.1;

function categorize(bedCount: number, jobType: string | null | undefined): JobCategory {
  const t = (jobType ?? "").toLowerCase();
  if (t.includes("move_in") || t.includes("move-in") || t.includes("move in") || t === "move_out" || t.includes("move_out")) {
    return "MOVE_IN";
  }
  if (bedCount <= 0) return "STUDIO";
  if (bedCount <= 2) return "ONE_TWO_BR";
  return "THREE_PLUS_BR";
}

function matchAddOn(name: string): AddOnRule | null {
  const lower = name.toLowerCase();
  return ADD_ON_RULES.find((r) => r.patterns.some((p) => lower.includes(p))) ?? null;
}

/**
 * Apply the spec formula + cap. Always returns sensible values for missing
 * inputs (treating null bed/bath as 0).
 */
export function projectWashables(input: ProjectionInput): ProjectionResult {
  const bedrooms = Math.max(0, input.bedCount ?? 0);
  const bathrooms = Math.max(0, input.bathCount ?? 0);

  let projectedRags = BASE_RAGS + bedrooms * 4 + bathrooms * 3;
  let projectedPads = BASE_PADS;

  for (const name of input.addOnNames ?? []) {
    const rule = matchAddOn(name);
    if (rule) {
      projectedRags += rule.rags;
      projectedPads += rule.pads;
    }
  }

  const category = categorize(bedrooms, input.jobType);
  const range = CAPS[category];

  // Credit the projection directly. The category range is only used to flag
  // jobs that fall outside the typical envelope so admin can review.
  return {
    projectedRags,
    projectedPads,
    cappedRags: projectedRags,
    cappedPads: projectedPads,
    category,
    ragsHitCap: projectedRags > range.rags,
    padsHitCap: projectedPads > range.pads,
  };
}

/** How many `($amount, ragCreditsConsumed, padCreditsConsumed)` claim units
 *  are available right now given a ledger balance. */
export function availablePayout(rags: number, pads: number) {
  const ragUnits = Math.floor(rags / RAG_PAYOUT_THRESHOLD);
  const padUnits = Math.floor(pads / PAD_PAYOUT_THRESHOLD);
  const ragAmount = ragUnits * RAG_PAYOUT_AMOUNT;
  const padAmount = padUnits * PAD_PAYOUT_AMOUNT;
  return {
    ragUnits,
    padUnits,
    ragCreditsConsumed: ragUnits * RAG_PAYOUT_THRESHOLD,
    padCreditsConsumed: padUnits * PAD_PAYOUT_THRESHOLD,
    amount: ragAmount + padAmount,
  };
}

/** True if actual usage exceeded projection by ≥10%. Spec §"Verification". */
export function isOverProjection(
  actualRags: number | null | undefined,
  projectedRags: number | null | undefined
): boolean {
  if (!actualRags || !projectedRags) return false;
  return actualRags > projectedRags * (1 + OVER_PROJECTION_FLAG_PCT);
}
