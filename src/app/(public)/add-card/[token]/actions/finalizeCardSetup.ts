"use server";

import { db } from "@/db";
import { stripe } from "@/lib/stripe";

/**
 * Called after `stripe.confirmSetup` succeeds on the public /add-card
 * page. Reads the SetupIntent, pulls the resulting payment method,
 * saves it to the Client, and marks the token as used.
 */
export async function finalizeCardSetup(input: {
  token: string;
  setupIntentId: string;
}) {
  const row = await db.clientCardSetupToken.findUnique({
    where: { token: input.token },
  });
  if (!row) return { success: false, error: "Invalid link" };
  if (row.usedAt) return { success: false, error: "This link has already been used" };
  if (row.expiresAt < new Date()) {
    return { success: false, error: "This link has expired" };
  }

  let setupIntent;
  try {
    setupIntent = await stripe.setupIntents.retrieve(input.setupIntentId);
  } catch {
    return { success: false, error: "Could not verify card setup" };
  }
  if (setupIntent.status !== "succeeded") {
    return { success: false, error: `Card setup status: ${setupIntent.status}` };
  }

  const paymentMethodId =
    typeof setupIntent.payment_method === "string"
      ? setupIntent.payment_method
      : setupIntent.payment_method?.id ?? null;
  const customerId =
    typeof setupIntent.customer === "string"
      ? setupIntent.customer
      : setupIntent.customer?.id ?? null;
  if (!paymentMethodId) {
    return { success: false, error: "No card found on setup intent" };
  }

  const client = await db.client.findUnique({
    where: { id: row.clientId },
    select: { id: true, stripeCustomerId: true },
  });
  if (!client) return { success: false, error: "Client not found" };

  await db.$transaction([
    db.client.update({
      where: { id: client.id },
      data: {
        defaultPaymentMethodId: paymentMethodId,
        ...(customerId && !client.stripeCustomerId
          ? { stripeCustomerId: customerId }
          : {}),
      },
    }),
    db.clientCardSetupToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    }),
  ]);

  return { success: true };
}
