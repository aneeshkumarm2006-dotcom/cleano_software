"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { stripe } from "@/lib/stripe";
import { logActivity } from "@/lib/activity-log";
import { resolveChargePaymentMethod } from "@/lib/payment-methods";
import { resolveAmountDue } from "@/lib/job-billing";
import { requireBudgetCategoryId } from "@/lib/budget-categories";
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

  // Was `(job.price ?? 0) - (job.discountAmount ?? 0)`, which billed admin jobs
  // pre-tax, subtracted a web booking's referral credit a second time, and
  // ignored the $20 deposit the customer was told would come off. See
  // lib/job-billing.ts for the full account.
  const totalAmount = resolveAmountDue(job);
  if (totalAmount <= 0) {
    return { success: false, error: "Invalid charge amount" };
  }

  // Auto-apply gift card balance before hitting Stripe. We draw the
  // balance down to zero (or until the booking total is satisfied),
  // whichever comes first.
  const giftCardApplied = Math.min(client.giftCardBalance, totalAmount);
  const remainingDue = Math.max(0, totalAmount - giftCardApplied);
  const amountCents = Math.round(remainingDue * 100);

  // Round 4, fix 1. Charging a card is a PAYMENT event, not a completion one.
  // Pre-charging a booking a week out used to stamp it PAID — a done status —
  // so it landed in the Completed tab with a green pill (IMG-1) before anyone
  // had cleaned anything. A future job records the payment and keeps its
  // current lifecycle status; only a job that has actually happened moves to
  // PAID. `paidAt` and `paymentReceived` are unaffected either way.
  const isFuture =
    !job.clockOutTime && new Date(job.startTime).getTime() > Date.now();
  const paidStatus = isFuture ? {} : { status: "PAID" as const };

  // Atomically claim this job so two concurrent charges (a double-click or two
  // admins) can't both reach Stripe. Only the call that flips paymentReceived
  // false→true proceeds; the rest abort. Rolled back if the charge fails.
  const claim = await db.job.updateMany({
    // An archived job is not chargeable (new fix list item 1).
    where: { id: jobId, deletedAt: null, paymentReceived: false },
    data: { paymentReceived: true, paidAt: new Date(), ...paidStatus },
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
          // Undo the claim's status flip — back to the pre-charge status. A
          // future job's claim never touched `status`, so there is nothing to
          // undo and writing one back would invent a transition.
          ...(isFuture
            ? {}
            : { status: job.status === "PAID" ? "COMPLETED" : job.status }),
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

  // Resolved once for both branches below — every posting this action makes is
  // revenue, and the id must be in hand before the $transaction array is built.
  const revenueCategoryId = await requireBudgetCategoryId("revenue");

  // If gift card credit covers the booking entirely, skip Stripe.
  if (amountCents === 0) {
    try {
    await db.$transaction(async (tx) => {
      const __t0 = await tx.job.update({
          where: { id: jobId },
          // Same date guard as the claim above — a gift card covering a future
          // booking is still a payment, not a completion.
          data: { paymentReceived: true, paidAt: new Date(), ...paidStatus },
        });
      const __t1 = await tx.client.update({
          where: { id: client.id },
          data: { giftCardBalance: { decrement: giftCardApplied } },
        });
      const __t2 = await tx.transaction.create({
          data: {
            date: new Date(),
            categoryId: revenueCategoryId,
            amount: giftCardApplied,
            description: `Gift card credit applied — job #${job.jobNumber}`,
            jobId,
            source: "GIFT_CARD",
            isAuto: true,
          },
        });
      const __t3 = await tx.jobLog.create({
          data: {
            jobId,
            userId: session.user.id,
            action: "PAYMENT_RECEIVED",
            description: `Booking fully covered by gift card credit ($${giftCardApplied.toFixed(2)}).`,
          },
        });
      return [__t0, __t1, __t2, __t3];
    });
    } catch (e) {
      console.error("gift-card charge tx", e);
      await releaseClaim();
      return { success: false, error: "Failed to apply gift card credit" };
    }

    // Receipt — gated by the per-booking notifyClient toggle.
    if (job.notifyClient) queueAndSendReceipt(jobId).catch(() => {});

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

    revalidatePath(`/admin/jobs/${jobId}`);
    revalidatePath("/admin/jobs");
    revalidatePath("/admin/finances");
    return {
      success: true,
      amount: totalAmount,
      giftCardApplied,
      stripeCharged: 0,
    };
  }

  // Stripe path is required for the remaining amount. Charge the card this
  // booking was pinned to at confirmation, falling back to the client's current
  // default for jobs that predate pinning or whose pinned card is gone.
  const chargeCard = await resolveChargePaymentMethod({
    clientId: client.id,
    pinnedPaymentMethodId: job.stripePaymentMethodId,
    clientDefaultPaymentMethodId: client.defaultPaymentMethodId,
  });
  if (!client.stripeCustomerId || !chargeCard) {
    await releaseClaim();
    return { success: false, error: "No saved card on file for this client" };
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "cad",
      customer: client.stripeCustomerId,
      payment_method: chargeCard,
      off_session: true,
      confirm: true,
      description: `Cleano job #${job.jobNumber} — ${job.jobType ?? "cleaning"}`,
      metadata: { jobId, jobNumber: String(job.jobNumber) },
    });

    const stripeAmount = amountCents / 100;
    await db.$transaction(async (tx) => {
      await tx.job.update({
        where: { id: jobId },
        data: {
          paymentReceived: true,
          paidAt: new Date(),
          stripePaymentIntentId: paymentIntent.id,
        },
      });
      // Decrement gift card balance if used.
      if (giftCardApplied > 0) {
        await tx.client.update({
          where: { id: client.id },
          data: { giftCardBalance: { decrement: giftCardApplied } },
        });
        await tx.transaction.create({
          data: {
            date: new Date(),
            categoryId: revenueCategoryId,
            amount: giftCardApplied,
            description: `Gift card credit applied — job #${job.jobNumber}`,
            jobId,
            source: "GIFT_CARD" as const,
            isAuto: true,
          },
        });
      }
      await tx.transaction.create({
        data: {
          date: new Date(),
          categoryId: revenueCategoryId,
          amount: stripeAmount,
          description: `Stripe charge — job #${job.jobNumber}`,
          jobId,
          source: "CREDIT_CARD",
          isAuto: true,
        },
      });
      await tx.jobLog.create({
        data: {
          jobId,
          userId: session.user.id,
          action: "PAYMENT_RECEIVED",
          description: giftCardApplied > 0
            ? `Charged $${stripeAmount.toFixed(2)} via Stripe + $${giftCardApplied.toFixed(2)} gift card credit (PI: ${paymentIntent.id}).`
            : `Charged $${stripeAmount.toFixed(2)} via Stripe (PI: ${paymentIntent.id}).`,
        },
      });
    });

    // Receipt — gated by the per-booking notifyClient toggle.
    if (job.notifyClient) queueAndSendReceipt(jobId).catch(() => {});

    // Customer "booking charged" notification (separate from the receipt;
    // gated by `cust.fee.booking_charged` + per-booking notifyClient).
    if (job.notifyClient && client.email) {
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

    revalidatePath(`/admin/jobs/${jobId}`);
    revalidatePath("/admin/jobs");
    revalidatePath("/admin/finances");

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

    revalidatePath(`/admin/jobs/${jobId}`);
    return { success: false, error: failureReason };
  }
}
