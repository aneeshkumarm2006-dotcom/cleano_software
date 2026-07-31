"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import { invalidateCalendarDay } from "./invalidateCalendarDay";
import { logActivity } from "@/lib/activity-log";

/**
 * ARCHIVE a job (soft delete).
 *
 * This used to call `db.job.delete()` — a hard delete that destroyed the row
 * outright, bypassing the archive/permanent-delete two-step that
 * `permanentlyDeleteJobs` documents and enforces, and contradicting the schema's
 * own note on `Job.deletedAt` ("soft-delete, recoverable via Archived view.
 * Never hard-deleted"). Bulk delete has always been soft; only this single-job
 * path destroyed data. The evidence it had been used: on 2026-07-28 the database
 * held 7 jobs with job numbers running to #1540 and 28 ratings orphaned by the
 * SetNull cascade — 1533 rows gone with no archive to recover them.
 *
 * Permanent removal is still available, deliberately, from the Archived view via
 * `permanentlyDeleteJobs`.
 */
export async function deleteJob(jobId: string) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return { error: "Unauthorized" };
  }

  try {
    // Check if user is admin or owner of the job
    const job = await db.job.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      return { error: "Job not found" };
    }

    if (job.deletedAt) {
      return { error: "This job is already archived" };
    }

    const isAdmin =
      (session.user as any).role === "ADMIN" ||
      (session.user as any).role === "OWNER";

    if (!isAdmin && job.employeeId !== session.user.id) {
      return { error: "You do not have permission to delete this job" };
    }

    await db.job.update({
      where: { id: jobId },
      data: { deletedAt: new Date() },
    });

    // Assignments are left intact: archiving is not unassigning (new fix list
    // item 2), and restoring the job must bring its team back with it.
    await db.jobLog
      .create({
        data: {
          jobId,
          userId: session.user.id,
          action: "STATUS_CHANGED",
          field: "deletedAt",
          oldValue: null,
          newValue: "archived",
          description: `Job archived by ${session.user.name ?? "an admin"}`,
        },
      })
      .catch(() => {});

    // Also recorded outside the job, so the trail survives if the job is later
    // permanently deleted (JobLog cascades away with it).
    await logActivity({
      category: "ADMIN",
      action: "job.archive",
      actorId: session.user.id,
      actorLabel: session.user.email ?? session.user.name ?? null,
      targetType: "job",
      targetId: jobId,
      message: `Archived job #${job.jobNumber} (${job.clientName})`,
    });

    if (job.startTime) {
      await invalidateCalendarDay(job.startTime.toISOString().slice(0, 10));
    }
    revalidatePath("/admin/jobs");
    revalidatePath(`/admin/jobs/${jobId}`);
    return { success: true };
  } catch (error) {
    console.error("Error archiving job:", error);
    return { error: "Failed to archive job. Please try again." };
  }
}

