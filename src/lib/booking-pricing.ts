import { db } from "@/db";
import { calculateTax, TaxBreakdown } from "./tax";
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

// Returns the recurring discount percentage for the 2nd+ cleaning.
// First cleaning is always full price.
export function recurringDiscountPercent(
  frequency: "ONE_TIME" | "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY" | "TWICE_WEEKLY" | "HIGH_FREQUENCY"
): number {
  switch (frequency) {
    case "WEEKLY":
      return 12;
    case "BIWEEKLY":
      return 8;
    case "TWICE_WEEKLY":
      return 15;
    case "HIGH_FREQUENCY":
      return 20;
    default:
      return 0;
  }
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
