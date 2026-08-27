import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { db } from "@/lib/org-db";
import { platformDb } from "@/lib/platform-db";
import { runAsOrg, type OrgContext } from "@/lib/org-context";
import { requireBudgetCategoryId } from "@/lib/budget-categories";
import { logActivity } from "@/lib/activity-log";
import { notifyCardReplaced } from "@/lib/payment-methods";
import {
  queueAndSendReceipt,
  queueAndSendRefund,
  sendCustomerBookingCharged,
  sendCustomerCardDeclined,
  sendAdminCardDeclined,
  sendAdminNewCardAdded,
} from "@/lib/email";
import Stripe from "stripe";

export const config = { api: { bodyParser: false } };

async function handlePaymentIntentSucceeded(pi: Stripe.PaymentIntent) {
  const jobId = pi.metadata?.jobId;
  if (!jobId) return;

  const job = await db.job.findUnique({
    where: { id: jobId },
    include: { client: { select: { name: true, email: true } } },
  });
  if (!job || job.paymentReceived) return;

  const revenueCategoryId = await requireBudgetCategoryId("revenue");

  await db.$transaction(async (tx) => {
    const __t0 = await tx.job.update({
        where: { id: jobId },
        data: {
          paymentReceived: true,
          paidAt: new Date(),
          stripePaymentIntentId: pi.id,
          paymentFailedAt: null,
          paymentFailureReason: null,
        },
      });
    const __t1 = await tx.transaction.create({
        data: {
          date: new Date(),
          categoryId: revenueCategoryId,
          amount: pi.amount_received / 100,
          description: `Stripe payment confirmed — job #${job.jobNumber}`,
          jobId,
          source: "CREDIT_CARD",
          isAuto: true,
        },
      });
    const __t2 = await tx.jobLog.create({
        data: {
          jobId,
          action: "PAYMENT_RECEIVED",
          description: `Payment of $${(pi.amount_received / 100).toFixed(2)} confirmed via Stripe webhook (PI: ${pi.id})`,
        },
      });
    return [__t0, __t1, __t2];
  });

  queueAndSendReceipt(jobId).catch(() => {});

  if (job.client?.email) {
    sendCustomerBookingCharged({
      to: job.client.email,
      clientName: job.client.name,
      jobId,
      jobNumber: job.jobNumber,
      amount: pi.amount_received / 100,
      paymentMethod: "Card on file",
    }).catch((e) => console.error("customer booking-charged (webhook)", e));
  }
}

async function handlePaymentIntentFailed(pi: Stripe.PaymentIntent) {
  const jobId = pi.metadata?.jobId;
  if (!jobId) return;

  const reason =
    pi.last_payment_error?.message ?? "Payment failed";

  const job = await db.job.findUnique({
    where: { id: jobId },
    include: { client: { select: { name: true, email: true } } },
  });
  if (!job) return;

  await db.job.update({
    where: { id: jobId },
    data: {
      paymentFailedAt: new Date(),
      paymentFailureReason: reason,
    },
  }).catch(() => {});

  // Notify admin + customer (gated by Settings → Notifications).
  sendAdminCardDeclined({
    jobId,
    jobNumber: job.jobNumber,
    clientName: job.clientName,
    reason,
    amountAttempted: pi.amount / 100,
    context: "charge",
  }).catch((e) => console.error("admin card-declined (webhook)", e));
  if (job.client?.email) {
    sendCustomerCardDeclined({
      to: job.client.email,
      clientName: job.client.name,
      jobId,
      jobNumber: job.jobNumber,
      reason,
      context: "charge",
    }).catch((e) => console.error("customer card-declined (webhook)", e));
  }
}

async function handleChargeRefunded(charge: Stripe.Charge) {
  const refunds = charge.refunds?.data ?? [];
  if (refunds.length === 0) return;

  // Look up the job by the payment intent
  const job = await db.job.findFirst({
    where: { stripePaymentIntentId: charge.payment_intent as string },
  });
  if (!job) return;

  const revenueCategoryId = await requireBudgetCategoryId("revenue");

  // Process each refund independently and idempotently. A refund is keyed by
  // its Stripe id (re_...) embedded in the transaction description, so a refund
  // already recorded — either by issueRefund or a prior webhook delivery — is
  // skipped. This prevents double-counting refundedAmount and duplicate
  // negative transactions on Stripe retries.
  for (const refund of refunds) {
    const existing = await db.transaction.findFirst({
      where: { jobId: job.id, description: { contains: refund.id } },
    });
    if (existing) continue;

    const refundAmount = refund.amount / 100;
    const current = await db.job.findUnique({
      where: { id: job.id },
      select: { refundedAmount: true },
    });
    const alreadyRefunded = current?.refundedAmount ?? 0;

    await db.$transaction(async (tx) => {
      const __t0 = await tx.job.update({
          where: { id: job.id },
          data: { refundedAmount: alreadyRefunded + refundAmount },
        });
      const __t1 = await tx.transaction.create({
          data: {
            date: new Date(),
            categoryId: revenueCategoryId,
            amount: -refundAmount,
            description: `Stripe refund — Job #${job.jobNumber} (refund: ${refund.id})`,
            jobId: job.id,
            source: "refund",
            isAuto: true,
          },
        });
      const __t2 = await tx.jobLog.create({
          data: {
            jobId: job.id,
            action: "UPDATED",
            field: "refundedAmount",
            oldValue: String(alreadyRefunded),
            newValue: String(alreadyRefunded + refundAmount),
            description: `Refund of $${refundAmount.toFixed(2)} confirmed via Stripe webhook (refund: ${refund.id})`,
          },
        });
      return [__t0, __t1, __t2];
    });
  }
}

