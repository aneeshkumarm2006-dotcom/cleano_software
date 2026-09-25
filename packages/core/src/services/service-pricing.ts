// Per-service-type pricing formulas. Pure (no DB) so both the server pricing
// path and any client estimate can share them. Rate values are configurable in
// Settings → Pricing Rules and read server-side; these are the fallbacks.

export const SERVICE_PRICING_KEY = "pricing.serviceTypes";

export interface ServicePricingConfig {
  // Move-in / move-out: charged per square foot, with a cheaper rate once the
  // home is large enough.
  moveInOut: {
    thresholdSqft: number; // at/above this sqft, use rateAtOrAbove
    rateAtOrAbove: number; // $/sqft for large homes (default 0.25)
    rateBelow: number; // $/sqft for smaller homes (default 0.28)
  };
  // Post-construction: straight hourly, per cleaner, with an enforced minimum
  // number of billable hours. price = max(minHours, hours) × hourlyRate ×
  // cleaners.
  postConstruction: {
    hourlyRate: number; // default $50/hr per cleaner
    minHours: number; // default 4 (minimum billable hours)
  };
  // Minimum base price a CUSTOMER booking can be quoted (item 9). Clients can
  // never be quoted below this; admins can still price a job manually below it.
  minJobPrice: number; // default $119
  // Recurring frequency discounts, configurable PER SERVICE CATEGORY (item 7),
  // BookingKoala-style. Keyed by normalized category → frequency → percent.
  // First cleaning is always full price; the discount applies to the 2nd+
  // recurring visits. A category with 0 for a frequency = no discount there
  // (e.g. weekly with no discount).
  frequencyDiscounts: Record<string, Record<string, number>>;
}

export const FREQ_DISCOUNT_KEYS = [
  // DAILY is admin-recurring only (awer_fixes.pdf item 9). Distinct from
  // HIGH_FREQUENCY ("Daily / 20+ per month"), which is the Airbnb every-visit
  // model and advances on a weekly cadence.
  "DAILY",
  "WEEKLY",
  "BIWEEKLY",
  "TWICE_WEEKLY",
  "HIGH_FREQUENCY",
  "MONTHLY",
  "QUARTERLY",
] as const;

// Categories that carry their own discount table in the admin UI.
export const DISCOUNTABLE_CATEGORIES = [
  "RESIDENTIAL",
  "DEEP",
  "MOVE_IN_OUT",
  "POST_CONSTRUCTION",
  "AIRBNB",
  "COMMERCIAL",
] as const;

// Default recurring discounts (the client's stated 12% weekly / 8% biweekly,
// applied to every category; twice-weekly/high-frequency mirror the old
// hardcoded ladder). Admins can zero any cell out.
const DEFAULT_FREQ_ROW: Record<string, number> = {
  // Defaults to 0 rather than an invented rate — admins set this per category
  // in Settings -> Pricing Rules, same as MONTHLY/QUARTERLY.
  DAILY: 0,
  WEEKLY: 12,
  BIWEEKLY: 8,
  TWICE_WEEKLY: 15,
  HIGH_FREQUENCY: 20,
  MONTHLY: 0,
  QUARTERLY: 0,
};

/** All-zero row — no recurring discount at any cadence. */
const NO_DISCOUNT_ROW: Record<string, number> = Object.fromEntries(
  FREQ_DISCOUNT_KEYS.map((f) => [f, 0])
);

/**
 * Item 15: *"No one does frequencies for move-in, move-out, or deep cleanings.
 * It's a one-off price for all of them. There's no discount when it comes to
 * those."* The booking page hides the frequency choice for these two, and these
 * defaults make sure an admin-created recurring job doesn't quietly discount
 * one either. Still editable in Settings → Pricing Rules — a stored value wins.
 */
const NO_DISCOUNT_CATEGORIES = new Set<string>(["DEEP", "MOVE_IN_OUT"]);

function defaultFreqRow(category: string): Record<string, number> {
  return NO_DISCOUNT_CATEGORIES.has(category)
    ? { ...NO_DISCOUNT_ROW }
    : { ...DEFAULT_FREQ_ROW };
}

export const SERVICE_PRICING_DEFAULTS: ServicePricingConfig = {
  moveInOut: { thresholdSqft: 1000, rateAtOrAbove: 0.25, rateBelow: 0.28 },
  postConstruction: { hourlyRate: 50, minHours: 4 },
  minJobPrice: 119,
  frequencyDiscounts: Object.fromEntries(
    DISCOUNTABLE_CATEGORIES.map((c) => [c, defaultFreqRow(c)])
  ),
};

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;
}

