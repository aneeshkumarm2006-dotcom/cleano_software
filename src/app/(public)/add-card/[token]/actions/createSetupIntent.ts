"use server";

import { db } from "@/lib/org-db";
import { stripe, getOrCreateStripeCustomer } from "@/lib/stripe";

/**
 * Public action triggered by the /add-card/[token] page. Validates the
 * token, ensures the Client has a Stripe customer ID, and creates a
 * SetupIntent so the page can render Stripe Elements.
 */
export async function createSetupIntentForToken(token: string) {
  const row = await db.clientCardSetupToken.findUnique({
    where: { token },
  });
  if (!row) return { success: false, error: "Invalid link" };
  if (row.usedAt) return { success: false, error: "This link has already been used" };
  if (row.expiresAt < new Date()) {
    return { success: false, error: "This link has expired" };
  }

  const client = await db.client.findUnique({
    where: { id: row.clientId },
    select: { id: true, name: true, email: true },
  });
  if (!client) return { success: false, error: "Client not found" };
  if (!client.email) return { success: false, error: "Client has no email on file" };

  const customerId = await getOrCreateStripeCustomer(
    client.id,
    client.email,
    client.name
  );

  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    payment_method_types: ["card"],
    usage: "off_session",
    // Binds the intent to the client and the one-time token it was minted for.
    // `finalizeCardSetup` re-checks this so a SetupIntent belonging to someone
    // else can't be redeemed against this token.
    metadata: { clientId: client.id, cardSetupTokenId: row.id },
  });

  return {
    success: true,
    clientSecret: setupIntent.client_secret,
    setupIntentId: setupIntent.id,
    customerName: client.name,
  };
}
