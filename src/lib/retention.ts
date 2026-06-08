import { db } from "@/db";
import {
  RECURRING_SAVE_OFFER_KEY,
  DEFAULT_SAVE_OFFER,
  type SaveOfferConfig,
} from "@/lib/retention-constants";

export * from "@/lib/retention-constants";

/** Read the admin-configured save-offer settings, falling back to defaults. */
export async function getSaveOfferConfig(): Promise<SaveOfferConfig> {
  const row = await db.appSetting.findUnique({
    where: { key: RECURRING_SAVE_OFFER_KEY },
  });
  if (!row?.value || typeof row.value !== "object") return DEFAULT_SAVE_OFFER;
  const v = row.value as Record<string, unknown>;
  return {
    enabled: typeof v.enabled === "boolean" ? v.enabled : DEFAULT_SAVE_OFFER.enabled,
    offerType: v.offerType === "FIXED" ? "FIXED" : "PERCENT",
    offerValue:
      typeof v.offerValue === "number" && v.offerValue > 0
        ? v.offerValue
        : DEFAULT_SAVE_OFFER.offerValue,
    emailIntro:
      typeof v.emailIntro === "string" && v.emailIntro.trim()
        ? v.emailIntro
        : DEFAULT_SAVE_OFFER.emailIntro,
  };
}
