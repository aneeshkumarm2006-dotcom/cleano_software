"use server";

import { db } from "@/db";
import { getSetting } from "@/lib/settings";
import { getServicePricingConfig } from "@/lib/booking-pricing";
import { normalizeAddOnCatalog, type AddOnCatalogEntry } from "@/lib/addon-catalog";
import { ADDON_ICON_KEY_SET } from "@/lib/addon-icons";
import {
  SERVICE_CONTENT_KEY,
  ServiceContentConfig,
  normalizeServiceContent,
} from "@/lib/service-content";

// The shape, its validation and the room enum all live in @/lib/addon-catalog.
// They cannot live here: this file is `"use server"`, so it may only export
// async functions. Re-exported as types (erased at runtime) so the existing
// import sites keep working.
export type { RoomType, AddOnCatalogEntry } from "@/lib/addon-catalog";
export type BookingAddOn = AddOnCatalogEntry;

export async function getBookingConfig(): Promise<{
  addOns: BookingAddOn[];
  minLeadDays: number;
  smsOptInDefault: boolean;
  /** Per-service-category recurring discount table (item 7), for display. */
  frequencyDiscounts: Record<string, Record<string, number>>;
  /** "What's included" text + graphic per service type (item 3). */
  serviceContent: ServiceContentConfig;
}> {
  const [minLeadDays, smsOptInDefault, pricingCfg, contentSetting] = await Promise.all([
    getSetting("scheduling.minLeadDays"),
    getSetting("customer.smsOptInDefault"),
    getServicePricingConfig(),
    db.appSetting.findUnique({ where: { key: SERVICE_CONTENT_KEY } }),
  ]);
  const frequencyDiscounts = pricingCfg.frequencyDiscounts;
  const serviceContent = normalizeServiceContent(contentSetting?.value);
  try {
    const setting = await db.appSetting.findUnique({
      where: { key: "pricing.addOns" },
    });

    if (!setting || !Array.isArray(setting.value)) {
      return { addOns: [], minLeadDays, smsOptInDefault, frequencyDiscounts, serviceContent };
    }

    const normalized = normalizeAddOnCatalog(setting.value, ADDON_ICON_KEY_SET);

    return { addOns: normalized, minLeadDays, smsOptInDefault, frequencyDiscounts, serviceContent };
  } catch {
    return { addOns: [], minLeadDays, smsOptInDefault, frequencyDiscounts, serviceContent };
  }
}
