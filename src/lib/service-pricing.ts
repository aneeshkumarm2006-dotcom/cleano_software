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
}

export const SERVICE_PRICING_DEFAULTS: ServicePricingConfig = {
  moveInOut: { thresholdSqft: 1000, rateAtOrAbove: 0.25, rateBelow: 0.28 },
  postConstruction: { hourlyRate: 50, minHours: 4 },
  minJobPrice: 119,
};

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;
}

/** Merge a stored (possibly partial / legacy) config with the defaults. */
export function normalizeServicePricing(raw: unknown): ServicePricingConfig {
  const d = SERVICE_PRICING_DEFAULTS;
  if (!raw || typeof raw !== "object") return d;
  const r = raw as { moveInOut?: unknown; postConstruction?: unknown; minJobPrice?: unknown };
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
  };
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
