"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { sendGiftCardRedeemedConfirmation } from "@/lib/email";
import { logActivity } from "@/lib/activity-log";

/**
 * Redeem a gift card code onto the signed-in client's account. The
 * card's full amount is added to `Client.giftCardBalance`, which the
 * existing chargeJob auto-apply logic will draw down at billing time.
 *
 * Errors:
 *  - not signed in
 *  - no matching code
 *  - already redeemed / refunded / pending payment
 */
export async function redeemGiftCard(input: { code: string }) {
  const code = input.code?.trim().toUpperCase();
  if (!code) return { success: false, error: "Enter a code" };

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return {
      success: false,
      error: "Sign in to your customer account to redeem.",
    };
  }
  const email = session.user.email?.toLowerCase();
  if (!email) return { success: false, error: "No email on account" };

  const client = await db.client.findFirst({
    where: { email },
    select: { id: true, name: true, email: true, giftCardBalance: true },
  });
  if (!client) {
    return {
      success: false,
      error: "No Cleano customer profile found for this account.",
    };
  }

  const card = await db.giftCard.findUnique({ where: { code } });
  if (!card) return { success: false, error: "Invalid code" };
  if (card.status === "REDEEMED") {
    return { success: false, error: "This gift card has already been redeemed" };
  }
  if (card.status !== "ACTIVE") {
    return {
      success: false,
      error: `This gift card is not yet active (status: ${card.status})`,
    };
  }

  // Atomically claim the card — only the call that flips ACTIVE→REDEEMED gets
  // count 1 and credits the balance, so concurrent redeems can't double-credit.
  const claim = await db.giftCard.updateMany({
    where: { id: card.id, status: "ACTIVE" },
    data: {
      status: "REDEEMED",
      redeemedAt: new Date(),
      redeemedByClientId: client.id,
    },
  });
  if (claim.count === 0) {
    return { success: false, error: "This gift card has already been redeemed" };
  }
  const newBalance = client.giftCardBalance + card.amount;
  await db.client.update({
    where: { id: client.id },
    data: { giftCardBalance: { increment: card.amount } },
  });

  await logActivity({
    category: "PAYMENT",
    action: "redeem_gift_card",
    status: "SUCCESS",
    actorId: session.user.id,
    actorLabel: client.email ?? client.name,
    targetType: "client",
    targetId: client.id,
    amount: card.amount,
    message: `Redeemed gift card ${code} — new balance $${newBalance.toFixed(2)}.`,
  });

  if (client.email) {
    sendGiftCardRedeemedConfirmation({
      to: client.email,
      recipientName: client.name,
      amount: card.amount,
      newBalance,
    }).catch((e) => console.error("redeem confirmation", e));
  }

  revalidatePath("/");
  return { success: true, amount: card.amount, newBalance };
}
