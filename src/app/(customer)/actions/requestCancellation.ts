"use server";

import { db } from "@/lib/org-db";
import { resolveChargePaymentMethod } from "@/lib/payment-methods";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { stripe } from "@/lib/stripe";
import {
  sendAdminBookingCancellationRequest,
  sendCustomerFeesCharged,
} from "@/lib/email";
import { getSetting } from "@/lib/settings";
import { logContactCancellation } from "@/lib/crm";
import { requireBudgetCategoryId } from "@/lib/budget-categories";

// Per spec: cancellation requests are flagged for admin review — never auto-cancel.
// If the request lands inside the late-cancellation window, the configured fee
// is charged off-session to the saved card at request time.
export async function requestCancellation(jobId: string, reason?: string) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };

    const email = session.user.email?.toLowerCase();
    if (!email) return { success: false, error: "Session has no email" };

    const job = await db.job.findUnique({
      where: { id: jobId },
      include: { client: true },
    });
    if (!job) return { success: false, error: "Booking not found" };
    if (job.client?.email?.toLowerCase() !== email) {
      return { success: false, error: "Not authorized" };
    }
    if (
      job.status === "CANCELLED" ||
      job.status === "COMPLETED" ||
      job.status === "PAID"
    ) {
      return {
        success: false,
        error: "This booking can no longer be cancelled online — please contact us.",
      };
    }

    const now = new Date();
    const client = job.client;

    // Late-cancellation fee: charge once, only inside the window, only when a
    // card is on file and we haven't already charged for this job.
    const cancellationWindowHours = await getSetting(
      "policy.cancellationFeeWindowHours"
    );
    const msUntilStart = job.startTime.getTime() - now.getTime();
    const withinFeeWindow =
      msUntilStart < cancellationWindowHours * 60 * 60 * 1000;

    let chargeOutcome:
      | "charged"
      | "no_card_on_file"
      | "stripe_failed"
      | "not_applicable"
      | "already_charged" = "not_applicable";
    let chargeError: string | undefined;
    let feePaymentIntentId: string | undefined;
    const feeUsd = await getSetting("policy.cancellationFeeUsd");
    const amountCents = Math.round(feeUsd * 100);

    if (withinFeeWindow && job.cancellationFeeChargedAt) {
      chargeOutcome = "already_charged";
    } else if (withinFeeWindow) {
      // Charge the cancellation fee on the card the booking was pinned to.
      const feeCard = client
        ? await resolveChargePaymentMethod({
            clientId: client.id,
            pinnedPaymentMethodId: job.stripePaymentMethodId,
            clientDefaultPaymentMethodId: client.defaultPaymentMethodId,
          })
        : null;
      if (client?.stripeCustomerId && feeCard) {
        try {
          const pi = await stripe.paymentIntents.create({
            amount: amountCents,
            currency: "cad",
            customer: client.stripeCustomerId,
            payment_method: feeCard,
            off_session: true,
            confirm: true,
            description: `Cleano late-cancellation fee — job #${job.jobNumber}`,
            metadata: {
              jobId,
              jobNumber: String(job.jobNumber),
              feeType: "cancellation",
            },
          });
          feePaymentIntentId = pi.id;
          chargeOutcome = "charged";
        } catch (err) {
          chargeOutcome = "stripe_failed";
          chargeError =
            (err as { raw?: { message?: string }; message?: string })?.raw
              ?.message ??
            (err as { message?: string })?.message ??
            "Stripe charge failed";
        }
      } else {
        chargeOutcome = "no_card_on_file";
      }
    }

    const feeNote =
      chargeOutcome === "charged"
        ? ` Late-cancellation fee of $${feeUsd.toFixed(2)} charged via Stripe (PI: ${feePaymentIntentId}).`
        : chargeOutcome === "no_card_on_file"
          ? ` Within ${cancellationWindowHours}h window but no card on file — collect $${feeUsd.toFixed(2)} fee manually.`
          : chargeOutcome === "stripe_failed"
            ? ` Within ${cancellationWindowHours}h window — fee charge FAILED: ${chargeError}. Collect $${feeUsd.toFixed(2)} manually.`
            : chargeOutcome === "already_charged"
              ? ` Late-cancellation fee already charged for this booking.`
              : "";

    const revenueCategoryId = await requireBudgetCategoryId("revenue");

    await db.$transaction(async (tx) => {
      await tx.job.update({
        where: { id: jobId },
        data: {
          cancellationRequestedAt: now,
          ...(reason?.trim() ? { cancellationReason: reason.trim() } : {}),
          ...(chargeOutcome === "charged"
            ? {
                cancellationFeeChargedAt: now,
                cancellationFeePaymentIntentId: feePaymentIntentId,
              }
            : {}),
        },
      });
      await tx.jobLog.create({
        data: {
          jobId,
          userId: session.user.id,
          action: "NOTE_ADDED",
          description: `Cancellation requested by client.${
            reason?.trim() ? ` Reason: ${reason.trim()}.` : ""
          }${feeNote}`,
        },
      });
      // Only a fee that actually cleared becomes revenue.
      if (chargeOutcome === "charged") {
        await tx.transaction.create({
          data: {
            date: now,
            categoryId: revenueCategoryId,
            amount: feeUsd,
            description: `Late-cancellation fee — job #${job.jobNumber}`,
            jobId,
            source: "CREDIT_CARD" as const,
            isAuto: true,
          },
        });
      }
    });

    // §7: log the cancellation on the CRM contact timeline (no downgrade).
    if (job.clientId) {
      await logContactCancellation(
        job.clientId,
        `Cancellation requested for booking #${job.jobNumber}${
          reason?.trim() ? ` — ${reason.trim()}` : ""
        }`
      );
    }

    // Notify all admins (gated by Settings → Notifications).
    sendAdminBookingCancellationRequest({
      jobId,
      jobNumber: job.jobNumber,
      clientName: job.clientName,
      startTime: job.startTime.toISOString(),
      address: job.location ?? "",
      serviceType: job.jobType,
    }).catch((e) => console.error("admin cancellation-request email", e));

    if (chargeOutcome === "charged" && client?.email) {
      sendCustomerFeesCharged({
        to: client.email,
        clientName: client.name,
        jobId,
        jobNumber: job.jobNumber,
        feeType: "cancellation",
        amount: feeUsd,
      }).catch((e) => console.error("cancellation-fee email", e));
    }

    revalidatePath("/");
    revalidatePath("/bookings");
    return {
      success: true,
      feeCharged: chargeOutcome === "charged",
      feeUsd: chargeOutcome === "charged" ? feeUsd : undefined,
    };
  } catch (error) {
    console.error("Error requesting cancellation:", error);
    return { success: false, error: "Failed to submit request" };
  }
}
