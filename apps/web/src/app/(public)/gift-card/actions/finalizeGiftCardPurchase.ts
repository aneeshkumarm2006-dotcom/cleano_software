"use server";

import { db } from "@/lib/org-db";
import { requireStripeForCurrentOrg } from "@/lib/stripe-org";
import {
  sendGiftCardToRecipient,
  sendGiftCardPurchaserReceipt,
  sendAdminGiftCardPurchased,
} from "@/lib/email";

/**
 * Step 2 of gift card purchase: confirm Stripe succeeded, flip the
 * GiftCard to ACTIVE, and either send the recipient delivery email now
 * (if no scheduled date) or leave it to the daily cron.
 *
 * Idempotent — re-running on an already-ACTIVE card is a no-op.
 */
export async function finalizeGiftCardPurchase(giftCardId: string) {
  const card = await db.giftCard.findUnique({ where: { id: giftCardId } });
  if (!card) return { success: false, error: "Gift card not found" };
  if (card.status === "ACTIVE" || card.status === "REDEEMED") {
    return { success: true, alreadyActive: true };
  }
  if (!card.stripePaymentIntentId) {
    return { success: false, error: "No payment in progress" };
  }

  const pi = await (await requireStripeForCurrentOrg()).paymentIntents.retrieve(
    card.stripePaymentIntentId
  );
  if (pi.status !== "succeeded") {
    return { success: false, error: `Payment status: ${pi.status}` };
  }

  const updated = await db.giftCard.update({
    where: { id: giftCardId },
    data: { status: "ACTIVE" },
  });

  // Send the buyer their receipt regardless of scheduled date.
  sendGiftCardPurchaserReceipt({
    to: card.purchaserEmail,
    purchaserName: card.purchaserName,
    recipientName: card.recipientName,
    recipientEmail: card.recipientEmail,
    amount: card.amount,
    scheduledDeliveryDate: card.scheduledDeliveryDate?.toISOString() ?? null,
  }).catch((e) => console.error("gift card buyer receipt", e));

  // Admin alert.
  sendAdminGiftCardPurchased({
    purchaserName: card.purchaserName,
    purchaserEmail: card.purchaserEmail,
    recipientName: card.recipientName,
    recipientEmail: card.recipientEmail,
    amount: card.amount,
    scheduledDeliveryDate: card.scheduledDeliveryDate?.toISOString() ?? null,
  }).catch((e) => console.error("admin gift card alert", e));

  // If no scheduled date OR the scheduled date is in the past, send
  // immediately. Otherwise the daily cron will pick it up.
  const scheduled = card.scheduledDeliveryDate;
  const shouldSendNow = !scheduled || scheduled.getTime() <= Date.now();
  if (shouldSendNow) {
    sendGiftCardToRecipient({
      to: card.recipientEmail,
      recipientName: card.recipientName,
      purchaserName: card.purchaserName,
      amount: card.amount,
      code: card.code,
      personalMessage: card.personalMessage,
      coverKey: card.coverKey,
    }).catch((e) => console.error("gift card recipient email", e));
    await db.giftCard.update({
      where: { id: giftCardId },
      data: { deliveredAt: new Date() },
    });
  }

  return { success: true, code: updated.code };
}
