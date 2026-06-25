"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { stripe } from "@/lib/stripe";
import { revalidatePath } from "next/cache";

/**
 * Called immediately after `stripe.confirmSetup()` succeeds in the admin
 * JobModal card-entry panel. Reads the SetupIntent from Stripe, pulls
 * the resulting payment_method, and stores it on the Client so future
 * charges (chargeJob, bulkChargeJobs, captureCardHold) can run
 * off-session against the saved card.
 *
 * The webhook for `setup_intent.succeeded` also handles this — calling
 * the action directly just avoids waiting on webhook latency.
 */
export async function saveClientCardOnFile(input: {
  clientId: string;
  setupIntentId: string;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN" && role !== "OPS_MANAGER") {
    return { success: false, error: "Not authorized" };
  }

  const client = await db.client.findUnique({
    where: { id: input.clientId },
    select: { id: true, stripeCustomerId: true },
  });
  if (!client) return { success: false, error: "Client not found" };

  let setupIntent;
  try {
    setupIntent = await stripe.setupIntents.retrieve(input.setupIntentId);
  } catch (err) {
    const msg =
      (err as { message?: string })?.message ?? "SetupIntent not found";
    return { success: false, error: msg };
  }

  if (setupIntent.status !== "succeeded") {
    return {
      success: false,
      error: `SetupIntent status: ${setupIntent.status}`,
    };
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
    return { success: false, error: "No payment method on SetupIntent" };
  }

  await db.client.update({
    where: { id: input.clientId },
    data: {
      defaultPaymentMethodId: paymentMethodId,
      ...(customerId && !client.stripeCustomerId
        ? { stripeCustomerId: customerId }
        : {}),
    },
  });

  revalidatePath(`/admin/clients/${input.clientId}`);
  revalidatePath("/admin/jobs");
  return { success: true, paymentMethodId };
}
