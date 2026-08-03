"use server";

import { db } from "@/db";
import { resolveChargePaymentMethod } from "@/lib/payment-methods";
import { resolveAmountDue } from "@/lib/job-billing";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { stripe } from "@/lib/stripe";
import {
  sendCustomerHoldPlaced,
  sendCustomerHoldReleased,
  sendCustomerHoldCaptureFailed,
} from "@/lib/email";

interface AdminGate {
  ok: true;
  userId: string;
}
interface AdminDeny {
  ok: false;
  error: string;
}

async function adminGate(): Promise<AdminGate | AdminDeny> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { ok: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { ok: false, error: "Not authorized" };
  }
  return { ok: true, userId: session.user.id };
}

/**
 * Place a manual-capture PaymentIntent for the full job price. The card
 * is authorized but NOT charged. Capture happens on job completion via
 * `captureCardHold`. If the booking cancels, call `releaseCardHold`.
 */
export async function placeCardHold(jobId: string) {
  const gate = await adminGate();
  if (!gate.ok) return { success: false, error: gate.error };

  const job = await db.job.findUnique({
    where: { id: jobId },
    include: { client: true },
  });
  if (!job) return { success: false, error: "Job not found" };
  if (job.holdPaymentIntentId) {
    return { success: false, error: "Hold already placed for this booking" };
  }
  if (job.paymentReceived) {
    return { success: false, error: "Booking is already paid" };
  }
  const client = job.client;
  if (!client?.stripeCustomerId) {
    return { success: false, error: "No saved card on file for this client" };
  }
  // Hold against the card the booking is pinned to, so a hold and the eventual
  // charge always land on the same card.
  const holdCard = await resolveChargePaymentMethod({
    clientId: client.id,
    pinnedPaymentMethodId: job.stripePaymentMethodId,
    clientDefaultPaymentMethodId: client.defaultPaymentMethodId,
  });
  if (!holdCard) {
    return { success: false, error: "No saved card on file for this client" };
  }

  // Same figure the eventual charge will use, so an authorization can never be
  // for less than the capture. See lib/job-billing.ts.
  const amount = resolveAmountDue(job);
  if (amount <= 0) return { success: false, error: "Invalid hold amount" };
  const amountCents = Math.round(amount * 100);

  try {
    const pi = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "cad",
      customer: client.stripeCustomerId,
      payment_method: holdCard,
      off_session: true,
      confirm: true,
      capture_method: "manual",
      description: `Cleano hold — job #${job.jobNumber}`,
      metadata: { jobId, jobNumber: String(job.jobNumber), kind: "hold" },
    });

    await db.$transaction([
      db.job.update({
        where: { id: jobId },
        data: {
          holdPaymentIntentId: pi.id,
          holdPlacedAt: new Date(),
          holdAmount: amount,
        },
      }),
      db.jobLog.create({
        data: {
          jobId,
          userId: gate.userId,
          action: "NOTE_ADDED",
          description: `Card hold placed for $${amount.toFixed(2)} (PI: ${pi.id}).`,
        },
      }),
    ]);

    if (client.email) {
      sendCustomerHoldPlaced({
        to: client.email,
        clientName: client.name,
        jobNumber: job.jobNumber,
        amountUsd: amount,
      }).catch((e) => console.error("hold-placed email", e));
    }

    revalidatePath(`/admin/jobs/${jobId}`);
    return { success: true, paymentIntentId: pi.id, amount };
  } catch (err) {
    const reason =
      (err as { raw?: { message?: string }; message?: string })?.raw?.message ??
      (err as { message?: string })?.message ??
      "Hold failed";
    return { success: false, error: reason };
  }
}

/**
 * Capture the hold (job complete, take the money). Marks the job paid
 * and writes a Transaction row. On failure, emails the customer.
 */
