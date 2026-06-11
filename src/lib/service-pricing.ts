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
  // Post-construction: a flat package covers the first N hours, then a flat
  // hourly rate for every extra hour. Under the package size it's hourly.
  postConstruction: {
    packagePrice: number; // default $439
    packageHours: number; // default 10
    hourlyRate: number; // default $50/hr
  };
}

export const SERVICE_PRICING_DEFAULTS: ServicePricingConfig = {
  moveInOut: { thresholdSqft: 1000, rateAtOrAbove: 0.25, rateBelow: 0.28 },
  postConstruction: { packagePrice: 439, packageHours: 10, hourlyRate: 50 },
};

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;
}

/** Merge a stored (possibly partial / legacy) config with the defaults. */
export function normalizeServicePricing(raw: unknown): ServicePricingConfig {
  const d = SERVICE_PRICING_DEFAULTS;
  if (!raw || typeof raw !== "object") return d;
  const r = raw as { moveInOut?: unknown; postConstruction?: unknown };
  const mi = (r.moveInOut ?? {}) as Record<string, unknown>;
  const pc = (r.postConstruction ?? {}) as Record<string, unknown>;
  return {
    moveInOut: {
      thresholdSqft: num(mi.thresholdSqft, d.moveInOut.thresholdSqft),
      rateAtOrAbove: num(mi.rateAtOrAbove, d.moveInOut.rateAtOrAbove),
      rateBelow: num(mi.rateBelow, d.moveInOut.rateBelow),
    },
    postConstruction: {
      packagePrice: num(pc.packagePrice, d.postConstruction.packagePrice),
      packageHours: num(pc.packageHours, d.postConstruction.packageHours),
      hourlyRate: num(pc.hourlyRate, d.postConstruction.hourlyRate),
    },
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
 * Post-construction base price: the package covers the first `packageHours`,
 * then `hourlyRate` per extra hour. Below the package size it's plain hourly.
 */
export function postConstructionBasePrice(
  hours: number,
  cfg: ServicePricingConfig = SERVICE_PRICING_DEFAULTS
): number {
  const h = Math.max(0, Math.round(hours || 0));
  const { packagePrice, packageHours, hourlyRate } = cfg.postConstruction;
  if (h >= packageHours) {
    return +(packagePrice + (h - packageHours) * hourlyRate).toFixed(2);
  }
  return +(h * hourlyRate).toFixed(2);
}

export function isSqftService(serviceType?: string): boolean {
  return serviceType === "MOVE_IN_OUT";
}
export function isHourlyService(serviceType?: string): boolean {
  return serviceType === "POST_CONSTRUCTION";
}
