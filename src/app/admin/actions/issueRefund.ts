"use server";

import { db } from "@/db";
import { stripe } from "@/lib/stripe";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { queueAndSendRefund } from "@/lib/email";
import { applyStrike } from "@/lib/strikes";
import { logActivity } from "@/lib/activity-log";
import { requireBudgetCategoryId } from "@/lib/budget-categories";
import { resolveAmountDue } from "@/lib/job-billing";
import { resolveDepositCredit } from "@/lib/booking-deposit";

interface IssueRefundInput {
  jobId: string;
  amount: number;
  reason?: string;
}

export async function issueRefund(input: IssueRefundInput) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };
    const role = (session.user as { role?: string }).role;
    if (role !== "OWNER" && role !== "ADMIN") {
      return { success: false, error: "Not authorized" };
    }
    if (!input.jobId) return { success: false, error: "Missing jobId" };
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      return { success: false, error: "Refund amount must be positive" };
    }

    const job = await db.job.findUnique({
      where: { id: input.jobId },
      include: {
        client: { select: { email: true, name: true } },
        cleaners: { select: { id: true } },
      },
    });
    if (!job) return { success: false, error: "Job not found" };

    // What the customer was actually CHARGED, which is the ceiling a refund
    // can reach — `resolveAmountDue`, the same function `chargeJob` billed with
    // (fix 3). `job.price` is the pre-tax base line: on the $128/$186 grout job
    // it capped refunds at $128 of a $213.85 charge, so a full refund was
    // impossible from either this action or the modal that calls it.
    const totalCharged = resolveAmountDue(job);
    // The deposit that was ACTUALLY charged (Stage 11 / PDF #9). This was a
    // hardcoded `20`, which capped a post-construction refund at $20 of a $200
    // deposit — a declined quote could not be refunded from any surface in the
    // app. `resolveDepositCredit` reads the stored figure and falls back to $20
    // only for rows written before the column existed, which is what those rows
    // really charged.
    const depositAmount = resolveDepositCredit(job);
    const alreadyRefunded = job.refundedAmount ?? 0;

    // Pick the Stripe PI to refund against and the matching ceiling.
    // Prefer the full charge if it exists; otherwise fall back to the deposit.
    let targetPI: string | null = null;
    let cap: number;
    let isDepositRefund = false;
    if (job.stripePaymentIntentId) {
      targetPI = job.stripePaymentIntentId;
      cap = totalCharged - alreadyRefunded;
    } else if (job.depositPaymentIntentId) {
      targetPI = job.depositPaymentIntentId;
      cap = depositAmount - alreadyRefunded;
      isDepositRefund = true;
    } else {
      cap = totalCharged - alreadyRefunded; // manual / cash-only refund record
    }

    const refundableRemaining = Math.max(0, cap);
    if (input.amount > refundableRemaining + 0.001) {
      return {
        success: false,
        error: `Cannot refund more than $${refundableRemaining.toFixed(2)} (already refunded $${alreadyRefunded.toFixed(2)})`,
      };
    }

    let stripeRefundId: string | null = null;
    if (targetPI) {
      try {
        const refund = await stripe.refunds.create({
          payment_intent: targetPI,
          amount: Math.round(input.amount * 100),
          reason: "requested_by_customer",
          metadata: {
            jobId: job.id,
            jobNumber: String(job.jobNumber),
            kind: isDepositRefund ? "deposit" : "charge",
          },
        });
        stripeRefundId = refund.id;
      } catch (stripeErr: any) {
        const msg = stripeErr?.raw?.message ?? stripeErr?.message ?? "Stripe refund failed";
        await logActivity({
          category: "REFUND",
          action: "issue_refund",
          status: "FAILED",
          actorId: session.user.id,
          targetType: "job",
          targetId: input.jobId,
          amount: input.amount,
          error: msg,
          message: `Refund failed on job #${job.jobNumber}.`,
        });
        return { success: false, error: `Stripe error: ${msg}` };
      }
    }

    const refundLabel = isDepositRefund ? "Stripe refund (deposit)" : "Stripe refund";
    const description = stripeRefundId
      ? `${refundLabel} — Job #${job.jobNumber} (refund: ${stripeRefundId})`
      : `Refund — Job #${job.jobNumber}`;

    // A refund is negative revenue, not an expense — same bucket as the
    // original charge, so the two net out on the P&L.
    const revenueCategoryId = await requireBudgetCategoryId("revenue");

    await db.$transaction([
      db.job.update({
        where: { id: input.jobId },
        data: { refundedAmount: alreadyRefunded + input.amount },
      }),
      db.transaction.create({
        data: {
          date: new Date(),
          categoryId: revenueCategoryId,
          amount: -input.amount,
          description,
          notes: input.reason?.trim() || null,
          jobId: input.jobId,
          source: "refund",
          isAuto: true,
        },
      }),
      db.jobLog.create({
        data: {
          jobId: input.jobId,
          userId: session.user.id,
          action: "UPDATED",
          field: "refundedAmount",
          oldValue: String(alreadyRefunded),
          newValue: String(alreadyRefunded + input.amount),
          description: `Refund of $${input.amount.toFixed(2)} issued${input.reason ? `: ${input.reason}` : ""}${stripeRefundId ? ` (Stripe: ${stripeRefundId})` : ""}`,
        },
      }),
      ...(job.client?.email
        ? [
            db.emailLog.create({
              data: {
                kind: "REFUND" as const,
                recipient: job.client.email,
                subject: `Refund processed — Job #${job.jobNumber}`,
                status: "PENDING" as const,
                jobId: input.jobId,
              },
            }),
          ]
        : []),
    ]);

    queueAndSendRefund(input.jobId, input.amount, input.reason).catch(() => {});

    // Accountability strike: a complaint that results in a half or full
    // refund strikes the assigned cleaner(s). Half = >= 50% of the charge.
    const refundedTotal = alreadyRefunded + input.amount;
    if (totalCharged > 0 && refundedTotal >= totalCharged * 0.5) {
      const pct = Math.round((refundedTotal / totalCharged) * 100);
      const cleanerIds = new Set<string>(job.cleaners.map((c) => c.id));
      if (job.employeeId) cleanerIds.add(job.employeeId);
      for (const cleanerId of cleanerIds) {
        await applyStrike({
          cleanerId,
          reasonCode: "REFUND_COMPLAINT",
          detail: `${pct}% refund on job #${job.jobNumber}`,
          jobId: input.jobId,
          dedupePerJob: true,
        }).catch((e) => console.error("refund-complaint strike", e));
      }
    }

    await logActivity({
      category: "REFUND",
      action: "issue_refund",
      status: "SUCCESS",
      actorId: session.user.id,
      targetType: "job",
      targetId: input.jobId,
      amount: input.amount,
      providerId: stripeRefundId,
      message: `Refunded $${input.amount.toFixed(2)} on job #${job.jobNumber}${isDepositRefund ? " (deposit)" : ""}.`,
    });

    revalidatePath(`/admin/jobs/${input.jobId}`);
    revalidatePath("/admin/jobs");
    revalidatePath("/admin/finances");

    return { success: true, refundedTotal: alreadyRefunded + input.amount };
  } catch (error) {
    console.error("Error issuing refund:", error);
    return { success: false, error: "Failed to issue refund" };
  }
}
