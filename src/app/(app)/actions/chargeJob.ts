"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { stripe } from "@/lib/stripe";
import { logActivity } from "@/lib/activity-log";
import {
  queueAndSendReceipt,
  sendCustomerBookingCharged,
  sendCustomerCardDeclined,
  sendAdminCardDeclined,
} from "@/lib/email";

export async function chargeJob(jobId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };

  const role = (session.user as any).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { success: false, error: "Not authorized" };
  }

  const job = await db.job.findUnique({
    where: { id: jobId },
    include: { client: true },
  });

  if (!job) return { success: false, error: "Job not found" };
  if (job.paymentReceived) return { success: false, error: "Already paid" };
  if (job.isCashJob) return { success: false, error: "This is a cash job — mark payment manually" };

  const client = job.client;
  if (!client) return { success: false, error: "No client on this job" };

  const totalAmount = (job.price ?? 0) - (job.discountAmount ?? 0);
  if (totalAmount <= 0) {
    return { success: false, error: "Invalid charge amount" };
  }

  // Auto-apply gift card balance before hitting Stripe. We draw the
  // balance down to zero (or until the booking total is satisfied),
  // whichever comes first.
  const giftCardApplied = Math.min(client.giftCardBalance, totalAmount);
  const remainingDue = Math.max(0, totalAmount - giftCardApplied);
  const amountCents = Math.round(remainingDue * 100);

  // Atomically claim this job so two concurrent charges (a double-click or two
  // admins) can't both reach Stripe. Only the call that flips paymentReceived
  // false→true proceeds; the rest abort. Rolled back if the charge fails.
  const claim = await db.job.updateMany({
    where: { id: jobId, paymentReceived: false },
    data: { paymentReceived: true, paidAt: new Date() },
  });
  if (claim.count === 0) {
    return { success: false, error: "Already paid" };
  }

  const releaseClaim = async (failureReason?: string) => {
    await db.job
      .updateMany({
        where: { id: jobId },
        data: {
          paymentReceived: false,
          paidAt: null,
          ...(failureReason
            ? {
                paymentFailedAt: new Date(),
                paymentFailureReason: failureReason,
              }
            : {}),
        },
      })
      .catch(() => {});
  };

  // If gift card credit covers the booking entirely, skip Stripe.
  if (amountCents === 0) {
    try {
    await db.$transaction([
      db.job.update({
        where: { id: jobId },
        data: { paymentReceived: true, paidAt: new Date() },
      }),
      db.client.update({
        where: { id: client.id },
        data: { giftCardBalance: { decrement: giftCardApplied } },
      }),
      db.transaction.create({
        data: {
          date: new Date(),
          category: "REVENUE",
          amount: giftCardApplied,
          description: `Gift card credit applied — job #${job.jobNumber}`,
          jobId,
          source: "GIFT_CARD",
          isAuto: true,
        },
      }),
      db.jobLog.create({
        data: {
          jobId,
          userId: session.user.id,
          action: "PAYMENT_RECEIVED",
          description: `Booking fully covered by gift card credit ($${giftCardApplied.toFixed(2)}).`,
        },
      }),
    ]);
    } catch (e) {
      console.error("gift-card charge tx", e);
      await releaseClaim();
      return { success: false, error: "Failed to apply gift card credit" };
    }

    queueAndSendReceipt(jobId).catch(() => {});

    await logActivity({
      category: "PAYMENT",
      action: "charge_job",
      status: "SUCCESS",
      actorId: session.user.id,
      targetType: "job",
      targetId: jobId,
      amount: totalAmount,
      message: `Job #${job.jobNumber} fully covered by gift-card credit ($${giftCardApplied.toFixed(2)}).`,
    });

    revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/jobs");
    revalidatePath("/finances");
    return {
      success: true,
      amount: totalAmount,
      giftCardApplied,
      stripeCharged: 0,
    };
  }

  // Stripe path is required for the remaining amount.
  if (!client.stripeCustomerId || !client.defaultPaymentMethodId) {
    await releaseClaim();
    return { success: false, error: "No saved card on file for this client" };
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "cad",
      customer: client.stripeCustomerId,
      payment_method: client.defaultPaymentMethodId,
      off_session: true,
      confirm: true,
      description: `Cleano job #${job.jobNumber} — ${job.jobType ?? "cleaning"}`,
      metadata: { jobId, jobNumber: String(job.jobNumber) },
    });

    const stripeAmount = amountCents / 100;
    await db.$transaction([
      db.job.update({
        where: { id: jobId },
        data: {
          paymentReceived: true,
          paidAt: new Date(),
          stripePaymentIntentId: paymentIntent.id,
        },
      }),
      // Decrement gift card balance if used.
      ...(giftCardApplied > 0
        ? [
            db.client.update({
              where: { id: client.id },
              data: { giftCardBalance: { decrement: giftCardApplied } },
            }),
            db.transaction.create({
              data: {
                date: new Date(),
                category: "REVENUE" as const,
                amount: giftCardApplied,
                description: `Gift card credit applied — job #${job.jobNumber}`,
                jobId,
                source: "GIFT_CARD" as const,
                isAuto: true,
              },
            }),
          ]
        : []),
      db.transaction.create({
        data: {
          date: new Date(),
          category: "REVENUE",
          amount: stripeAmount,
          description: `Stripe charge — job #${job.jobNumber}`,
          jobId,
          source: "CREDIT_CARD",
          isAuto: true,
        },
      }),
      db.jobLog.create({
        data: {
          jobId,
          userId: session.user.id,
          action: "PAYMENT_RECEIVED",
          description: giftCardApplied > 0
            ? `Charged $${stripeAmount.toFixed(2)} via Stripe + $${giftCardApplied.toFixed(2)} gift card credit (PI: ${paymentIntent.id}).`
            : `Charged $${stripeAmount.toFixed(2)} via Stripe (PI: ${paymentIntent.id}).`,
        },
      }),
    ]);

    queueAndSendReceipt(jobId).catch(() => {});

    // Customer "booking charged" notification (separate from the receipt;
    // gated by `cust.fee.booking_charged`).
    if (client.email) {
      sendCustomerBookingCharged({
        to: client.email,
        clientName: client.name,
        jobId,
        jobNumber: job.jobNumber,
        amount: stripeAmount,
        paymentMethod: "Card on file",
      }).catch((e) => console.error("customer booking-charged email", e));
    }

    await logActivity({
      category: "PAYMENT",
      action: "charge_job",
      status: "SUCCESS",
      actorId: session.user.id,
      targetType: "job",
      targetId: jobId,
      amount: totalAmount,
      providerId: paymentIntent.id,
      message: `Job #${job.jobNumber} charged $${stripeAmount.toFixed(2)} via Stripe${giftCardApplied > 0 ? ` + $${giftCardApplied.toFixed(2)} gift-card credit` : ""}.`,
    });

    revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/jobs");
    revalidatePath("/finances");

    return {
      success: true,
      amount: totalAmount,
      giftCardApplied,
      stripeCharged: stripeAmount,
    };
  } catch (err: any) {
    const failureReason = err?.raw?.message ?? err?.message ?? "Charge failed";

    // Roll back the claim so the job isn't stuck "paid" and can be retried.
    await releaseClaim(failureReason);

    await logActivity({
      category: "PAYMENT",
      action: "charge_job",
      status: "FAILED",
      actorId: session.user.id,
      targetType: "job",
      targetId: jobId,
      amount: amountCents / 100,
      error: failureReason,
      message: `Job #${job.jobNumber} charge declined.`,
    });

    // Notify admin + customer of the declined card (gated by toggles).
    sendAdminCardDeclined({
      jobId,
      jobNumber: job.jobNumber,
      clientName: job.clientName,
      reason: failureReason,
      amountAttempted: amountCents / 100,
      context: "charge",
    }).catch((e) => console.error("admin card-declined email", e));
    if (client.email) {
      sendCustomerCardDeclined({
        to: client.email,
        clientName: client.name,
        jobId,
        jobNumber: job.jobNumber,
        reason: failureReason,
        context: "charge",
      }).catch((e) => console.error("customer card-declined email", e));
    }

    revalidatePath(`/jobs/${jobId}`);
    return { success: false, error: failureReason };
  }
}