export async function captureCardHold(jobId: string) {
  const gate = await adminGate();
  if (!gate.ok) return { success: false, error: gate.error };

  const job = await db.job.findUnique({
    where: { id: jobId },
    include: { client: true },
  });
  if (!job) return { success: false, error: "Job not found" };
  if (!job.holdPaymentIntentId) {
    return { success: false, error: "No hold on this booking" };
  }
  if (job.holdCapturedAt) {
    return { success: false, error: "Already captured" };
  }
  if (job.holdReleasedAt) {
    return { success: false, error: "Hold was already released" };
  }

  // holdAmount is what Stripe actually authorized; only fall back to the
  // booking's own figure when the hold predates that column.
  const amount = job.holdAmount ?? resolveAmountDue(job);
  const amountCents = Math.round(amount * 100);

  try {
    const pi = await stripe.paymentIntents.capture(job.holdPaymentIntentId, {
      amount_to_capture: amountCents,
    });
    const now = new Date();
    await db.$transaction([
      db.job.update({
        where: { id: jobId },
        data: {
          holdCapturedAt: now,
          paymentReceived: true,
          paidAt: now,
          stripePaymentIntentId: pi.id,
        },
      }),
      db.transaction.create({
        data: {
          date: now,
          category: "REVENUE",
          amount,
          description: `Stripe hold captured — job #${job.jobNumber}`,
          jobId,
          source: "CREDIT_CARD",
          isAuto: true,
        },
      }),
      db.jobLog.create({
        data: {
          jobId,
          userId: gate.userId,
          action: "PAYMENT_RECEIVED",
          description: `Hold captured for $${amount.toFixed(2)} (PI: ${pi.id}).`,
        },
      }),
    ]);

    revalidatePath(`/admin/jobs/${jobId}`);
    revalidatePath("/admin/finances");
    return { success: true, amount };
  } catch (err) {
    const reason =
      (err as { raw?: { message?: string }; message?: string })?.raw?.message ??
      (err as { message?: string })?.message ??
      "Capture failed";
    await db.job.update({
      where: { id: jobId },
      data: {
        holdCaptureFailedAt: new Date(),
        holdCaptureFailReason: reason,
      },
    });
    if (job.client?.email) {
      sendCustomerHoldCaptureFailed({
        to: job.client.email,
        clientName: job.client.name,
        jobNumber: job.jobNumber,
        reason,
      }).catch((e) => console.error("capture-failed email", e));
    }
    return { success: false, error: reason };
  }
}

/**
 * Release a hold without capturing (e.g. booking canceled). Stripe
 * supports cancelling an uncaptured authorization PI to release the
 * funds back to the cardholder's bank.
 */
export async function releaseCardHold(jobId: string, reason?: string) {
  const gate = await adminGate();
  if (!gate.ok) return { success: false, error: gate.error };

  const job = await db.job.findUnique({
    where: { id: jobId },
    include: { client: true },
  });
  if (!job) return { success: false, error: "Job not found" };
  if (!job.holdPaymentIntentId) {
    return { success: false, error: "No hold on this booking" };
  }
  if (job.holdCapturedAt) {
    return { success: false, error: "Hold already captured — cannot release" };
  }
  if (job.holdReleasedAt) {
    return { success: false, error: "Already released" };
  }

  try {
    await stripe.paymentIntents.cancel(job.holdPaymentIntentId, {
      cancellation_reason: "requested_by_customer",
    });
    const now = new Date();
    await db.$transaction([
      db.job.update({
        where: { id: jobId },
        data: { holdReleasedAt: now },
      }),
      db.jobLog.create({
        data: {
          jobId,
          userId: gate.userId,
          action: "NOTE_ADDED",
          description: reason?.trim()
            ? `Card hold released (${reason.trim()}).`
            : "Card hold released.",
        },
      }),
    ]);
    if (job.client?.email) {
      sendCustomerHoldReleased({
        to: job.client.email,
        clientName: job.client.name,
        jobNumber: job.jobNumber,
      }).catch((e) => console.error("hold-released email", e));
    }
    revalidatePath(`/admin/jobs/${jobId}`);
    return { success: true };
  } catch (err) {
    const msg =
      (err as { raw?: { message?: string }; message?: string })?.raw?.message ??
      (err as { message?: string })?.message ??
      "Release failed";
    return { success: false, error: msg };
  }
}
