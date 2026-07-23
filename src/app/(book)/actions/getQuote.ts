"use server";

import { db } from "@/db";
import { getServicePricingConfig } from "@/lib/booking-pricing";
import {
  isSqftService,
  isHourlyService,
  moveInOutBasePrice,
  postConstructionBasePrice,
} from "@/lib/service-pricing";

interface GetQuoteInput {
  serviceType?: string;
  bedCount: number;
  bathCount: number;
  halfBathCount?: number;
  squareFootage?: number;
  pcHours?: number;
  pcCleaners?: number;
}

async function getPerUnitRates() {
  const setting = await db.appSetting.findUnique({ where: { key: "pricing.perUnit" } });
  if (setting?.value && typeof setting.value === "object") {
    const v = setting.value as Record<string, unknown>;
    const baseServicePrice =
      typeof v.baseServicePrice === "number" ? v.baseServicePrice : 100;
    const perBedroom = typeof v.perBedroom === "number" ? v.perBedroom : null;
    const perFullBath = typeof v.perFullBath === "number" ? v.perFullBath : null;
    const perHalfBath = typeof v.perHalfBath === "number" ? v.perHalfBath : null;
    if (perBedroom !== null && perFullBath !== null && perHalfBath !== null) {
      return { baseServicePrice, perBedroom, perFullBath, perHalfBath };
    }
  }
  return null;
}

export async function getQuote({
  serviceType,
  bedCount,
  bathCount,
  halfBathCount = 0,
  squareFootage = 0,
  pcHours = 0,
  pcCleaners = 1,
}: GetQuoteInput) {
  try {
    // Per-service-type pricing overrides the bed/bath model.
    if (isSqftService(serviceType)) {
      const cfg = await getServicePricingConfig();
      return { success: true, basePrice: moveInOutBasePrice(squareFootage, cfg) };
    }
    if (isHourlyService(serviceType)) {
      const cfg = await getServicePricingConfig();
      return { success: true, basePrice: postConstructionBasePrice(pcHours, pcCleaners, cfg) };
    }

    // Prefer flat per-unit rates (new model set in Settings > Pricing Rules)
    const rates = await getPerUnitRates();
    if (rates) {
      const basePrice =
        rates.baseServicePrice +
        bedCount * rates.perBedroom +
        bathCount * rates.perFullBath +
        halfBathCount * rates.perHalfBath;
      return { success: true, basePrice };
    }

    // Fall back to legacy PricingRule table rows
    const exact = await db.pricingRule.findFirst({
      where: { bedCount, bathCount, isActive: true },
    });
    if (exact) return { success: true, basePrice: exact.basePrice };

    const closest = await db.pricingRule.findFirst({
      where: { bedCount, isActive: true },
      orderBy: { bathCount: "desc" },
    });
    if (closest) return { success: true, basePrice: closest.basePrice };

    const fallback = 120 + bedCount * 30 + bathCount * 20;
    return { success: true, basePrice: fallback, fallback: true as const };
  } catch (error) {
    console.error("Error fetching quote:", error);
    return { success: false, error: "Failed to compute quote" };
  }
}
