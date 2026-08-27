"use server";

import { db } from "@/lib/org-db";
import { stripe } from "@/lib/stripe";
import { logActivity } from "@/lib/activity-log";
import { notifyCardReplaced } from "@/lib/payment-methods";

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
    // payment_method is expanded so the history entry can record brand/last4.
    setupIntent = await stripe.setupIntents.retrieve(input.setupIntentId, {
      expand: ["payment_method"],
    });
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
    select: {
      id: true,
      name: true,
      stripeCustomerId: true,
      defaultPaymentMethodId: true,
    },
  });
  if (!client) return { success: false, error: "Client not found" };

  // Ownership check. `setupIntentId` is supplied by the browser, so proving the
  // intent succeeded is not enough — we must prove it is THIS client's intent.
  // Without this, a valid add-card link could be redeemed against a SetupIntent
  // belonging to another customer, pointing this client's default payment
  // method (and, when unset, their Stripe customer) at someone else's card.
  //
  // `createSetupIntentForToken` always runs first and persists the client's
  // Stripe customer via getOrCreateStripeCustomer, so the customer match holds
  // for intents already in flight when this check shipped. The metadata check
  // is defence in depth and is skipped when absent for that same reason.
  if (!client.stripeCustomerId || customerId !== client.stripeCustomerId) {
    return { success: false, error: "Could not verify card setup" };
  }
  const metaClientId = setupIntent.metadata?.clientId;
  if (metaClientId && metaClientId !== client.id) {
    return { success: false, error: "Could not verify card setup" };
  }

  const previousDefault = client.defaultPaymentMethodId;

  await db.$transaction(async (tx) => {
    // The customer id is no longer written here: the ownership check above
    // already proves it equals the client's stored value.
    await tx.client.update({
      where: { id: client.id },
      data: { defaultPaymentMethodId: paymentMethodId },
    });
    await tx.clientCardSetupToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    });
  });

  // Payment-method history: records that a card was added and became the
  // default, and which card it replaced. Keyed on the Stripe `pm_` id.
  const card =
    typeof setupIntent.payment_method === "string"
      ? null
      : setupIntent.payment_method?.card ?? null;
  await logActivity({
    category: "PAYMENT",
    action: "card.added",
    actorLabel: "CUSTOMER",
    targetType: "Client",
    targetId: client.id,
    message: `${client.name} added a payment method via the add-card link; it is now their default.`,
    providerId: paymentMethodId,
    metadata: {
      clientName: client.name,
      paymentMethodId,
      cardBrand: card?.brand ?? null,
      cardLast4: card?.last4 ?? null,
      previousDefaultPaymentMethodId: previousDefault,
      source: "add-card-link",
    },
  });

  await notifyCardReplaced({
    clientId: client.id,
    previousDefaultPaymentMethodId: previousDefault,
    newDefaultPaymentMethodId: paymentMethodId,
    reason: `${client.name} added a new card via the emailed add-card link, and it is now their default.`,
  });

  return { success: true };
}
