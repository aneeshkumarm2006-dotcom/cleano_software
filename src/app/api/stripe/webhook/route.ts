import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { db } from "@/db";
import { logActivity } from "@/lib/activity-log";
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

  await db.$transaction([
    db.job.update({
      where: { id: jobId },
      data: {
        paymentReceived: true,
        paidAt: new Date(),
        stripePaymentIntentId: pi.id,
        paymentFailedAt: null,
        paymentFailureReason: null,
      },
    }),
    db.transaction.create({
      data: {
        date: new Date(),
        category: "REVENUE",
        amount: pi.amount_received / 100,
        description: `Stripe payment confirmed — job #${job.jobNumber}`,
        jobId,
        source: "CREDIT_CARD",
        isAuto: true,
      },
    }),
    db.jobLog.create({
      data: {
        jobId,
        action: "PAYMENT_RECEIVED",
        description: `Payment of $${(pi.amount_received / 100).toFixed(2)} confirmed via Stripe webhook (PI: ${pi.id})`,
      },
    }),
  ]);

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

    await db.$transaction([
      db.job.update({
        where: { id: job.id },
        data: { refundedAmount: alreadyRefunded + refundAmount },
      }),
      db.transaction.create({
        data: {
          date: new Date(),
          category: "REVENUE",
          amount: -refundAmount,
          description: `Stripe refund — Job #${job.jobNumber} (refund: ${refund.id})`,
          jobId: job.id,
          source: "refund",
          isAuto: true,
        },
      }),
      db.jobLog.create({
        data: {
          jobId: job.id,
          action: "UPDATED",
          field: "refundedAmount",
          oldValue: String(alreadyRefunded),
          newValue: String(alreadyRefunded + refundAmount),
          description: `Refund of $${refundAmount.toFixed(2)} confirmed via Stripe webhook (refund: ${refund.id})`,
        },
      }),
    ]);
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
  }
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
}
