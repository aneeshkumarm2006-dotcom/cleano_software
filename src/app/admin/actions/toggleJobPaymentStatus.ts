"use server";

import { db } from "@/lib/org-db";
import type { ScopedTx } from "@/lib/db-scoped";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { queueAndSendReceipt, sendCustomerBookingCharged } from "@/lib/email";
import { getTaxRates } from "@/lib/tax.server";
import { resolveAmountDue } from "@/lib/job-billing";
import { activeSubtotal } from "@/lib/job-money";
import { startOfDayTz } from "@/lib/time";
import { requireBudgetCategoryId } from "@/lib/budget-categories";

export async function togglePaymentReceived(jobId: string) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return { success: false, error: "Not authenticated" };
  }

  // Check if user is admin
  const userRole = (session.user as any).role;
  if (userRole !== "OWNER" && userRole !== "ADMIN") {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const job = await db.job.findUnique({
      where: { id: jobId },
      // `addOns` joins because the revenue Transaction row below is the ACTIVE
      // subtotal now (fix 3), and the base column alone cannot produce it.
      include: { addOns: { select: { name: true, price: true, quantity: true } } },
    });

    if (!job) {
      return { success: false, error: "Job not found" };
    }
    const addOns = job.addOns;

    const newStatus = !job.paymentReceived;

    // Keep the status enum in lockstep with the paymentReceived boolean —
    // "Paid" must never be representable two divergent ways. Un-marking
    // reverts to Completed (past job) or Scheduled (future job); a cancelled
    // job stays cancelled either way.
    //
    // Round 4, fix 1: marking a job paid may no longer move a FUTURE job into
    // PAID. PAID is a lifecycle status — the Completed tab, the Completed
    // count and the green pill all read it — so stamping it on work that has
    // not happened is the very "completion inferred from payment" the PDF
    // rules out. A future job keeps its current status and simply carries
    // `paymentReceived = true`, which the payment column already shows.
    const isFuture =
      !job.clockOutTime && new Date(job.startTime).getTime() > Date.now();
    const syncedStatus = (() => {
      if (job.status === "CANCELLED") return undefined;
      if (newStatus) return isFuture ? undefined : ("PAID" as const);
      return new Date(job.startTime) < startOfDayTz(new Date())
        ? ("COMPLETED" as const)
        : ("SCHEDULED" as const);
    })();

    /**
     * The write, as steps rather than as started queries.
     *
     * This was an array handed to `db.$transaction(ops)`, which the tenant
     * client rejects on purpose (see org-db.ts): the array form needs deferred
     * Prisma promises and this client runs eagerly. Worse than the throw, the
     * eagerness meant each `db.x.y(...)` below had already executed by the time
     * it was pushed, so marking a job paid half-applied and then reported
     * "Failed to update payment status" to the admin who clicked it.
     */
    const ops: ((tx: ScopedTx) => Promise<unknown>)[] = [
      (tx) => tx.job.update({
        where: { id: jobId },
        data: {
          paymentReceived: newStatus,
          ...(syncedStatus ? { status: syncedStatus } : {}),
          paidAt: newStatus ? new Date() : null,
        },
      }),
      // Job → invoice sync (spec item 10): this job's own invoice follows the
      // payment mark. Consolidated multi-job invoices are left alone — one job
      // paid doesn't mean the whole invoice is.
      (tx) => tx.invoice.updateMany({
        where: newStatus
          ? { jobId, deletedAt: null, status: { notIn: ["PAID", "CANCELLED"] } }
          : { jobId, deletedAt: null, status: "PAID" },
        data: newStatus
          ? { status: "PAID", paidAt: new Date() }
          : { status: "SENT", paidAt: null },
      }),
      (tx) => tx.jobLog.create({
        data: {
          jobId,
          userId: session.user.id,
          action: "PAYMENT_RECEIVED",
          field: "paymentReceived",
          oldValue: job.paymentReceived.toString(),
          newValue: newStatus.toString(),
          description: newStatus
            ? `Payment marked as received by ${session.user.name}`
            : `Payment marked as not received by ${session.user.name}`,
        },
      }),
    ];

    // Fix 3 item 3.4 — the revenue Transaction row is the ACTIVE subtotal, not
    // `price − discount`. This row is what the Finances page and the budget
    // actuals read, so an add-on job booked $128 of revenue against a $186 job.
    // `activeSubtotal` is already discount-net in both pricing modes (see
    // metrics-shared.jobRevenue), so the subtraction is not repeated here.
    // Still PRE-TAX with `taxAmount` alongside — that is the shape of every
    // live Transaction row and lib/job-billing.ts records why.
    const revenueAmount = activeSubtotal({ ...job, addOns });
    if (newStatus && revenueAmount > 0) {
      const netAmount = revenueAmount;
      // Cash jobs are tax exempt. Otherwise prefer the GST/QST stored on the
      // job (set at save/booking/import time); only recompute from the current
      // tax.config rates for older rows saved before taxes were persisted —
      // and on the DISCOUNTED subtotal, not the raw price.
      let taxAmount = 0;
      if (!job.isCashJob) {
        const storedTax = (job.gstAmount ?? 0) + (job.qstAmount ?? 0);
        if (storedTax > 0) {
          taxAmount = storedTax;
        } else {
          const rates = await getTaxRates();
          taxAmount =
            (netAmount * rates.gstRate) / 100 + (netAmount * rates.qstRate) / 100;
        }
      }
      // Resolved before the transaction opens: this helper runs its own
      // queries, and those belong outside the transaction that is about to
      // start, not on a connection it is holding.
      const revenueCategoryId = await requireBudgetCategoryId("revenue");
      ops.push((tx) =>
        tx.transaction.create({
          data: {
            date: new Date(),
            categoryId: revenueCategoryId,
            amount: netAmount,
            description: `Revenue from job for ${job.clientName}`,
            jobId: job.id,
            source: job.paymentType ?? null,
            taxAmount,
            isAuto: true,
          },
        })
      );
    } else if (!newStatus) {
      const revenueCategoryId = await requireBudgetCategoryId("revenue");
      ops.push((tx) =>
        tx.transaction.deleteMany({
          where: {
            jobId: job.id,
            categoryId: revenueCategoryId,
            isAuto: true,
          },
        })
      );
    }

    await db.$transaction(async (tx) => {
      for (const op of ops) await op(tx);
    });

    // Send receipt + "booking charged" email when payment is marked received.
    // Gated by the per-booking notifyClient toggle.
    if (newStatus && job.notifyClient) {
      queueAndSendReceipt(jobId).catch(() => {});

      // The receipt has the formal totals; "booking charged" is the simpler
      // confirmation gated by `cust.fee.booking_charged`.
      const fullJob = await db.job.findUnique({
        where: { id: jobId },
        include: { client: { select: { name: true, email: true } } },
      });
      if (fullJob?.client?.email) {
        // What the customer was actually charged, so the email matches the
        // card statement. NOT the Transaction row above, which records pre-tax
        // revenue with taxAmount held separately.
        const amount = resolveAmountDue(fullJob);
        sendCustomerBookingCharged({
          to: fullJob.client.email,
          clientName: fullJob.client.name,
          jobId,
          jobNumber: fullJob.jobNumber,
          amount: amount > 0 ? amount : (fullJob.price ?? 0),
          paymentMethod: fullJob.paymentType ?? "Cash / cheque",
        }).catch((e) => console.error("customer booking-charged (manual)", e));
      }
    }

    revalidatePath(`/admin/jobs/${jobId}`);
    revalidatePath("/admin/jobs");
    revalidatePath("/admin/finances");

    return { success: true, newStatus };
  } catch (error) {
    console.error("Error toggling payment status:", error);
    return { success: false, error: "Failed to update payment status" };
  }
}

export async function toggleInvoiceSent(jobId: string) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return { success: false, error: "Not authenticated" };
  }

  // Check if user is admin
  const userRole = (session.user as any).role;
  if (userRole !== "OWNER" && userRole !== "ADMIN") {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const job = await db.job.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      return { success: false, error: "Job not found" };
    }

    const newStatus = !job.invoiceSent;

    await db.$transaction(async (tx) => {
      const __t0 = await tx.job.update({
          where: { id: jobId },
          data: {
            invoiceSent: newStatus,
          },
        });
      const __t1 = await tx.jobLog.create({
          data: {
            jobId,
            userId: session.user.id,
            action: "INVOICE_SENT",
            field: "invoiceSent",
            oldValue: job.invoiceSent.toString(),
            newValue: newStatus.toString(),
            description: newStatus
              ? `Invoice marked as sent by ${session.user.name}`
              : `Invoice marked as not sent by ${session.user.name}`,
          },
        });
      return [__t0, __t1];
    });

    revalidatePath(`/admin/jobs/${jobId}`);
    revalidatePath("/admin/jobs");

    return { success: true, newStatus };
  } catch (error) {
    console.error("Error toggling invoice status:", error);
    return { success: false, error: "Failed to update invoice status" };
  }
}

