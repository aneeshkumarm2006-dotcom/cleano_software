"use server";

import { db } from "@/lib/org-db";
import { stripe } from "@/lib/stripe";
import { generateGiftCardCode } from "@/lib/gift-cards/code";
import { GIFT_CARD_COVERS } from "@/lib/gift-cards/covers";
import { getSetting } from "@/lib/settings";

export interface CreateGiftCardInput {
  amount: number;
  purchaserName: string;
  purchaserEmail: string;
  recipientName: string;
  recipientEmail: string;
  personalMessage?: string;
  scheduledDeliveryDate?: string;
  coverKey?: string;
}

/**
 * Step 1 of gift card purchase: validate inputs, create the GiftCard row
 * in PENDING_PAYMENT, and return a Stripe PaymentIntent client secret so
 * the buyer can pay. After payment succeeds the client calls
 * `finalizeGiftCardPurchase` to flip status to ACTIVE and trigger
 * delivery (or schedule it).
 */
export async function createGiftCardIntent(input: CreateGiftCardInput) {
  const amount = Math.round(Number(input.amount));
  const tiers = await getSetting("payments.giftCardTiers");
  if (!tiers.includes(amount)) {
    return { success: false, error: "Pick a valid tier amount" };
  }

  const purchaserName = input.purchaserName?.trim();
  const purchaserEmail = input.purchaserEmail?.trim().toLowerCase();
  const recipientName = input.recipientName?.trim();
  const recipientEmail = input.recipientEmail?.trim().toLowerCase();

  if (!purchaserName) return { success: false, error: "Your name is required" };
  if (!purchaserEmail || !purchaserEmail.includes("@")) {
    return { success: false, error: "Your email is required" };
  }
  if (!recipientName) {
    return { success: false, error: "Recipient name is required" };
  }
  if (!recipientEmail || !recipientEmail.includes("@")) {
    return { success: false, error: "Recipient email is required" };
  }

  const coverKey =
    GIFT_CARD_COVERS.find((c) => c.key === input.coverKey)?.key ?? "default";

  let scheduledDate: Date | null = null;
  if (input.scheduledDeliveryDate) {
    const parsed = new Date(input.scheduledDeliveryDate);
    if (!Number.isNaN(parsed.getTime())) {
      // Only honour future dates; past dates fall back to immediate send.
      if (parsed.getTime() > Date.now()) {
        scheduledDate = parsed;
      }
    }
  }

  const code = generateGiftCardCode();

  const giftCard = await db.giftCard.create({
    data: {
      code,
      amount,
      status: "PENDING_PAYMENT",
      purchaserName,
      purchaserEmail,
      recipientName,
      recipientEmail,
      personalMessage: input.personalMessage?.trim() || null,
      scheduledDeliveryDate: scheduledDate,
      coverKey,
    },
  });

  try {
    const pi = await stripe.paymentIntents.create({
      amount: amount * 100,
      currency: "cad",
      automatic_payment_methods: { enabled: true },
      receipt_email: purchaserEmail,
      description: `Cleano gift card — ${recipientName} ($${amount})`,
      metadata: {
        giftCardId: giftCard.id,
        kind: "gift_card",
      },
    });
    await db.giftCard.update({
      where: { id: giftCard.id },
      data: { stripePaymentIntentId: pi.id },
    });
    return {
      success: true,
      giftCardId: giftCard.id,
      clientSecret: pi.client_secret,
    };
  } catch (err) {
    await db.giftCard.update({
      where: { id: giftCard.id },
      data: { status: "CANCELLED" },
    });
    const msg =
      (err as { raw?: { message?: string }; message?: string })?.raw?.message ??
      (err as { message?: string })?.message ??
      "Stripe error";
    return { success: false, error: msg };
  }
}
