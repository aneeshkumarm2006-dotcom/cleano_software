/**
 * Cleano policy constants confirmed with the client.
 * Keeping these in one place so admin can change them later without hunting
 * through the codebase.
 */

/** Trigger the "cleaner on the way" notification when ETA drops below this. */
export const ON_THE_WAY_ETA_MIN = 15;

/** A newly assigned cleaner has this many minutes to accept or decline before
 *  the job is auto-released back to the unassigned folder. */
export const ACCEPT_DECLINE_TIMEOUT_MIN = 10;

/** No-show penalty charged to the customer when the cleaner reports a no-show. */
export const NO_SHOW_FEE_USD = 25;

/** Fee charged to the customer when they cancel inside the late-cancellation
 *  window below. */
export const CANCELLATION_FEE_USD = 20;

/** Hours before the booking start time inside which a cancellation incurs the
 *  late-cancellation fee. */
export const CANCELLATION_FEE_WINDOW_HOURS = 48;

/** Auto-rating posted on the cleaner's job when the customer is a no-show. */
export const NO_SHOW_AUTO_STAR = 1;

/** Minutes past start time before the cleaner late-penalty starts applying.
 *  Spec: penalty applies when a cleaner is MORE THAN 15 minutes late. */
export const LATE_PENALTY_GRACE_MIN = 15;

/** Stars deducted from the job's customer rating for a late arrival (flat). */
export const LATE_ARRIVAL_RATING_PENALTY = 0.5;

/** Lowest a rating can be reduced to by the late-arrival penalty. */
export const LATE_ARRIVAL_RATING_FLOOR = 0.5;

/** Default running rating shown for a cleaner who has zero ratings logged.
 *  Pay stays locked at the 40% floor until 5 ratings exist (see pay-tiers.ts),
 *  so this default is display-only and does not inflate pay. */
export const DEFAULT_STARTING_RATING = 5.0;

/** Rating is bounded between this floor and RATING_MAX. */
export const RATING_MIN = 1.0;
export const RATING_MAX = 5.0;

/**
 * Stars to deduct from this job's rating for a late arrival. Returns a flat
 * penalty once the grace window is exceeded, otherwise null (no penalty).
 *
 *   <= 15 min late → no penalty
 *   >  15 min late → −0.5 stars
 */
export function computeLateArrivalPenalty(
  minutesLate: number
): number | null {
  if (minutesLate <= LATE_PENALTY_GRACE_MIN) return null;
  return LATE_ARRIVAL_RATING_PENALTY;
}

/** Apply the late-arrival penalty to a customer's given stars. */
export function applyLateArrivalPenalty(
  stars: number,
  penalty: number | null | undefined
): number {
  if (!penalty) return stars;
  return Math.max(LATE_ARRIVAL_RATING_FLOOR, stars - penalty);
}

/** Bonus paid to whichever cleaner claims a last-minute reassigned job. */
export const LAST_MINUTE_CLAIM_BONUS_USD = 10;

/** Rating threshold below which the "we want to make it right" follow-up
 *  email + admin alert are triggered. */
export const POOR_RATING_FOLLOWUP_STARS = 1;

/** Default low-stock threshold applied to a product if none is set. */
export const DEFAULT_INVENTORY_LOW_STOCK = 10;

/** Current version of the after-photo consent wording. Bump when the text
 *  below changes so we can tell which wording a customer agreed to. */
export const AFTER_PHOTO_CONSENT_VERSION = "v1";

/** Exact wording shown on the booking page for after-photo consent. */
export const AFTER_PHOTO_CONSENT_TEXT =
  "I consent to Cleano cleaners taking after photos of the cleaned areas for quality control after my service is complete.";
