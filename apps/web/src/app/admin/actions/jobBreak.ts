"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

/**
 * Start / end a break while clocked in to a job (awer_fixes.pdf item 26).
 *
 * AUTHZ: everything is scoped to the SESSION user — a cleaner can only start or
 * end their own break, on a job they are clocked in to.
 *
 * Breaks are separate rows, so a cleaner can take several on a long job. Break
 * time is subtracted from active working time (see src/lib/time-tracking.ts) so
 * it can never inflate paid hours.
 */

/** Is this cleaner currently clocked in to this job? */
async function currentClockIn(jobId: string, cleanerId: string) {
  const assignment = await db.jobAssignment.findUnique({
    where: { jobId_cleanerId: { jobId, cleanerId } },
    select: { clockInTime: true, clockOutTime: true },
  });
  if (assignment?.clockInTime && !assignment.clockOutTime) return true;

  // Legacy jobs with no per-cleaner assignment row fall back to the job-level
  // clock, same as the rest of the time-tracking read paths.
  if (!assignment) {
    const job = await db.job.findFirst({
      where: { id: jobId, employeeId: cleanerId },
      select: { clockInTime: true, clockOutTime: true },
    });
    return !!job?.clockInTime && !job.clockOutTime;
  }
  return false;
}

export async function startJobBreak(jobId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };
  if (typeof jobId !== "string" || !jobId.trim()) {
    return { success: false, error: "Job is required" };
  }
  const cleanerId = session.user.id;

  if (!(await currentClockIn(jobId, cleanerId))) {
    return {
      success: false,
      error: "You need to be clocked in to this job to start a break.",
    };
  }

  // Guard against a double-tap opening two overlapping breaks, which would
  // double-count the time against the cleaner.
  const running = await db.jobBreak.findFirst({
    where: { jobId, cleanerId, endedAt: null },
    select: { id: true },
  });
  if (running) return { success: false, error: "You're already on a break." };

  await db.jobBreak.create({ data: { jobId, cleanerId } });

  revalidatePath(`/cleaners/my-jobs/${jobId}`);
  revalidatePath(`/cleaners/my-jobs/${jobId}/clock`);
  revalidatePath(`/admin/jobs/${jobId}`);
  revalidatePath("/admin/time-tracking");
  return { success: true };
}

export async function endJobBreak(jobId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };
  if (typeof jobId !== "string" || !jobId.trim()) {
    return { success: false, error: "Job is required" };
  }
  const cleanerId = session.user.id;

  const running = await db.jobBreak.findFirst({
    where: { jobId, cleanerId, endedAt: null },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
  if (!running) return { success: false, error: "You're not on a break." };

  await db.jobBreak.update({
    where: { id: running.id },
    data: { endedAt: new Date() },
  });

  revalidatePath(`/cleaners/my-jobs/${jobId}`);
  revalidatePath(`/cleaners/my-jobs/${jobId}/clock`);
  revalidatePath(`/admin/jobs/${jobId}`);
  revalidatePath("/admin/time-tracking");
  return { success: true };
}

/**
 * Close any break left running when the cleaner clocks out.
 *
 * Without this, forgetting to end a break would leave it open forever and the
 * job's active time would keep shrinking as the clock ran on.
 */
export async function closeOpenBreaksOnClockOut(
  jobId: string,
  cleanerId: string,
  at: Date = new Date()
): Promise<void> {
  try {
    await db.jobBreak.updateMany({
      where: { jobId, cleanerId, endedAt: null },
      data: { endedAt: at },
    });
  } catch (e) {
    // Never fail a clock-out because a break row wouldn't close.
    console.error("closeOpenBreaksOnClockOut failed", jobId, cleanerId, e);
  }
}
