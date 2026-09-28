"use server";

import { db } from "@/lib/org-db";
import { rateLimitByIp } from "@/lib/rate-limit";

export async function applyPromoCode(code: string, subtotal: number): Promise<{
  valid: boolean;
  discountAmount?: number;
  message?: string;
}> {
  if (!code?.trim()) return { valid: false, message: "Enter a promo code" };

  // Public and guessable: without a limit this is a promo-code oracle an
  // attacker can walk the keyspace of. The message matches "wrong code" so
  // the limiter itself leaks nothing.
  if (await rateLimitByIp("promo-code", { max: 10, windowMs: 60_000 })) {
    return { valid: false, message: "Invalid or expired promo code" };
  }

  const promo = await db.promoCode.findFirst({
    where: {
      code: code.trim().toUpperCase(),
      isActive: true,
      // Archived codes are soft-deleted, not removed — they must not stay
      // redeemable just because the row is still there.
      deletedAt: null,
    },
  });

  if (!promo) return { valid: false, message: "Invalid or expired promo code" };

  if (promo.expiresAt && promo.expiresAt < new Date()) {
    return { valid: false, message: "This promo code has expired" };
  }

  if (promo.maxUses != null && promo.usesCount >= promo.maxUses) {
    return { valid: false, message: "This promo code has reached its usage limit" };
  }

  const discountAmount =
    promo.discountType === "PERCENT"
      ? (subtotal * promo.discountValue) / 100
      : promo.discountValue;

  return { valid: true, discountAmount: Math.min(discountAmount, subtotal) };
}
