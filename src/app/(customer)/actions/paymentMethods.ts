"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { stripe, getOrCreateStripeCustomer } from "@/lib/stripe";
import { logActivity } from "@/lib/activity-log";
import { getCardRemovalBlock, notifyCardReplaced } from "@/lib/payment-methods";

/**
 * Customer-facing payment methods (Account → Payment methods).
 *
 * Deliberately mirrors the admin surface in `admin/actions/clientPaymentMethods.ts`
 * rather than sharing it: the admin actions gate on OWNER/ADMIN, these gate on
 * "the signed-in customer owns this client record". Same invariants, different
 * identity — so each ownership check stays explicit and readable.
 *
 * Only brand / last4 / expiry / default ever cross this boundary. The card
 * number and CVV never reach our servers at all; cards are entered directly
 * into Stripe Elements.
 */

export interface CustomerPaymentMethod {
  paymentMethodId: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
  isExpired: boolean;
  /**
   * Upcoming bookings pinned to this card. Lets the account page explain which
   * bookings stay on an old card after a replacement is added, instead of the
   * customer having to guess.
   */
  upcomingBookings: number;
}

function isExpired(expMonth: number | null, expYear: number | null): boolean {
  if (!expMonth || !expYear) return false;
  const now = new Date();
  // A card is good through the last day of its expiry month.
  const lastValid = new Date(expYear, expMonth, 1);
  return lastValid <= new Date(now.getFullYear(), now.getMonth(), 1);
}

/** Resolves the signed-in customer's Client record, or fails closed. */
async function requireClient() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false as const, error: "Not authenticated" };

  const email = session.user.email?.toLowerCase();
  if (!email) return { ok: false as const, error: "Session has no email" };

  const client = await db.client.findFirst({
    where: { email, deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      stripeCustomerId: true,
      defaultPaymentMethodId: true,
    },
  });
  if (!client) return { ok: false as const, error: "Client record not found" };
  return { ok: true as const, client, userId: session.user.id };
}

/**
 * IDOR guard. The payment-method id comes from the browser, so before acting on
 * it we prove it belongs to THIS customer's Stripe customer — checked against
 * Stripe itself, not just our mirror, since the mirror can be stale.
 */
async function assertOwnedCard(
  clientId: string,
  stripeCustomerId: string | null,
  paymentMethodId: unknown
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (
    typeof paymentMethodId !== "string" ||
    !/^pm_[A-Za-z0-9_]+$/.test(paymentMethodId)
  ) {
    return { ok: false, error: "Card not found" };
  }
  if (!stripeCustomerId) return { ok: false, error: "Card not found" };

  let pm;
  try {
    pm = await stripe.paymentMethods.retrieve(paymentMethodId);
  } catch {
    return { ok: false, error: "Card not found" };
  }

  const owner = typeof pm.customer === "string" ? pm.customer : pm.customer?.id;
  if (!owner || owner !== stripeCustomerId) {
    // Not this customer's card — drop any stale mirror row claiming otherwise.
    await db.clientPaymentMethod
      .deleteMany({ where: { clientId, stripePaymentMethodId: paymentMethodId } })
      .catch(() => {});
    return { ok: false, error: "Card not found" };
  }
  return { ok: true, id: paymentMethodId };
}

/** Lists the customer's saved cards, reconciling the mirror from Stripe. */
export async function listMyPaymentMethods(): Promise<
  | { success: true; methods: CustomerPaymentMethod[]; canRemove: boolean }
  | { success: false; error: string }
