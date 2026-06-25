"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  sendCustomerBookingCancellation,
  sendAdminBookingCanceled,
  sendCustomerRequestResolved,
  sendProviderBookingCanceled,
} from "@/lib/email";

type RequestKind = "cancellation" | "reschedule";
type Decision = "approve" | "deny";

export async function resolveJobRequest(input: {
  jobId: string;
  kind: RequestKind;
  decision: Decision;
  note?: string;
}) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };
    const role = (session.user as { role?: string }).role;
    if (role !== "OWNER" && role !== "ADMIN") {
      return { success: false, error: "Not authorized" };
    }

    const job = await db.job.findUnique({
      where: { id: input.jobId },
      include: {
        client: { select: { name: true, email: true } },
        cleaners: { select: { id: true, name: true, email: true } },
      },
    });
    if (!job) return { success: false, error: "Job not found" };

    // Clear the request flag, optionally update status, and log the decision.
    const updates: Record<string, unknown> = {};
    if (input.kind === "cancellation") {
      updates.cancellationRequestedAt = null;
      if (input.decision === "approve") updates.status = "CANCELLED";
    } else {
      updates.rescheduleRequestedAt = null;
    }

    const desc =
      input.kind === "cancellation"
        ? input.decision === "approve"
          ? "Cancellation approved — job cancelled"
          : "Cancellation request denied"
        : input.decision === "approve"
        ? "Reschedule approved — admin will follow up to set a new time"
        : "Reschedule request denied";

    await db.$transaction([
      db.job.update({ where: { id: input.jobId }, data: updates }),
      db.jobLog.create({
        data: {
          jobId: input.jobId,
          userId: session.user.id,
          action: "NOTE_ADDED",
          description: input.note?.trim()
            ? `${desc} · ${input.note.trim()}`
            : desc,
        },
      }),
    ]);

    const lifecycleInfo = {
      jobId: input.jobId,
      jobNumber: job.jobNumber,
      clientName: job.clientName,
      startTime: job.startTime.toISOString(),
      address: job.location ?? "",
      serviceType: job.jobType,
    };

    // Approved cancellation = the job is actually being cancelled. Fire the
    // dedicated cancellation emails (admin + customer) with the optional note.
    if (
      input.kind === "cancellation" &&
      input.decision === "approve" &&
      job.status !== "CANCELLED"
    ) {
      sendAdminBookingCanceled({
        ...lifecycleInfo,
        canceledBy: session.user.name ?? "Admin",
        reason: input.note?.trim() ?? "Customer cancellation request approved",
      }).catch((e) => console.error("admin cancel (resolveJobRequest)", e));
      if (job.client?.email) {
        sendCustomerBookingCancellation({
          ...lifecycleInfo,
          to: job.client.email,
          reason: input.note?.trim() ?? null,
        }).catch((e) => console.error("customer cancel (resolveJobRequest)", e));
      }
      // Notify each assigned cleaner that the booking was canceled.
      for (const c of job.cleaners) {
        if (!c.email) continue;
        sendProviderBookingCanceled({
          to: c.email,
          providerName: c.name,
          jobId: input.jobId,
          jobNumber: job.jobNumber,
          clientName: job.clientName,
          startTime: job.startTime.toISOString(),
          address: job.location ?? "",
          serviceType: job.jobType,
          reason:
            input.note?.trim() ?? "Customer cancellation request approved",
        }).catch((e) =>
          console.error("provider cancel email (resolveJobRequest)", e)
        );
      }
    } else if (job.client?.email) {
      // For every other resolution (denied cancellation, approved reschedule,
      // denied reschedule), send the customer a single "request resolved"
      // email so they know the outcome — including any admin note.
      sendCustomerRequestResolved({
        to: job.client.email,
        clientName: job.client.name ?? job.clientName,
        jobId: input.jobId,
        jobNumber: job.jobNumber,
        startTime: job.startTime.toISOString(),
        address: job.location ?? "",
        serviceType: job.jobType,
        kind: input.kind,
        decision: input.decision,
        note: input.note?.trim() || undefined,
      }).catch((e) =>
        console.error("customer request-resolved email", e)
      );
    }

    revalidatePath("/admin/requests");
    revalidatePath(`/admin/jobs/${input.jobId}`);
    return { success: true };
  } catch (error) {
    console.error("Error resolving job request:", error);
    return { success: false, error: "Failed to resolve request" };
  }
}
