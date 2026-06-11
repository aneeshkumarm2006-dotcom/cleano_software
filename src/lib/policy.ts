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

/** Minutes past start time before the cleaner late-penalty starts applying. */
export const LATE_PENALTY_GRACE_MIN = 10;

/** Star cap once the grace window is exceeded (4 stars max for that job). */
export const LATE_PENALTY_INITIAL_CAP = 4;

/** Additional half-star penalty for each window of this many minutes. */
export const LATE_PENALTY_STEP_MIN = 5;
export const LATE_PENALTY_STEP_STARS = 0.5;

/**
 * Compute the cleaner's maximum possible rating for this job based on how
 * many minutes late they were. Returns null when no cap applies (under the
 * grace window). Floors at 0.5 so the cap stays representable.
 *
 *   <= 10 min late → no cap
 *   10 min        → 4.0
 *   15 min        → 3.5
 *   20 min        → 3.0
 *   ...
 */
export function computeLateArrivalRatingCap(
  minutesLate: number
): number | null {
  if (minutesLate < LATE_PENALTY_GRACE_MIN) return null;
  const stepsBeyond = Math.floor(
    (minutesLate - LATE_PENALTY_GRACE_MIN) / LATE_PENALTY_STEP_MIN
  );
  const cap =
    LATE_PENALTY_INITIAL_CAP - stepsBeyond * LATE_PENALTY_STEP_STARS;
  return Math.max(0.5, cap);
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
