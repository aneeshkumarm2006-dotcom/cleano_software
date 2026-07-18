import "server-only";
import { db } from "@/db";
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
    await db.job.updateMany({
      where: notCancelled,
      data: { paymentReceived: true, paidAt: new Date(), status: "PAID", invoiceSent: true },
    });
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