/** Merge a stored (possibly partial / legacy) config with the defaults. */
export function normalizeServicePricing(raw: unknown): ServicePricingConfig {
  const d = SERVICE_PRICING_DEFAULTS;
  if (!raw || typeof raw !== "object") return d;
  const r = raw as {
    moveInOut?: unknown;
    postConstruction?: unknown;
    minJobPrice?: unknown;
    frequencyDiscounts?: unknown;
  };
  const mi = (r.moveInOut ?? {}) as Record<string, unknown>;
  const pc = (r.postConstruction ?? {}) as Record<string, unknown>;
  return {
    moveInOut: {
      thresholdSqft: num(mi.thresholdSqft, d.moveInOut.thresholdSqft),
      rateAtOrAbove: num(mi.rateAtOrAbove, d.moveInOut.rateAtOrAbove),
      rateBelow: num(mi.rateBelow, d.moveInOut.rateBelow),
    },
    postConstruction: {
      hourlyRate: num(pc.hourlyRate, d.postConstruction.hourlyRate),
      // minHours accepts a legacy 0 → falls back to the default 4.
      minHours: num(pc.minHours, d.postConstruction.minHours) || d.postConstruction.minHours,
    },
    minJobPrice: num(r.minJobPrice, d.minJobPrice),
    frequencyDiscounts: normalizeFreqDiscounts(r.frequencyDiscounts),
  };
}

/** Merge stored per-category discount rows over the defaults, clamped 0–100. */
function normalizeFreqDiscounts(raw: unknown): Record<string, Record<string, number>> {
  const stored = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Record<string, Record<string, number>> = {};
  for (const cat of DISCOUNTABLE_CATEGORIES) {
    const row = (stored[cat] && typeof stored[cat] === "object"
      ? stored[cat]
      : {}) as Record<string, unknown>;
    const fallback = defaultFreqRow(cat);
    out[cat] = {};
    for (const f of FREQ_DISCOUNT_KEYS) {
      const v = row[f];
      out[cat][f] =
        typeof v === "number" && Number.isFinite(v)
          ? Math.min(100, Math.max(0, v))
          : fallback[f];
    }
  }
  return out;
}

/** Move-in/out base price: sqft × (sqft >= threshold ? lowRate : highRate). */
export function moveInOutBasePrice(
  sqft: number,
  cfg: ServicePricingConfig = SERVICE_PRICING_DEFAULTS
): number {
  const s = Math.max(0, Math.round(sqft || 0));
  const rate =
    s >= cfg.moveInOut.thresholdSqft
      ? cfg.moveInOut.rateAtOrAbove
      : cfg.moveInOut.rateBelow;
  return +(s * rate).toFixed(2);
}

/**
 * Post-construction base price: straight hourly, per cleaner, with a minimum
 * number of billable hours. price = max(minHours, hours) × hourlyRate × cleaners.
 * e.g. 2h with 1 cleaner at $50/hr, 4h minimum → 4 × 50 × 1 = $200;
 *      6h with 2 cleaners → 6 × 50 × 2 = $600.
 */
export function postConstructionBasePrice(
  hours: number,
  cleaners: number = 1,
  cfg: ServicePricingConfig = SERVICE_PRICING_DEFAULTS
): number {
  const { hourlyRate, minHours } = cfg.postConstruction;
  const billableHours = Math.max(minHours, Math.max(0, Math.round(hours || 0)));
  const crew = Math.max(1, Math.round(cleaners || 1));
  return +(billableHours * hourlyRate * crew).toFixed(2);
}

export function isSqftService(serviceType?: string): boolean {
  return serviceType === "MOVE_IN_OUT";
}
export function isHourlyService(serviceType?: string): boolean {
  return serviceType === "POST_CONSTRUCTION";
}

/**
 * Square-foot pricing test that accepts EITHER vocabulary
 * (awer_fixes.pdf item 8).
 *
 * `isSqftService` above only matches the booking flow's "MOVE_IN_OUT". The
 * admin job form stores "MOVE_IN - Move-in Cleaning" / "MOVE_OUT - Move-out
 * Cleaning", which normalize to MOVE_IN / MOVE_OUT — neither of which is
 * MOVE_IN_OUT. Both halves of a move are square-foot priced, so they are folded
 * together here, the same fold the frequency-discount grid already does.
 *
 * Kept string-based and pure so the job modal (client) and saveJob (server)
 * agree on whether square footage drives the price.
 */
export function isSqftJobType(rawJobType?: string | null): boolean {
  if (!rawJobType) return false;
  const code = rawJobType
    .split(" - ")[0]
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  return (
    code === "MOVE_IN_OUT" ||
    code === "MOVEINOUT" ||
    code === "MOVE_IN" ||
    code === "MOVEIN" ||
    code === "MOVE_OUT" ||
    code === "MOVEOUT"
  );
}
