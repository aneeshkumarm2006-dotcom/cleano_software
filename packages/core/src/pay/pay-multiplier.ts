// Pay multipliers are configured per 0.1 rating step across the 4.0–5.0 scale.
// This module is pure (no DB / server imports) so it is safe to import from
// client components. The configured values are loaded server-side via
// getRatingMultiplierMap() in pay-multiplier-config.ts.

export type RatingMultiplierMap = Record<string, number>;

// Bounds on a configured multiplier. 1.00 is "no change" — the cleaner earns
// their bare tier base rate — so anything below it is a pay CUT relative to the
// tier, and anything above is a premium. The ceiling blocks the classic typo
// (113 for 1.13) from turning into a payroll incident.
export const MIN_RATING_MULTIPLIER = 0.5;
export const MAX_RATING_MULTIPLIER = 2;

// Every 0.1 step from 4.0 to 5.0, lowest to highest.
export const RATING_STEPS: string[] = Array.from({ length: 11 }, (_, i) =>
  (4 + i * 0.1).toFixed(1)
);

// Sensible default ramp from 1.00x at 4.0 up to 1.25x at 5.0. Admins can edit
// these in Settings → Pay Rate Multipliers.
export const DEFAULT_RATING_MULTIPLIERS: RatingMultiplierMap = {
  "4.0": 1.0,
  "4.1": 1.03,
  "4.2": 1.05,
  "4.3": 1.08,
  "4.4": 1.1,
  "4.5": 1.13,
  "4.6": 1.15,
  "4.7": 1.18,
  "4.8": 1.2,
  "4.9": 1.23,
  "5.0": 1.25,
};

// Floors an average rating to its 0.1 step within the 4.0–5.0 band.
export function ratingStepFor(avg: number): string {
  const clamped = Math.min(5, Math.max(4, avg));
  return (Math.floor(clamped * 10) / 10).toFixed(1);
}

export function multiplierForRating(
  avg: number,
  map: RatingMultiplierMap = DEFAULT_RATING_MULTIPLIERS
): { multiplier: number; label: string } {
  const step = ratingStepFor(avg);
  const multiplier = map[step] ?? DEFAULT_RATING_MULTIPLIERS[step] ?? 1;
  return { multiplier, label: step };
}

// Ratings required before ANY multiplier above 1.00 applies. Mirrors
// STANDARD_RATINGS_REQUIRED in pay-tiers.ts, redeclared here so this module
// stays free of that import and can be used from the settings UI.
export const RATINGS_REQUIRED_FOR_MULTIPLIER = 5;

/**
 * THE gate: a cleaner's effective multiplier, or 1 when they have not earned
 * one yet.
 *
 * The gate applies to EVERY tier, not just Standard — otherwise a brand-new
 * Field Lead with a single 5-star rating would jump straight to 46% x 1.25 =
 * 57.5%. Below the threshold a cleaner is paid their bare tier base rate.
 *
 * Pure, so the pay calculation, the display cache and the verify script can all
 * apply the same rule without a database.
 */
export function effectiveMultiplier(
  avgRating: number | null | undefined,
  ratingCount: number,
  map: RatingMultiplierMap = DEFAULT_RATING_MULTIPLIERS,
  ratingsRequired: number = RATINGS_REQUIRED_FOR_MULTIPLIER
): number {
  if (avgRating == null || ratingCount < ratingsRequired) return 1;
  return multiplierForRating(avgRating, map).multiplier;
}
