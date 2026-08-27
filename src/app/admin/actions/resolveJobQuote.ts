"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { issueRefund } from "./issueRefund";
import { logActivity } from "@/lib/activity-log";
import { resolveDepositCredit } from "@/lib/booking-deposit";
import {
  isDepositDisposition,
  type DepositDisposition,
} from "@/lib/quote-status";
import { HOLD_REASON } from "@/lib/job-hold";

/**
 * Accept or decline a sent quote (PDF #9, Stage 11, steps 11.4 + 11.6).
 *
 * ## Acceptance is a MANUAL flip — decision D10, recommended default
 *
 * There is no customer-facing accept link yet. The quote email asks the customer
 * to reply or call, and an admin records their answer here. The alternative — a
 * tokenised accept link into the customer portal — is a follow-up, and building
 * it now would have delayed every other part of this stage behind an
 * authentication surface nobody has asked for yet.
 *
 * On ACCEPTED the job stops being a quote and becomes ordinary work: it is
 * scheduled (or left flexible, as booked), which is the moment the cleaner-facing
 * guards let it through. Nothing about the price is touched — that was settled by
 * `sendJobQuote`, and the customer accepted THAT number.
 *
 * ## The deposit on decline is a CHOICE, never a default — decision D11
 *
 * PDF #9 asks for "clear refund / keep / adjust options". This action ships all
 * three and picks none: `disposition` is required on the DECLINED path, so an
 * admin cannot decline a quote without saying what happens to the customer's
 * money. Automating it either way would be this codebase deciding a commercial
 * policy the owner has not stated.
 *
 * KEEP moves no money at all — it records the decision and the reason, which is
 * the whole point: the customer may ask, and "we kept your $200" needs an author
 * and a date next to it.
 */

interface ResolveJobQuoteInput {
  jobId: string;
  decision: "ACCEPTED" | "DECLINED";
  /** Required when declining (D11). Ignored on the accept path. */
  disposition?: DepositDisposition;
  /** Required for PARTIAL — the amount to send back, capped at the remaining deposit. */
  refundAmount?: number;
  /** Why. Required for KEEP and PARTIAL, so the record can answer the customer. */
  reason?: string;
}

