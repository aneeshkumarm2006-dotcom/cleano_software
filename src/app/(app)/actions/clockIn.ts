"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

export async function clockIn(jobId: string) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    // Get the job and verify the user has access
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

    // Check if user is assigned to this job (either as employee or cleaner)
    const isEmployee = job.employeeId === session.user.id;
    const isCleaner = job.cleaners.some(
      (cleaner) => cleaner.id === session.user.id
    );

    if (!isEmployee && !isCleaner) {
      return { success: false, error: "You are not assigned to this job" };
    }

    // Check if already clocked in
    if (job.clockInTime) {
      return { success: false, error: "Already clocked in" };
    }

    const now = new Date();
    const jobStartTime = new Date(job.startTime);
    const fifteenMinutesBefore = new Date(jobStartTime.getTime() - 15 * 60 * 1000);

    // Check if it's at least 15 minutes before the job start time
    if (now < fifteenMinutesBefore) {
      const minutesUntil = Math.ceil(
        (fifteenMinutesBefore.getTime() - now.getTime()) / (60 * 1000)
      );
      return {
        success: false,
        error: `You can clock in ${minutesUntil} minute${
          minutesUntil !== 1 ? "s" : ""
        } before the scheduled start time (at ${fifteenMinutesBefore.toLocaleTimeString(
          "en-US",
          {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          }
        )})`,
      };
    }

    // Update the job with clock in time
    await db.job.update({
      where: { id: jobId },
      data: {
        clockInTime: now,
        status: "IN_PROGRESS",
      },
    });

    // Create a log entry
    await db.jobLog.create({
      data: {
        jobId,
        userId: session.user.id,
        action: "CLOCKED_IN",
        description: `${session.user.name} clocked in`,
      },
    });

    // Also log the status change
    await db.jobLog.create({
      data: {
        jobId,
        userId: session.user.id,
        action: "STATUS_CHANGED",
        field: "status",
        oldValue: job.status,
        newValue: "IN_PROGRESS",
        description: `Status changed from ${job.status} to IN_PROGRESS`,
      },
    });

    revalidatePath("/my-jobs");
    revalidatePath(`/jobs/${jobId}`);

    return { success: true };
  } catch (error) {
    console.error("Error clocking in:", error);
    return { success: false, error: "Failed to clock in" };
  }
}

