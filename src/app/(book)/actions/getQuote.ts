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
    const cfg = await getServicePricingConfig();
    // Compute the raw base per model, then apply the client minimum (item 9).
    let rawBase: number;
    let fallback = false;

    if (isSqftService(serviceType)) {
      rawBase = moveInOutBasePrice(squareFootage, cfg);
    } else if (isHourlyService(serviceType)) {
      rawBase = postConstructionBasePrice(pcHours, pcCleaners, cfg);
    } else {
      const rates = await getPerUnitRates();
      if (rates) {
        rawBase =
          rates.baseServicePrice +
          bedCount * rates.perBedroom +
          bathCount * rates.perFullBath +
          halfBathCount * rates.perHalfBath;
      } else {
        const exact = await db.pricingRule.findFirst({
          where: { bedCount, bathCount, isActive: true },
        });
        const closest =
          exact ??
          (await db.pricingRule.findFirst({
            where: { bedCount, isActive: true },
            orderBy: { bathCount: "desc" },
          }));
        if (closest) {
          rawBase = closest.basePrice;
        } else {
          rawBase = 120 + bedCount * 30 + bathCount * 20;
          fallback = true;
        }
      }
    }

    // A customer can never be quoted below the minimum job price.
    const basePrice = Math.max(rawBase, cfg.minJobPrice);
    return {
      success: true as const,
      basePrice,
      minJobPrice: cfg.minJobPrice,
      minApplied: rawBase < cfg.minJobPrice,
      ...(fallback ? { fallback: true as const } : {}),
    };
  } catch (error) {
    console.error("Error fetching quote:", error);
    return { success: false, error: "Failed to compute quote" };
  }
}
