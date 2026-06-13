"use server";

import { db } from "@/db";
import { requireOwnerAdmin } from "@/lib/action-guards";
import { sendBookingConfirmation } from "@/lib/email";
import { revalidatePath } from "next/cache";

/**
 * Re-send a previously FAILED email by reconstructing it from its source record.
 * Phase 1 supports BOOKING_CONFIRMATION (rebuilt from the job); other kinds are
 * not yet reconstructable and return a friendly message.
 */
export async function retryEmail(logId: string) {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { success: false, error: guard.error };

  const log = await db.emailLog.findUnique({
    where: { id: logId },
    include: { job: { include: { client: true } } },
  });
  if (!log) return { success: false, error: "Log not found" };
  if (log.status !== "FAILED") {
    return { success: false, error: "Only failed emails can be retried" };
  }

  if (log.kind === "BOOKING_CONFIRMATION" && log.job) {
    const job = log.job;
    // Reset the log so the send wrapper updates it back to SENT/FAILED.
    await db.emailLog.update({
      where: { id: log.id },
      data: { status: "PENDING", error: null },
    });
    await sendBookingConfirmation({
      to: log.recipient,
      clientName: job.client?.name ?? job.clientName,
      jobId: job.id,
      jobNumber: job.jobNumber,
      startTime: job.startTime.toISOString(),
      isFlexible: job.isFlexible,
      address: job.location ?? "",
      serviceType: job.jobType,
      subtotal: job.subtotalAmount,
      gst: job.gstAmount,
      qst: job.qstAmount,
      total: job.price,
      depositPaid: job.depositPaid,
      logId: log.id,
    });
    const fresh = await db.emailLog.findUnique({
      where: { id: log.id },
      select: { status: true, error: true },
    });
    revalidatePath("/logs");
    return fresh?.status === "SENT"
      ? { success: true }
      : { success: false, error: fresh?.error ?? "Send failed again" };
  }

  return {
    success: false,
    error: `Retry isn't supported yet for ${log.kind} emails.`,
  };
}
