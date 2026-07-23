import { db } from "@/db";
import { calculateTax, TaxBreakdown } from "./tax";
import { normalizeJobType } from "./calendar-labels";
import {
  SERVICE_PRICING_KEY,
  ServicePricingConfig,
  normalizeServicePricing,
  moveInOutBasePrice,
  postConstructionBasePrice,
  isSqftService,
  isHourlyService,
} from "./service-pricing";

export interface PricingInput {
  serviceType?: string;
  bedCount: number;
  bathCount: number;
  halfBathCount?: number;
  squareFootage?: number;
  pcHours?: number;
  pcCleaners?: number;
  addOns: { name: string; price: number }[];
  travelFee?: number;
  discountAmount?: number;
}

/** Reads the admin-configured per-service-type rates, falling back to defaults. */
export async function getServicePricingConfig(): Promise<ServicePricingConfig> {
  const setting = await db.appSetting.findUnique({
    where: { key: SERVICE_PRICING_KEY },
  });
  return normalizeServicePricing(setting?.value);
}

export interface PricingResult extends TaxBreakdown {
  basePrice: number;
  addOnTotal: number;
  travelFee: number;
  discountAmount: number;
}

export async function computeBookingPrice(
  input: PricingInput
): Promise<PricingResult> {
  const rawBase = await resolveBasePrice(input);
  // Client-facing minimum job price (item 9): a customer booking's base service
  // price can never be quoted below this floor. Admins price jobs manually via
  // saveJob and are not subject to it.
  const cfg = await getServicePricingConfig();
  const basePrice = Math.max(rawBase, cfg.minJobPrice);
  const addOnTotal = input.addOns.reduce((s, a) => s + a.price, 0);
  const travelFee = input.travelFee ?? 0;
  const discountAmount = input.discountAmount ?? 0;

  const preTax = Math.max(0, basePrice + addOnTotal + travelFee - discountAmount);
  const tax = calculateTax(preTax);

  return { basePrice, addOnTotal, travelFee, discountAmount, ...tax };
}

async function resolveBasePrice(input: PricingInput): Promise<number> {
  const { bedCount, bathCount } = input;
  const halfBathCount = input.halfBathCount ?? 0;

  // Per-service-type pricing overrides the bed/bath model.
  if (isSqftService(input.serviceType)) {
    const cfg = await getServicePricingConfig();
    return moveInOutBasePrice(input.squareFootage ?? 0, cfg);
  }
  if (isHourlyService(input.serviceType)) {
    const cfg = await getServicePricingConfig();
    return postConstructionBasePrice(input.pcHours ?? 0, input.pcCleaners ?? 1, cfg);
  }

  // Prefer flat per-unit rates set in Settings > Pricing Rules
  const setting = await db.appSetting.findUnique({ where: { key: "pricing.perUnit" } });
  if (setting?.value && typeof setting.value === "object") {
    const v = setting.value as Record<string, unknown>;
    // Flat base service price applied to every booking (default $100).
    const baseServicePrice =
      typeof v.baseServicePrice === "number" ? v.baseServicePrice : 100;
    const perBedroom = typeof v.perBedroom === "number" ? v.perBedroom : null;
    const perFullBath = typeof v.perFullBath === "number" ? v.perFullBath : null;
    const perHalfBath = typeof v.perHalfBath === "number" ? v.perHalfBath : null;
    if (perBedroom !== null && perFullBath !== null && perHalfBath !== null) {
      return (
        baseServicePrice +
        bedCount * perBedroom +
        bathCount * perFullBath +
        halfBathCount * perHalfBath
      );
    }
  }

  // Fall back to legacy PricingRule table rows
  const exact = await db.pricingRule.findFirst({
    where: { bedCount, bathCount, isActive: true },
  });
  if (exact) return exact.basePrice;

  const closest = await db.pricingRule.findFirst({
    where: { bedCount, isActive: true },
    orderBy: { bathCount: "desc" },
  });
  if (closest) return closest.basePrice;

  return 120 + bedCount * 30 + bathCount * 20;
}

type FrequencyValue =
  | "ONE_TIME"
  | "WEEKLY"
  | "BIWEEKLY"
  | "MONTHLY"
  | "QUARTERLY"
  | "TWICE_WEEKLY"
  | "HIGH_FREQUENCY";

/**
 * Recurring discount % for the 2nd+ cleaning, resolved from the admin-config
 * per-service-category table (item 7). First cleaning is always full price.
 * Reads config from `pricing.serviceTypes`.
 */
export async function recurringDiscountPercent(
  frequency: FrequencyValue,
  serviceType?: string
): Promise<number> {
  if (frequency === "ONE_TIME") return 0;
  const cfg = await getServicePricingConfig();
  return frequencyDiscountFromConfig(cfg, serviceType, frequency);
}

/** Pure resolver: pick the discount % for a category+frequency from a config. */
export function frequencyDiscountFromConfig(
  cfg: ServicePricingConfig,
  serviceType: string | undefined,
  frequency: FrequencyValue
): number {
  if (frequency === "ONE_TIME") return 0;
  let cat = normalizeJobType(serviceType) ?? "RESIDENTIAL";
  // The discount grid only carries a combined MOVE_IN_OUT row, but an admin job
  // typed "MOVE_IN - …" / "MOVE_OUT - …" normalizes to MOVE_IN / MOVE_OUT. Fold
  // them in so a recurring move job uses the move rates, not the RESIDENTIAL
  // fallback.
  if (cat === "MOVE_IN" || cat === "MOVE_OUT") cat = "MOVE_IN_OUT";
  const row =
    cfg.frequencyDiscounts[cat] ?? cfg.frequencyDiscounts.RESIDENTIAL ?? {};
  return row[frequency] ?? 0;
}

// Returns the date for the next occurrence given a base date and frequency.
export function nextOccurrence(
  base: Date,
  frequency: "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY" | "TWICE_WEEKLY" | "HIGH_FREQUENCY"
): Date {
  const d = new Date(base);
  switch (frequency) {
    case "WEEKLY":
    case "HIGH_FREQUENCY":
      d.setDate(d.getDate() + 7);
      break;
    case "TWICE_WEEKLY":
      d.setDate(d.getDate() + 3);
      break;
    case "BIWEEKLY":
      d.setDate(d.getDate() + 14);
      break;
    case "MONTHLY":
      d.setMonth(d.getMonth() + 1);
      break;
    case "QUARTERLY":
      d.setMonth(d.getMonth() + 3);
      break;
  }
  return d;
}

// How many additional jobs to auto-create for recurring bookings.
// Per spec: 4 weeks of jobs for WEEKLY (4 more), 4 visits for BIWEEKLY (3 more).
// `weeklyHorizon` is the admin-configurable count for weekly-cadence
// frequencies (setting `scheduling.recurringWeeklyHorizon`); it defaults to 3
// so callers that don't pass it keep the original behavior.
export function recurrenceCount(
  frequency: "ONE_TIME" | "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY" | "TWICE_WEEKLY" | "HIGH_FREQUENCY",
  weeklyHorizon = 3
): number {
  switch (frequency) {
    case "WEEKLY":
    case "TWICE_WEEKLY":
    case "HIGH_FREQUENCY":
      return weeklyHorizon;
    case "BIWEEKLY":
      return weeklyHorizon;
    case "MONTHLY":
      return 2;
    case "QUARTERLY":
      return 1;
    default:
      return 0;
  }
}
