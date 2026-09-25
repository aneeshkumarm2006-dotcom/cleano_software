"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { findOpenSession, syncClockMirrors } from "@/lib/work-sessions.server";

export async function markArrived(jobId: string) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const job = await db.job.findUnique({
      where: { id: jobId },
      include: {
        employee: true,
        cleaners: true,
      },
    });

    if (!job) {
      return { success: false, error: "Job not found" };
    }

    // Verify the user is assigned to this job
    const isEmployee = job.employeeId === session.user.id;
    const isCleaner = job.cleaners.some(
      (cleaner) => cleaner.id === session.user.id
    );

    if (!isEmployee && !isCleaner) {
      return { success: false, error: "You are not assigned to this job" };
    }

    // Validate job status - can only mark arrived for SCHEDULED or CREATED jobs
    if (job.status !== "SCHEDULED" && job.status !== "CREATED") {
      return {
        success: false,
        error: `Cannot mark arrived for a job with status ${job.status}`,
      };
    }

    // Already clocked in — PER CLEANER, not per job (item 6). This read
    // `job.clockInTime`, so on a two-cleaner job the second to arrive was told
    // they were already clocked in.
    const openSession = await findOpenSession(jobId, session.user.id);
    if (openSession) {
      return { success: false, error: "You're already clocked in on this job" };
    }

    const now = new Date();

    // Sessions are the record of work; the job/assignment clock columns below
    // are recomputed from them.
    await db.jobWorkSession.create({
      data: { jobId, cleanerId: session.user.id, startedAt: now },
    });
    await syncClockMirrors(jobId);

    await db.job.update({
      where: { id: jobId },
      data: { status: "IN_PROGRESS" },
    });

    // Create arrival log
    await db.jobLog.create({
      data: {
        jobId,
        userId: session.user.id,
        action: "CLOCKED_IN",
        description: `${session.user.name} marked as arrived`,
      },
    });

    // Log the status change
    await db.jobLog.create({
      data: {
        jobId,
        userId: session.user.id,
        action: "STATUS_CHANGED",
        field: "status",
        oldValue: job.status,
        newValue: "IN_PROGRESS",
        description: `Status changed from ${job.status} to IN_PROGRESS (arrived)`,
      },
    });

    revalidatePath("/cleaners/my-jobs");
    revalidatePath(`/cleaners/my-jobs/${jobId}`);
    revalidatePath("/admin/calendar");

    return { success: true };
  } catch (error) {
    console.error("Error marking arrived:", error);
    return { success: false, error: "Failed to mark as arrived" };
  }
}
