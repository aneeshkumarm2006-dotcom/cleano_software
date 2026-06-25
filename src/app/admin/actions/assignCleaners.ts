"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  sendCustomerBookingConfirmed,
  sendAdminBookingModified,
  sendCustomerBookingModified,
} from "@/lib/email";
import { isNotificationEnabled } from "@/lib/notifications";
import { createAssignmentInvites } from "@/lib/invites";

/**
 * Focused cleaner-assignment action used from the Team card on the Job
 * details tab. Mirrors the notification logic in `saveJob` so emails +
 * alerts still fire as if the admin had edited the job through the full
 * modal.
 */
export async function assignCleaners(input: {
  jobId: string;
  cleanerIds: string[];
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { success: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { success: false, error: "Not authorized" };
  }

  try {
    const job = await db.job.findUnique({
      where: { id: input.jobId },
      select: {
        id: true,
        jobNumber: true,
        clientName: true,
        startTime: true,
        location: true,
        jobType: true,
        status: true,
        client: { select: { email: true, name: true } },
        cleaners: { select: { id: true, name: true } },
      },
    });
    if (!job) return { success: false, error: "Job not found" };

    const previousIds = new Set(job.cleaners.map((c) => c.id));
    const newlyAdded = input.cleanerIds.filter((id) => !previousIds.has(id));
    const justGotFirstCleaner =
      job.cleaners.length === 0 && input.cleanerIds.length > 0;

    await db.$transaction([
      db.job.update({
        where: { id: input.jobId },
        data: {
          cleaners:
            input.cleanerIds.length > 0
              ? { set: input.cleanerIds.map((id) => ({ id })) }
              : { set: [] },
        },
      }),
      db.jobLog.create({
        data: {
          jobId: input.jobId,
          userId: session.user.id,
          action: "UPDATED",
          field: "cleaners",
          description: `Cleaners updated by ${session.user.name ?? "Admin"} — ${input.cleanerIds.length} assigned`,
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

    // Customer "Booking confirmed" when first cleaner is paired.
    if (justGotFirstCleaner && job.client?.email) {
      const assigned = await db.user.findMany({
        where: { id: { in: input.cleanerIds } },
        select: { name: true },
      });
      sendCustomerBookingConfirmed({
        ...lifecycleInfo,
        to: job.client.email,
        cleanerNames: assigned.map((u) => u.name),
      }).catch((e) => console.error("customer confirmed email", e));
    } else {
      // Any other reassignment counts as a "modified" event.
      sendAdminBookingModified({
        ...lifecycleInfo,
        changedBy: session.user.name ?? "Admin",
      }).catch((e) => console.error("admin modified email", e));
      if (job.client?.email) {
        sendCustomerBookingModified({
          ...lifecycleInfo,
          to: job.client.email,
        }).catch((e) => console.error("customer modified email", e));
      }
    }

    // Accept/decline invites for newly added cleaners.
    if (newlyAdded.length > 0) {
      await createAssignmentInvites({
        jobId: input.jobId,
        cleanerIds: newlyAdded,
      });
    }

    // Provider app-push alert for newly assigned cleaners.
    for (const cleanerId of newlyAdded) {
      const allow = await isNotificationEnabled(
        "PROVIDER",
        "prov.booking.new",
        "APP_PUSH"
      );
      if (!allow) continue;
      await db.alert
        .create({
          data: {
            type: "GENERAL",
            severity: "INFO",
            title: `New booking — ${job.clientName}`,
            message: `Job #${job.jobNumber} on ${job.startTime.toLocaleDateString()} at ${job.startTime.toLocaleTimeString()} has been assigned to you.`,
            recipientUserId: cleanerId,
            relatedId: input.jobId,
            relatedType: "Job",
          },
        })
        .catch(() => {});
    }

    revalidatePath(`/admin/jobs/${input.jobId}`);
    revalidatePath("/admin/jobs");
    return { success: true };
  } catch (error) {
    console.error("Error assigning cleaners:", error);
    return { success: false, error: "Failed to assign cleaners" };
  }
}
