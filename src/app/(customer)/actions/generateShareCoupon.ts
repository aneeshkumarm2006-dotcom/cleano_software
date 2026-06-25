"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { randomBytes } from "crypto";
import { getSetting } from "@/lib/settings";

/**
 * Facebook / X share coupon (#92-94): a customer unlocks a single-use $X-off
 * promo code by sharing Cleano. Idempotent — returns the customer's existing
 * unused share coupon if they already have one, so repeated shares don't mint
 * a pile of codes.
 */
export async function generateShareCoupon(): Promise<
  { success: true; code: string; amount: number } | { success: false; error: string }
> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };

    const email = session.user.email?.toLowerCase();
    const client = email ? await db.client.findFirst({ where: { email } }) : null;
    if (!client) return { success: false, error: "Client record not found" };

    const amount = await getSetting("customer.shareCouponUsd");

    // Reuse an existing active, unredeemed share coupon for this customer.
    const existing = await db.promoCode.findFirst({
      where: {
        description: `Social-share coupon for ${client.id}`,
        isActive: true,
        usesCount: 0,
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      return { success: true, code: existing.code, amount: existing.discountValue };
    }

    const code = `SHARE-${randomBytes(3).toString("hex").toUpperCase()}`;
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    await db.promoCode.create({
      data: {
        code,
        description: `Social-share coupon for ${client.id}`,
        discountType: "FIXED",
        discountValue: amount,
        maxUses: 1,
        expiresAt,
        isActive: true,
      },
    });

    return { success: true, code, amount };
  } catch (e) {
    console.error("generateShareCoupon", e);
    return { success: false, error: "Could not generate a coupon" };
  }
}
