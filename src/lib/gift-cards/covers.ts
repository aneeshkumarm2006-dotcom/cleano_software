/**
 * Gift card cover photo registry.
 *
 * IMPORTANT for the client: drop your final cover images into
 * `public/gift-cards/<key>.jpg` (or .png/.webp — just keep the extension
 * consistent here). Until you do, the email and purchase page render
 * the gradient fallback for that key. Add or remove rows as needed.
 *
 * Aspect ratio: 3:2 works well in email (e.g. 600x400 px).
 */

export interface GiftCardCover {
  key: string;
  name: string;
  description: string;
  /** Resolved at runtime against NEXT_PUBLIC_APP_URL when present. */
  imagePath: string;
  /** CSS gradient used as a fallback if the image is missing. */
  gradient: string;
}

export const GIFT_CARD_COVERS: GiftCardCover[] = [
  {
    key: "default",
    name: "Classic",
    description: "A clean, year-round design.",
    imagePath: "/gift-cards/default.jpg",
    gradient: "linear-gradient(135deg, #008C9C 0%, #0a8a98 100%)",
  },
  {
    key: "birthday",
    name: "Birthday",
    description: "For birthday gifting.",
    imagePath: "/gift-cards/birthday.jpg",
    gradient: "linear-gradient(135deg, #ec4899 0%, #f97316 100%)",
  },
  {
    key: "thankyou",
    name: "Thank You",
    description: "A heartfelt thank-you cover.",
    imagePath: "/gift-cards/thankyou.jpg",
    gradient: "linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)",
  },
  {
    key: "holiday",
    name: "Holiday",
    description: "For Christmas and end-of-year holidays.",
    imagePath: "/gift-cards/holiday.jpg",
    gradient: "linear-gradient(135deg, #166534 0%, #b91c1c 100%)",
  },
  {
    key: "spring",
    name: "Spring",
    description: "Spring season cover.",
    imagePath: "/gift-cards/spring.jpg",
    gradient: "linear-gradient(135deg, #84cc16 0%, #06b6d4 100%)",
  },
  {
    key: "summer",
    name: "Summer",
    description: "Summer season cover.",
    imagePath: "/gift-cards/summer.jpg",
    gradient: "linear-gradient(135deg, #facc15 0%, #fb923c 100%)",
  },
  {
    key: "fall",
    name: "Fall",
    description: "Fall season cover.",
    imagePath: "/gift-cards/fall.jpg",
    gradient: "linear-gradient(135deg, #b45309 0%, #7c2d12 100%)",
  },
  {
    key: "winter",
    name: "Winter",
    description: "Winter season cover.",
    imagePath: "/gift-cards/winter.jpg",
    gradient: "linear-gradient(135deg, #1e3a8a 0%, #e0e7ff 100%)",
  },
];

export function coverFor(key: string): GiftCardCover {
  return (
    GIFT_CARD_COVERS.find((c) => c.key === key) ?? GIFT_CARD_COVERS[0]
  );
}

/**
 * Legacy fallback list of purchase tiers. The live values are admin-editable
 * via the `payments.giftCardTiers` setting (read with `getSetting`); this const
 * is kept only as the documented default and mirrors the registry default —
 * minimum purchase is $150.
 */
export const GIFT_CARD_TIERS = [150, 200, 250, 300, 350, 400] as const;

/** Minimum job price — displayed on the purchase page so buyers know what
 *  the recipient can use the gift card for. Change here when prices shift. */
export const MIN_JOB_PRICE_USD = 119;
