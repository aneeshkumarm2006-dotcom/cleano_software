import { db } from "@/lib/org-db";
import {
  DEFAULT_RATING_MULTIPLIERS,
  MAX_RATING_MULTIPLIER,
  MIN_RATING_MULTIPLIER,
  RATING_STEPS,
  type RatingMultiplierMap,
} from "./pay-multiplier";

export const RATING_MULTIPLIER_SETTING_KEY = "multipliers.ratings";

/**
 * Coerces a stored map into something safe to multiply money by.
 *
 * This matters because the map DRIVES PAY now (AWER round 3, fix 1): a cleaner's
 * rate is `tier base x multiplier`. Before that, the map was display-only, and
 * the Settings tab used to persist `0` for any box the admin cleared — so the
 * live row may legitimately contain zeros that would pay an entire rating band
 * $0.00. Any value that is not a finite number inside
 * [MIN_RATING_MULTIPLIER, MAX_RATING_MULTIPLIER] falls back to that step's
 * default rather than being trusted.
 *
 * Unknown keys are dropped: only the 0.1 steps from 4.0 to 5.0 are meaningful,
 * and `ratingStepFor` can never produce anything else.
 */
export function sanitizeRatingMultiplierMap(
  value: unknown
): RatingMultiplierMap {
  const out: RatingMultiplierMap = { ...DEFAULT_RATING_MULTIPLIERS };
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;

  const raw = value as Record<string, unknown>;
  for (const step of RATING_STEPS) {
    if (!(step in raw)) continue;
    const n = typeof raw[step] === "number" ? raw[step] : Number(raw[step]);
    if (!Number.isFinite(n)) continue;
    if (n < MIN_RATING_MULTIPLIER || n > MAX_RATING_MULTIPLIER) continue;
    out[step] = n;
  }
  return out;
}

// Loads the admin-configured rating→multiplier map, falling back to defaults
// for any step that isn't set or isn't a usable number. Server-only (touches
// the DB).
export async function getRatingMultiplierMap(): Promise<RatingMultiplierMap> {
  const setting = await db.appSetting.findUnique({
    where: { key: RATING_MULTIPLIER_SETTING_KEY },
  });

  return sanitizeRatingMultiplierMap(setting?.value);
}
