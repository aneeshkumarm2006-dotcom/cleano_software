"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { issueRefund } from "./issueRefund";
import {
  sendAdminBookingCanceled,
  sendCustomerBookingCancellation,
  sendProviderBookingCanceled,
} from "@/lib/email";
import { isNotificationEnabled } from "@/lib/notifications";
import { smsCancellation } from "@/lib/sms";
import { fmtDate } from "@/lib/time";
import { resolveDepositCredit } from "@/lib/booking-deposit";

interface CancelJobInput {
  jobId: string;
  refundDeposit: boolean;
  reason?: string;
}

export async function cancelJobByAdmin(input: CancelJobInput) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };
    const role = (session.user as { role?: string }).role;
    if (role !== "OWNER" && role !== "ADMIN") {
      return { success: false, error: "Not authorized" };
    }

    const job = await db.job.findUnique({
      where: { id: input.jobId },
      select: {
        id: true,
        status: true,
        jobNumber: true,
        depositPaid: true,
        // Stage 11: the refund cap comes from the job, not a constant.
        depositAmount: true,
        refundedAmount: true,
        clientName: true,
        startTime: true,
        location: true,
        jobType: true,
        // Per-booking notification controls — gate job-scoped sends below.
        notifyClient: true,
        notifyProvider: true,
        client: { select: { email: true, phone: true } },
        cleaners: { select: { id: true, name: true, email: true } },
      },
    });
    if (!job) return { success: false, error: "Job not found" };
    if (job.status === "CANCELLED") {
      return { success: false, error: "Job is already cancelled" };
    }
    if (job.status === "COMPLETED") {
      return { success: false, error: "Cannot cancel a completed job" };
    }

    await db.$transaction([
      db.job.update({
        where: { id: input.jobId },
        data: {
          status: "CANCELLED",
          cancellationRequestedAt: null,
          ...(input.reason?.trim()
            ? { cancellationReason: input.reason.trim() }
            : {}),
        },
      }),
      db.jobLog.create({
        data: {
          jobId: input.jobId,
          userId: session.user.id,
          action: "STATUS_CHANGED",
          field: "status",
          newValue: "CANCELLED",
          description: `Job cancelled by admin${input.reason ? `: ${input.reason}` : ""}`,
        },
      }),
    ]);

    // Optionally refund the deposit (capped at the remaining deposit balance).
    //
    // The cap was a hardcoded `20` (Stage 11 / PDF #9): cancelling a
    // post-construction booking sent back $20 of the customer's $200 and reported
    // success. `resolveDepositCredit` reads what the job actually charged.
    let refund: { success: boolean; error?: string } | null = null;
    if (input.refundDeposit && job.depositPaid) {
      const remaining = resolveDepositCredit(job) - (job.refundedAmount ?? 0);
      if (remaining > 0.001) {
        refund = await issueRefund({
          jobId: input.jobId,
          amount: remaining,
          reason: input.reason ?? "Booking cancelled",
        });
      }
    }

    // Lifecycle notifications — gated by Settings → Notifications.
    const lifecycleInfo = {
      jobId: input.jobId,
      jobNumber: job.jobNumber,
      clientName: job.clientName,
      startTime: job.startTime.toISOString(),
      address: job.location ?? "",
      serviceType: job.jobType,
    };
    sendAdminBookingCanceled({
      ...lifecycleInfo,
      reason: input.reason,
      canceledBy: session.user.name ?? "Admin",
    }).catch((e) => console.error("admin cancel email", e));
    // Customer email/SMS — gated by the per-booking notifyClient toggle.
    if (job.notifyClient && job.client?.email) {
      sendCustomerBookingCancellation({
        ...lifecycleInfo,
        to: job.client.email,
        reason: input.reason,
        refundIssued: !!refund && refund.success,
      }).catch((e) => console.error("customer cancel email", e));
    }
    if (job.notifyClient && job.client?.phone) {
      smsCancellation({
        to: job.client.phone,
        jobNumber: job.jobNumber,
        reason: input.reason,
      }).catch((e) => console.error("customer cancel sms", e));
    }
    // Notify each assigned cleaner — email + (gated) app-push alert.
    // Gated by the per-booking notifyProvider toggle.
    for (const c of job.notifyProvider ? job.cleaners : []) {
      if (c.email) {
        sendProviderBookingCanceled({
          to: c.email,
          providerName: c.name,
          jobId: input.jobId,
          jobNumber: job.jobNumber,
          clientName: job.clientName,
          startTime: job.startTime.toISOString(),
          address: job.location ?? "",
          serviceType: job.jobType,
          reason: input.reason ?? null,
        }).catch((e) => console.error("provider cancel email", e));
      }
      if (await isNotificationEnabled("PROVIDER", "prov.cancel.booking_canceled", "APP_PUSH")) {
        await db.alert.create({
          data: {
            type: "CANCELLATION",
            severity: "WARNING",
            title: `Booking canceled — ${job.clientName}`,
            message: `Job #${job.jobNumber} on ${fmtDate(job.startTime)} was canceled by admin.`,
            recipientUserId: c.id,
            relatedId: input.jobId,
            relatedType: "Job",
          },
        }).catch(() => {});
      }
    }

    revalidatePath(`/admin/jobs/${input.jobId}`);
    revalidatePath("/admin/jobs");
    return { success: true, refund };
  } catch (err) {
    console.error("cancelJobByAdmin error:", err);
    return { success: false, error: "Failed to cancel job" };
  }
}
