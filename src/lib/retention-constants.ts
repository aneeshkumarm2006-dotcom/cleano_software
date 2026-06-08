export const RECURRING_SAVE_OFFER_KEY = "recurring_save_offer";
export const RECURRING_SAVE_OFFER_CATEGORY = "retention";

/** Don't send another save offer to the same client within this many days. */
export const SAVE_OFFER_COOLDOWN_DAYS = 30;

export interface SaveOfferConfig {
  /** Master switch — when false, the check-in email is still sent but with no offer. */
  enabled: boolean;
  /** PERCENT → % off next cleaning; FIXED → $ off next cleaning. */
  offerType: "PERCENT" | "FIXED";
  offerValue: number;
  /** Editable lead-in line in the check-in email. */
  emailIntro: string;
}

export const DEFAULT_SAVE_OFFER: SaveOfferConfig = {
  enabled: true,
  offerType: "PERCENT",
  offerValue: 20,
  emailIntro:
    "We noticed you cancelled your recurring cleaning service and we'd love to know if everything's okay. Your feedback helps us do better — and we'd love to win you back.",
};

/** Frequencies that count as a recurring service (vs one-time). */
export const RECURRING_FREQUENCIES = [
  "WEEKLY",
  "BIWEEKLY",
  "MONTHLY",
  "QUARTERLY",
] as const;

/** Human label for the configured offer, e.g. "20% off your next cleaning". */
export function saveOfferLabel(cfg: Pick<SaveOfferConfig, "offerType" | "offerValue">): string {
  return cfg.offerType === "PERCENT"
    ? `${cfg.offerValue}% off your next cleaning`
    : `$${cfg.offerValue} off your next cleaning`;
}