> {
  const gate = await requireClient();
  if (!gate.ok) return { success: false, error: gate.error };
  const { client } = gate;

  if (!client.stripeCustomerId) {
    return { success: true, methods: [], canRemove: true };
  }

  try {
    const list = await stripe.paymentMethods.list({
      customer: client.stripeCustomerId,
      type: "card",
    });

    // One grouped query for "which upcoming bookings sit on which card".
    const pinnedRows = await db.job.groupBy({
      by: ["stripePaymentMethodId"],
      where: {
        clientId: client.id,
        deletedAt: null,
        status: { notIn: ["CANCELLED"] },
        startTime: { gte: new Date() },
        stripePaymentMethodId: { not: null },
      },
      _count: { _all: true },
    });
    const pinned = new Map(
      pinnedRows
        .filter((r) => r.stripePaymentMethodId)
        .map((r) => [r.stripePaymentMethodId as string, r._count._all])
    );

    const methods: CustomerPaymentMethod[] = list.data.map((pm) => ({
      paymentMethodId: pm.id,
      brand: pm.card?.brand ?? null,
      last4: pm.card?.last4 ?? null,
      expMonth: pm.card?.exp_month ?? null,
      expYear: pm.card?.exp_year ?? null,
      isDefault: pm.id === client.defaultPaymentMethodId,
      isExpired: isExpired(pm.card?.exp_month ?? null, pm.card?.exp_year ?? null),
      upcomingBookings: pinned.get(pm.id) ?? 0,
    }));

    return { success: true, methods, canRemove: true };
  } catch (error) {
    console.error("listMyPaymentMethods failed", error);
    return { success: false, error: "Could not load your payment methods" };
  }
}

/**
 * Starts a self-serve card add. Previously a customer could only add a card via
 * an admin-emailed one-time link; this lets them do it from their account.
 */
export async function createMySetupIntent(): Promise<
  { success: true; clientSecret: string } | { success: false; error: string }
> {
  const gate = await requireClient();
  if (!gate.ok) return { success: false, error: gate.error };
  const { client } = gate;

  if (!client.email) {
    return { success: false, error: "Your account has no email on file" };
  }

  try {
    const customerId = await getOrCreateStripeCustomer(
      client.id,
      client.email,
      client.name
    );

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ["card"],
      usage: "off_session",
      // Bound to the client so the intent can't be redeemed for anyone else.
      metadata: { clientId: client.id, source: "customer_account" },
    });

    if (!setupIntent.client_secret) {
      return { success: false, error: "Could not start card setup" };
    }
    return { success: true, clientSecret: setupIntent.client_secret };
  } catch (error) {
    console.error("createMySetupIntent failed", error);
    return { success: false, error: "Could not start card setup" };
  }
}

/**
 * Confirms a newly added card and makes it the default for future bookings.
 * Called after `stripe.confirmSetup` succeeds in the browser.
 */
