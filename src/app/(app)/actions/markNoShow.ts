"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { stripe } from "@/lib/stripe";
import { sendCustomerNoShowFee } from "@/lib/email";
import { getSetting } from "@/lib/settings";

/**
 * Admin action: customer was a no-show for the booking. Charges the
 * configured no-show fee to the saved card, records the no-show on the
 * Client (count + timestamp = the "automatic 1 star" black mark), logs
 * it on the Job, and emails the customer.
 *
 * Safe to call once per job — `noShowAt` is set on success and re-runs
 * short-circuit.
 */
export async function markNoShow(jobId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { success: false, error: "Not authorized" };
  }

  const job = await db.job.findUnique({
    where: { id: jobId },
    include: { client: true },
  });
  if (!job) return { success: false, error: "Job not found" };
  if (job.noShowAt) return { success: false, error: "Already marked no-show" };

  const client = job.client;
  if (!client) return { success: false, error: "No client on this job" };

  const feeUsd = await getSetting("scheduling.noShowFeeUsd");
  const amountCents = Math.round(feeUsd * 100);

  let chargeOutcome: "charged" | "no_card_on_file" | "stripe_failed" = "charged";
  let paymentIntentId: string | undefined;
  let chargeError: string | undefined;

  if (client.stripeCustomerId && client.defaultPaymentMethodId) {
    try {
      const pi = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: "cad",
        customer: client.stripeCustomerId,
        payment_method: client.defaultPaymentMethodId,
        off_session: true,
        confirm: true,
        description: `Cleano no-show fee — job #${job.jobNumber}`,
        metadata: {
          jobId,
          jobNumber: String(job.jobNumber),
          feeType: "no_show",
        },
      });
      paymentIntentId = pi.id;
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

  const now = new Date();

  await db.$transaction([
    db.job.update({
      where: { id: jobId },
      data: { noShowAt: now },
    }),
    db.client.update({
      where: { id: client.id },
      data: {
        noShowCount: { increment: 1 },
        lastNoShowAt: now,
      },
    }),
    db.jobLog.create({
      data: {
        jobId,
        userId: session.user.id,
        action: "NOTE_ADDED",
        description:
          chargeOutcome === "charged"
            ? `No-show recorded. $${feeUsd.toFixed(2)} charged via Stripe (PI: ${paymentIntentId}). Automatic 1-star noted on client profile.`
            : chargeOutcome === "no_card_on_file"
              ? `No-show recorded. No card on file for fee — please collect manually. Automatic 1-star noted on client profile.`
              : `No-show recorded. Stripe charge FAILED: ${chargeError}. Automatic 1-star noted on client profile.`,
      },
    }),
    ...(chargeOutcome === "charged"
      ? [
          db.transaction.create({
            data: {
              date: now,
              category: "REVENUE" as const,
              amount: feeUsd,
              description: `No-show fee — job #${job.jobNumber}`,
              jobId,
              source: "CREDIT_CARD" as const,
              isAuto: true,
            },
          }),
        ]
      : []),
  ]);

  if (client.email) {
    sendCustomerNoShowFee({
      to: client.email,
      clientName: client.name,
      jobNumber: job.jobNumber,
      feeUsd,
    }).catch((e) => console.error("no-show email", e));
  }

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/jobs");

  return {
    success: true,
    chargeOutcome,
    chargeError,
    feeUsd,
  };
}