export async function resolveJobQuote(input: ResolveJobQuoteInput) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };
    const role = (session.user as { role?: string }).role;
    // OWNER/ADMIN only — this decides whether a customer gets their deposit back.
    if (role !== "OWNER" && role !== "ADMIN") {
      return { success: false, error: "Not authorized" };
    }
    if (!input.jobId) return { success: false, error: "Missing jobId" };
    if (input.decision !== "ACCEPTED" && input.decision !== "DECLINED") {
      return { success: false, error: "Unknown decision" };
    }

    const job = await db.job.findUnique({
      where: { id: input.jobId },
      select: {
        id: true,
        jobNumber: true,
        quoteStatus: true,
        status: true,
        isFlexible: true,
        depositPaid: true,
        depositAmount: true,
        depositPaymentIntentId: true,
        refundedAmount: true,
        totalAmount: true,
      },
    });
    if (!job) return { success: false, error: "Job not found" };

    // A quote must have been SENT before it can be answered. Accepting a
    // PENDING_REVIEW job would schedule work at a provisional estimate the
    // customer was explicitly told was not the price.
    if (job.quoteStatus !== "QUOTED") {
      return {
        success: false,
        error:
          job.quoteStatus === "PENDING_REVIEW"
            ? "Send the final quote before recording the customer's answer."
            : job.quoteStatus
              ? `This quote is already ${job.quoteStatus.toLowerCase().replace("_", " ")}.`
              : "This job isn't a quote request.",
      };
    }

    /* ------------------------------- ACCEPTED ------------------------------ */
    if (input.decision === "ACCEPTED") {
      await db.$transaction(async (tx) => {
        const __t0 = await tx.job.update({
            where: { id: job.id },
            data: {
              quoteStatus: "ACCEPTED",
              // Back onto the normal ladder. `isFlexible` is respected exactly as
              // `submitBooking` would have: a flexible booking stays CREATED for an
              // admin to time, a dated one becomes SCHEDULED. Only ever promoted
              // from CREATED — if an admin has already moved the job on (assigned
              // and started it, say), accepting the quote must not drag it back.
              ...(job.status === "CREATED" && !job.isFlexible
                ? { status: "SCHEDULED" as const, holdReason: null }
                : {}),
              // Round 4, fix 6. A flexible quote stays on hold — but the reason
              // it is held has just CHANGED: it is no longer waiting on a price,
              // it is waiting on a date. Leaving "Quote pending review" on the
              // row would send an admin back to a panel that has nothing left to
              // do, which is exactly the kind of stale hold this fix removes.
              ...(job.status === "CREATED" && job.isFlexible
                ? { holdReason: HOLD_REASON.FLEXIBLE_DATE }
                : {}),
            },
          });
        const __t1 = await tx.jobLog.create({
            data: {
              jobId: job.id,
              userId: session.user.id,
              action: "UPDATED",
              field: "quoteStatus",
              oldValue: "QUOTED",
              newValue: "ACCEPTED",
              description: `Customer accepted the quote${
                input.reason?.trim() ? `: ${input.reason.trim()}` : ""
              }. Job is now schedulable and visible to cleaners.`,
            },
          });
        return [__t0, __t1];
      });

      await logActivity({
        category: "BOOKING",
        action: "job.quote_accepted",
        actorId: session.user.id,
        targetType: "job",
        targetId: job.id,
        amount: job.totalAmount,
        message: `Quote accepted on job #${job.jobNumber}.`,
      });

      revalidatePath(`/admin/jobs/${job.id}`);
      revalidatePath("/admin/jobs");
      revalidatePath("/admin/web-bookings");
      return { success: true, quoteStatus: "ACCEPTED" as const };
    }

    /* ------------------------------- DECLINED ------------------------------ */
    if (!isDepositDisposition(input.disposition)) {
      // Refused rather than defaulted (D11). An admin who has not said what
      // happens to the deposit has not finished declining the quote.
      return {
        success: false,
        error:
          "Choose what happens to the deposit: refund it, keep it, or refund part of it.",
      };
    }
    const disposition = input.disposition;
    const reason = input.reason?.trim() || null;

    const depositPaid = resolveDepositCredit(job);
    const alreadyRefunded = job.refundedAmount ?? 0;
    const depositRemaining = Math.max(0, depositPaid - alreadyRefunded);

    if (disposition !== "KEEP" && depositRemaining <= 0.001) {
      return {
        success: false,
        error: job.depositPaid
          ? "This deposit has already been refunded in full."
          : "No deposit was collected on this booking, so there's nothing to refund.",
      };
    }
    if ((disposition === "KEEP" || disposition === "PARTIAL") && !reason) {
      // The reason is the record. "We kept your deposit" with no stated why is
      // exactly the thing an admin will be asked about in three months.
      return {
        success: false,
        error: "Add a short reason — it's recorded on the booking.",
      };
    }

    let refundTarget = 0;
    if (disposition === "REFUND") {
      refundTarget = depositRemaining;
    } else if (disposition === "PARTIAL") {
      const amount = Number(input.refundAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return { success: false, error: "Enter an amount above $0 to refund." };
      }
      if (amount > depositRemaining + 0.001) {
        return {
          success: false,
          error: `You can refund at most $${depositRemaining.toFixed(2)} of this deposit.`,
        };
      }
      refundTarget = Math.round(amount * 100) / 100;
    }

    // The status flip lands FIRST, and unconditionally.
    //
    // The refund below talks to Stripe and can fail for reasons that have nothing
    // to do with the customer's answer (a network blip, a card issuer). If the two
    // were ordered the other way, a Stripe failure would leave the quote sitting
    // in QUOTED — reading to the next admin as "waiting on the customer" for a
    // quote the customer has already turned down. Recording the decision and
    // reporting a failed refund is the honest pair.
    await db.$transaction(async (tx) => {
      const __t0 = await tx.job.update({
          where: { id: job.id },
          data: {
            quoteStatus: "DECLINED",
            // Round 4, fix 6 — the hold outlives the quote, so its reason has to
            // move on with it. "Quote pending review" on a declined booking sends
            // the next admin to a panel with nothing left to decide.
            ...(job.status === "CREATED"
              ? { holdReason: HOLD_REASON.QUOTE_DECLINED }
              : {}),
          },
        });
      const __t1 = await tx.jobLog.create({
          data: {
            jobId: job.id,
            userId: session.user.id,
            action: "UPDATED",
            field: "quoteStatus",
            oldValue: "QUOTED",
            newValue: "DECLINED",
            description:
              `Customer declined the quote. Deposit ($${depositPaid.toFixed(2)}): ` +
              (disposition === "REFUND"
                ? `refunding $${refundTarget.toFixed(2)} in full`
                : disposition === "PARTIAL"
                  ? `refunding $${refundTarget.toFixed(2)} of $${depositRemaining.toFixed(2)} remaining`
                  : "kept, no refund issued") +
              (reason ? ` — ${reason}` : ""),
          },
        });
      return [__t0, __t1];
    });

    // `issueRefund` is the ONE refund path: it picks the Stripe PI (falling back
    // to the deposit intent when there is no full charge — which is every quote
    // that was declined before any work), caps the amount, writes the negative
    // revenue Transaction, and emails the customer. Reimplementing any of that
    // here is how a refund stops appearing on the P&L.
    let refund: { success: boolean; error?: string } | null = null;
    if (refundTarget > 0) {
      refund = await issueRefund({
        jobId: job.id,
        amount: refundTarget,
        reason: reason ?? "Post-construction quote declined",
      });
    }

    await logActivity({
      category: "REFUND",
      action: "job.quote_declined",
      status: refund && !refund.success ? "FAILED" : "SUCCESS",
      actorId: session.user.id,
      targetType: "job",
      targetId: job.id,
      amount: refundTarget,
      error: refund?.error ?? null,
      message: `Quote declined on job #${job.jobNumber} — deposit ${disposition.toLowerCase()}${
        refundTarget > 0 ? ` ($${refundTarget.toFixed(2)})` : ""
      }.`,
      metadata: { disposition, depositPaid, depositRemaining, reason },
    });

    revalidatePath(`/admin/jobs/${job.id}`);
    revalidatePath("/admin/jobs");
    revalidatePath("/admin/web-bookings");

    return {
      success: true,
      quoteStatus: "DECLINED" as const,
      refundIssued: refundTarget > 0 && refund?.success === true,
      refundAmount: refundTarget,
      // Surfaced, not swallowed: the decline is recorded either way, and the
      // admin needs to know the money did not move so they can retry it.
      warning:
        refund && !refund.success
          ? `The decline was recorded, but the refund failed: ${
              refund.error ?? "unknown error"
            }`
          : null,
    };
  } catch (error) {
    console.error("resolveJobQuote error:", error);
    return { success: false, error: "Failed to record the quote decision" };
  }
}