export async function finalizeMyCardSetup(
  setupIntentId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const gate = await requireClient();
  if (!gate.ok) return { success: false, error: gate.error };
  const { client, userId } = gate;

  let setupIntent;
  try {
    setupIntent = await stripe.setupIntents.retrieve(setupIntentId, {
      expand: ["payment_method"],
    });
  } catch {
    return { success: false, error: "Could not verify your card" };
  }

  if (setupIntent.status !== "succeeded") {
    return { success: false, error: "That card could not be confirmed" };
  }

  // The intent id comes from the browser — prove it is this customer's before
  // writing anything derived from it.
  const intentCustomer =
    typeof setupIntent.customer === "string"
      ? setupIntent.customer
      : (setupIntent.customer?.id ?? null);
  if (!client.stripeCustomerId || intentCustomer !== client.stripeCustomerId) {
    return { success: false, error: "Could not verify your card" };
  }

  const paymentMethodId =
    typeof setupIntent.payment_method === "string"
      ? setupIntent.payment_method
      : (setupIntent.payment_method?.id ?? null);
  if (!paymentMethodId) {
    return { success: false, error: "No card found on that setup" };
  }

  const card =
    typeof setupIntent.payment_method === "string"
      ? null
      : (setupIntent.payment_method?.card ?? null);

  const previousDefault = client.defaultPaymentMethodId;

  try {
    // A newly added card becomes the default for future bookings.
    await stripe.customers.update(client.stripeCustomerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    await db.$transaction([
      db.clientPaymentMethod.updateMany({
        where: { clientId: client.id },
        data: { isDefault: false },
      }),
      db.clientPaymentMethod.upsert({
        where: { stripePaymentMethodId: paymentMethodId },
        create: {
          clientId: client.id,
          stripePaymentMethodId: paymentMethodId,
          brand: card?.brand ?? null,
          last4: card?.last4 ?? null,
          expMonth: card?.exp_month ?? null,
          expYear: card?.exp_year ?? null,
          isDefault: true,
        },
        update: { isDefault: true },
      }),
      db.client.update({
        where: { id: client.id },
        data: { defaultPaymentMethodId: paymentMethodId },
      }),
    ]);

    await logActivity({
      category: "PAYMENT",
      action: "card.added",
      actorId: userId,
      actorLabel: "CUSTOMER",
      targetType: "Client",
      targetId: client.id,
      message: `${client.name} added a payment method from their account; it is now their default.`,
      providerId: paymentMethodId,
      metadata: {
        clientName: client.name,
        paymentMethodId,
        cardBrand: card?.brand ?? null,
        cardLast4: card?.last4 ?? null,
        previousDefaultPaymentMethodId: previousDefault,
        source: "customer_account",
      },
    });

    await notifyCardReplaced({
      clientId: client.id,
      previousDefaultPaymentMethodId: previousDefault,
      newDefaultPaymentMethodId: paymentMethodId,
      reason: `${client.name} added a new card from their account, and it is now their default.`,
    });

    revalidatePath("/account");
    return { success: true };
  } catch (error) {
    console.error("finalizeMyCardSetup failed", error);
    return { success: false, error: "Could not save that card" };
  }
}

/** Chooses which saved card future bookings should charge. */
export async function setMyDefaultPaymentMethod(
  paymentMethodId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const gate = await requireClient();
  if (!gate.ok) return { success: false, error: gate.error };
  const { client, userId } = gate;

  const owned = await assertOwnedCard(
    client.id,
    client.stripeCustomerId,
    paymentMethodId
  );
  if (!owned.ok) return { success: false, error: owned.error };

  const card = await db.clientPaymentMethod.findFirst({
    where: { clientId: client.id, stripePaymentMethodId: owned.id },
    select: { brand: true, last4: true },
  });
  const previousDefault = client.defaultPaymentMethodId;

  try {
    await stripe.customers.update(client.stripeCustomerId!, {
      invoice_settings: { default_payment_method: owned.id },
    });

    await db.$transaction([
      db.clientPaymentMethod.updateMany({
        where: { clientId: client.id },
        data: { isDefault: false },
      }),
      db.clientPaymentMethod.updateMany({
        where: { clientId: client.id, stripePaymentMethodId: owned.id },
        data: { isDefault: true },
      }),
      db.client.update({
        where: { id: client.id },
        data: { defaultPaymentMethodId: owned.id },
      }),
    ]);

    await logActivity({
      category: "PAYMENT",
      action: "card.set_default",
      actorId: userId,
      actorLabel: "CUSTOMER",
      targetType: "Client",
      targetId: client.id,
      message: `${client.name} made ${card?.brand ?? "a card"} •••• ${card?.last4 ?? "????"} their default payment method.`,
      providerId: owned.id,
      metadata: {
        clientName: client.name,
        paymentMethodId: owned.id,
        previousDefaultPaymentMethodId: previousDefault,
        source: "customer_account",
      },
    });

    await notifyCardReplaced({
      clientId: client.id,
      previousDefaultPaymentMethodId: previousDefault,
      newDefaultPaymentMethodId: owned.id,
      reason: `${client.name} switched their default card from their account.`,
    });

    revalidatePath("/account");
    return { success: true };
  } catch (error) {
    console.error("setMyDefaultPaymentMethod failed", error);
    return { success: false, error: "Could not update your default card" };
  }
}

/**
 * Removes a saved card. Refuses when it is the customer's only card and they
 * still have bookings that need one — and says why, so the customer knows to
 * add a replacement first rather than just seeing a failure.
 */
export async function removeMyPaymentMethod(
  paymentMethodId: string
): Promise<
  { success: true; warning: string | null } | { success: false; error: string }
> {
  const gate = await requireClient();
  if (!gate.ok) return { success: false, error: gate.error };
  const { client, userId } = gate;

  const owned = await assertOwnedCard(
    client.id,
    client.stripeCustomerId,
    paymentMethodId
  );
  if (!owned.ok) return { success: false, error: owned.error };

  const card = await db.clientPaymentMethod.findFirst({
    where: { clientId: client.id, stripePaymentMethodId: owned.id },
    select: { brand: true, last4: true },
  });
  const wasDefault = client.defaultPaymentMethodId === owned.id;

  const block = await getCardRemovalBlock(client.id, owned.id);
  if (block) {
    await logActivity({
      category: "PAYMENT",
      action: "card.remove_blocked",
      status: "FAILED",
      actorId: userId,
      actorLabel: "CUSTOMER",
      targetType: "Client",
      targetId: client.id,
      message: `${client.name} tried to remove their only payment method while bookings still need one.`,
      providerId: owned.id,
      metadata: {
        clientName: client.name,
        paymentMethodId: owned.id,
        upcomingCount: block.upcomingCount,
        unsettledCount: block.unsettledCount,
        source: "customer_account",
      },
    });
    return { success: false, error: block.message };
  }

  try {
    try {
      await stripe.paymentMethods.detach(owned.id);
    } catch (err) {
      // Already detached in Stripe — converge the mirror anyway.
      const code = (err as { code?: string })?.code;
      if (code !== "resource_missing") throw err;
    }

    await db.clientPaymentMethod.deleteMany({
      where: { clientId: client.id, stripePaymentMethodId: owned.id },
    });

    let warning: string | null = null;

    if (wasDefault) {
      const next = await db.clientPaymentMethod.findFirst({
        where: { clientId: client.id },
        orderBy: { createdAt: "desc" },
      });

      if (next) {
        await stripe.customers.update(client.stripeCustomerId!, {
          invoice_settings: {
            default_payment_method: next.stripePaymentMethodId,
          },
        });
        await db.$transaction([
          db.clientPaymentMethod.updateMany({
            where: { clientId: client.id },
            data: { isDefault: false },
          }),
          db.clientPaymentMethod.update({
            where: { id: next.id },
            data: { isDefault: true },
          }),
          db.client.update({
            where: { id: client.id },
            data: { defaultPaymentMethodId: next.stripePaymentMethodId },
          }),
        ]);
        warning = `${next.brand ?? "Your other card"} •••• ${next.last4 ?? "????"} is now your default payment method.`;
        await notifyCardReplaced({
          clientId: client.id,
          previousDefaultPaymentMethodId: owned.id,
          newDefaultPaymentMethodId: next.stripePaymentMethodId,
          reason: `${client.name} removed their default card from their account, so the newest remaining card was promoted.`,
        });
      } else {
        await db.client.update({
          where: { id: client.id },
          data: { defaultPaymentMethodId: null },
        });
      }
    }

    await logActivity({
      category: "PAYMENT",
      action: "card.removed",
      actorId: userId,
      actorLabel: "CUSTOMER",
      targetType: "Client",
      targetId: client.id,
      message: `${client.name} removed ${card?.brand ?? "a card"} •••• ${card?.last4 ?? "????"} from their account.`,
      providerId: owned.id,
      metadata: {
        clientName: client.name,
        paymentMethodId: owned.id,
        wasDefault,
        cardBrand: card?.brand ?? null,
        cardLast4: card?.last4 ?? null,
        source: "customer_account",
      },
    });

    revalidatePath("/account");
    return { success: true, warning };
  } catch (error) {
    console.error("removeMyPaymentMethod failed", error);
    return { success: false, error: "Could not remove that card" };
  }
}
