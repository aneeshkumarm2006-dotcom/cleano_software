import "server-only";
import { db } from "@/lib/org-db";
import type { InvoiceStatus } from "@prisma/client";
import { startOfDayTz } from "./time";

// Spec item 10: invoices and jobs are one flow — marking an invoice sent or
// paid must update the linked job(s), including every job covered by a
// consolidated (multi-job) invoice via InvoiceLineItem.jobId.

/** All job ids an invoice covers: the primary jobId plus per-line links. */
export async function invoiceJobIds(invoiceId: string): Promise<string[]> {
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      jobId: true,
      lineItems: { select: { jobId: true } },
    },
  });
  if (!invoice) return [];
  const ids = new Set<string>();
  if (invoice.jobId) ids.add(invoice.jobId);
  for (const li of invoice.lineItems) if (li.jobId) ids.add(li.jobId);
  return Array.from(ids);
}

export async function syncJobsForInvoiceStatus(
  invoiceId: string,
  newStatus: InvoiceStatus,
  prevStatus: InvoiceStatus
): Promise<void> {
  if (newStatus === prevStatus) return;
  const jobIds = await invoiceJobIds(invoiceId);
  if (jobIds.length === 0) return;

  const notCancelled = { id: { in: jobIds }, status: { not: "CANCELLED" as const } };

  if (newStatus === "PAID") {
    // Round 4, fix 1: an invoice marked paid records payment on every job it
    // covers, but only moves a job to the PAID *lifecycle* status if that job
    // has actually happened. A consolidated invoice routinely covers a month
    // of work including bookings still to come, and stamping those done put
    // future jobs in the Completed tab and out of their cleaner's schedule.
    // Split in two so the future rows keep their current status.
    const now = new Date();
    // Same shape as `jobStatusWhere("completed")` in metrics.ts: a job is still
    // ahead of us when it starts later AND was never clocked out. Prisma's
    // `NOT: { a, b }` negates the conjunction, so the two arms partition the
    // invoice's jobs exactly.
    const stillAhead = { startTime: { gt: now }, clockOutTime: null };
    await db.$transaction([
      db.job.updateMany({
        where: { ...notCancelled, NOT: stillAhead },
        data: { paymentReceived: true, paidAt: now, status: "PAID", invoiceSent: true },
      }),
      db.job.updateMany({
        where: { ...notCancelled, ...stillAhead },
        data: { paymentReceived: true, paidAt: now, invoiceSent: true },
      }),
    ]);
  } else if (prevStatus === "PAID") {
    // Un-paying the invoice reverts its jobs: Completed when the date has
    // passed, Scheduled otherwise.
    const dayStart = startOfDayTz(new Date());
    await db.$transaction([
      db.job.updateMany({
        where: { ...notCancelled, startTime: { lt: dayStart } },
        data: { paymentReceived: false, paidAt: null, status: "COMPLETED" },
      }),
      db.job.updateMany({
        where: { ...notCancelled, startTime: { gte: dayStart } },
        data: { paymentReceived: false, paidAt: null, status: "SCHEDULED" },
      }),
    ]);
  } else if (newStatus === "SENT") {
    await db.job.updateMany({
      where: { id: { in: jobIds } },
      data: { invoiceSent: true },
    });
  }
}
