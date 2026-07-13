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
import {
  findAvailabilityConflicts,
  syncJobAssignments,
  validateTraineePairing,
} from "@/lib/job-assignments";
import { fmtDate, fmtTime } from "@/lib/time";
import type { AvailabilityConflict } from "./checkAvailability.types";

/**
 * Focused cleaner-assignment action used from the Team card on the Job
 * details tab. Mirrors the notification logic in `saveJob` so emails +
 * alerts still fire as if the admin had edited the job through the full
 * modal.
 */
export async function assignCleaners(input: {
  jobId: string;
  cleanerIds: string[];
}): Promise<
  | { success: true; conflicts: AvailabilityConflict[] }
  | { success: false; error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { success: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { success: false, error: "Not authorized" };
  }

  // Trainees must be paired with a Field Lead (never assigned solo).
  const pairingError = await validateTraineePairing(input.cleanerIds);
  if (pairingError) return { success: false, error: pairingError };

  try {
    const job = await db.job.findUnique({
      where: { id: input.jobId },
      select: {
        id: true,
        jobNumber: true,
        clientName: true,
        startTime: true,
        endTime: true,
        location: true,
        jobType: true,
        status: true,
        // Per-booking notification controls — gate job-scoped sends below.
        notifyClient: true,
        notifyProvider: true,
        client: { select: { email: true, name: true } },
        cleaners: { select: { id: true, name: true } },
      },
    });
    if (!job) return { success: false, error: "Job not found" };

    const previousIds = new Set(job.cleaners.map((c) => c.id));
    const newlyAdded = input.cleanerIds.filter((id) => !previousIds.has(id));
    const justGotFirstCleaner =
      job.cleaners.length === 0 && input.cleanerIds.length > 0;

    // Availability conflicts (item 8) — recurring rule + one-off blocked dates.
    // ADVISORY ONLY: the admin can always override, so this never blocks the
    // assignment. It is returned so the Team card can show the warning, and
    // logged so the override is auditable.
    const conflicts = await findAvailabilityConflicts(
      input.cleanerIds,
      job.startTime,
      job.endTime
    );

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

    // Keep per-cleaner JobAssignment rows in sync with the assigned team.
    await syncJobAssignments(input.jobId, input.cleanerIds);

    if (conflicts.length > 0) {
      await db.jobLog
        .create({
          data: {
            jobId: input.jobId,
            userId: session.user.id,
            action: "UPDATED",
            field: "cleaners",
            description: `Availability conflict overridden — ${conflicts
              .map((c) => c.warning)
              .join("; ")}`,
          },
        })
        .catch(() => {});
    }

    const lifecycleInfo = {
      jobId: input.jobId,
      jobNumber: job.jobNumber,
      clientName: job.clientName,
      startTime: job.startTime.toISOString(),
      address: job.location ?? "",
      serviceType: job.jobType,
    };

    // Customer "Booking confirmed" when first cleaner is paired.
    // Gated by the per-booking notifyClient toggle.
    if (justGotFirstCleaner && job.notifyClient && job.client?.email) {
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
      // Customer "modified" email — gated by per-booking notifyClient.
      if (job.notifyClient && job.client?.email) {
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
    // Gated by the per-booking notifyProvider toggle.
    for (const cleanerId of job.notifyProvider ? newlyAdded : []) {
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
            message: `Job #${job.jobNumber} on ${fmtDate(job.startTime)} at ${fmtTime(job.startTime)} has been assigned to you.`,
            recipientUserId: cleanerId,
            relatedId: input.jobId,
            relatedType: "Job",
          },
        })
        .catch(() => {});
    }

    revalidatePath(`/admin/jobs/${input.jobId}`);
    revalidatePath("/admin/jobs");
    return { success: true, conflicts };
  } catch (error) {
    console.error("Error assigning cleaners:", error);
    return { success: false, error: "Failed to assign cleaners" };
  }
}