async function handleSetupIntentSucceeded(si: Stripe.SetupIntent) {
  const customerId = si.customer as string;
  const paymentMethodId = si.payment_method as string;
  if (!customerId || !paymentMethodId) return;

  // Save the default payment method on the client record
  const client = await db.client.findFirst({
    where: { stripeCustomerId: customerId },
    select: { id: true, name: true, email: true, defaultPaymentMethodId: true },
  });

  const isNewCard = client && client.defaultPaymentMethodId !== paymentMethodId;
  const previousDefault = client?.defaultPaymentMethodId ?? null;

  await db.client.updateMany({
    where: { stripeCustomerId: customerId },
    data: { defaultPaymentMethodId: paymentMethodId },
  });

  // Also set it as default on the Stripe customer
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });

  // Notify admins (gated). Only fire when this is genuinely a new card —
  // skips noise when Stripe re-confirms the same card.
  if (client && isNewCard) {
    sendAdminNewCardAdded({
      clientName: client.name,
      clientEmail: client.email ?? "—",
    }).catch((e) => console.error("admin new-card email", e));

    // A card that displaces an existing default is a replacement, not just an
    // addition. Deduplicated on the new card's id, so whichever of this webhook
    // and the action that saved the card gets there first wins and the other
    // is a no-op.
    await notifyCardReplaced({
      clientId: client.id,
      previousDefaultPaymentMethodId: previousDefault,
      newDefaultPaymentMethodId: paymentMethodId,
      reason: `${client.name} added a new card, and it is now their default.`,
    });
  }
}


/**
 * Which cleaning company a Stripe event belongs to.
 *
 * Stripe knows nothing about organizations. Every event arrives at one shared
 * endpoint carrying only its own identifiers, so the company has to be worked
 * back out from the row those identifiers point at — and that lookup has to
 * happen BEFORE anything else, because every query below it is scoped and would
 * otherwise return nothing at all.
 *
 * Uses the platform client on purpose: this is the one moment the request has no
 * tenant yet, so it is the one lookup allowed to see across all of them. It
 * reads ids only, never customer data.
 *
 * Returns null when nothing matches — a payment for a job we do not have. The
 * caller acknowledges those rather than retrying, because a retry cannot make a
 * missing row appear.
 */
async function organizationForEvent(event: Stripe.Event): Promise<OrgContext | null> {
  let organizationId: string | null = null;

  switch (event.type) {
    case "payment_intent.succeeded":
    case "payment_intent.payment_failed": {
      const pi = event.data.object as Stripe.PaymentIntent;
      const jobId = pi.metadata?.jobId;
      if (jobId) {
        const job = await platformDb.job.findUnique({
          where: { id: jobId },
          select: { organizationId: true },
        });
        organizationId = job?.organizationId ?? null;
      }
      break;
    }
    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const pi = charge.payment_intent as string | null;
      if (pi) {
        const job = await platformDb.job.findFirst({
          where: { stripePaymentIntentId: pi },
          select: { organizationId: true },
        });
        organizationId = job?.organizationId ?? null;
      }
      break;
    }
    case "setup_intent.succeeded": {
      const si = event.data.object as Stripe.SetupIntent;
      const customerId = si.customer as string | null;
      if (customerId) {
        const client = await platformDb.client.findFirst({
          where: { stripeCustomerId: customerId },
          select: { organizationId: true },
        });
        organizationId = client?.organizationId ?? null;
      }
      break;
    }
    default:
      return null;
  }

  if (!organizationId) return null;

  const org = await platformDb.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, slug: true, name: true, timezone: true },
  });
  return org ?? null;
}

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err.message);
    return NextResponse.json({ error: `Webhook error: ${err.message}` }, { status: 400 });
  }

  // Which company is this for? Must come first: every query below is scoped, and
  // without a tenant they all return nothing rather than failing loudly.
  const org = await organizationForEvent(event);
  if (!org) {
    // Nothing of ours matches. Acknowledge rather than 500 — Stripe would retry
    // for days, and a retry cannot make a missing row appear. Recorded so a
    // genuine mismatch is visible instead of silently dropped.
    console.warn(`stripe webhook ${event.type} ${event.id}: no matching organization`);
    return NextResponse.json({ received: true, unmatched: true });
  }

  return runAsOrg(org, async () => {
  // Idempotency: claim the event id before processing. A duplicate delivery
  // collides on the primary key and is skipped (Stripe retries the same id).
  try {
    await db.webhookEvent.create({
      data: { id: event.id, type: event.type },
    });
  } catch {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;
      case "payment_intent.payment_failed":
        await handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
        break;
      case "charge.refunded":
        await handleChargeRefunded(event.data.object as Stripe.Charge);
        break;
      case "setup_intent.succeeded":
        await handleSetupIntentSucceeded(event.data.object as Stripe.SetupIntent);
        break;
      default:
        // Unhandled event — acknowledge so Stripe doesn't retry
        break;
    }
  } catch (err: any) {
    console.error(`Error handling ${event.type}:`, err);
    // Release the claim so Stripe's retry can reprocess this event.
    await db.webhookEvent.delete({ where: { id: event.id } }).catch(() => {});
    await logActivity({
      category: "WEBHOOK",
      action: event.type,
      status: "FAILED",
      providerId: event.id,
      error: String(err?.message ?? err),
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  await logActivity({
    category: "WEBHOOK",
    action: event.type,
    status: "SUCCESS",
    providerId: event.id,
  });

  return NextResponse.json({ received: true });
  });
}
