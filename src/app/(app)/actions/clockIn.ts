"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  sendAdminClockedIn,
  sendAdminLateArrival,
  sendProviderLateArrival,
} from "@/lib/email";
import { computeLateArrivalPenalty } from "@/lib/policy";
import { applyStrike } from "@/lib/strikes";

/** Minutes late that earns an accountability strike (subject to admin excuse). */
const STRIKE_LATE_MIN = 45;

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

    // Late-arrival detection: minutes between scheduled start and clock-in.
    const minutesLate = Math.max(
      0,
      Math.floor((now.getTime() - job.startTime.getTime()) / 60_000)
    );
    const penalty = computeLateArrivalPenalty(minutesLate);

    // Update the job with clock in time and the rating penalty when applicable.
    await db.job.update({
      where: { id: jobId },
      data: {
        clockInTime: now,
        status: "IN_PROGRESS",
        ...(penalty !== null
          ? { lateArrivalAt: now, lateArrivalRatingPenalty: penalty }
          : {}),
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

    // Admin email — gated by `admin.clock.clocked_in`.
    sendAdminClockedIn({
      jobId,
      jobNumber: job.jobNumber,
      clientName: job.clientName,
      cleanerName: session.user.name ?? "Cleaner",
    }).catch((e) => console.error("admin clocked-in email", e));

    // Late-arrival emails (admin + cleaner) when the penalty is in effect.
    if (penalty !== null) {
      sendAdminLateArrival({
        jobId,
        jobNumber: job.jobNumber,
        clientName: job.clientName,
        cleanerName: session.user.name ?? "Cleaner",
        minutesLate,
        penalty,
      }).catch((e) => console.error("admin late-arrival email", e));

      const sessionEmail = session.user.email;
      if (sessionEmail) {
        sendProviderLateArrival({
          to: sessionEmail,
          providerName: session.user.name ?? "Cleaner",
          jobId,
          jobNumber: job.jobNumber,
          minutesLate,
          penalty,
        }).catch((e) => console.error("provider late-arrival email", e));
      }

      await db.jobLog.create({
        data: {
          jobId,
          userId: session.user.id,
          action: "NOTE_ADDED",
          description: `Late arrival: clocked in ${minutesLate} min after scheduled start. Rating for this job reduced by ${penalty} stars.`,
        },
      });
    }

    // Accountability strike: 45+ minutes late without approved notice.
    // Admin can excuse it later if there was an approved notice.
    if (minutesLate >= STRIKE_LATE_MIN) {
      await applyStrike({
        cleanerId: session.user.id,
        reasonCode: "LATE_45",
        detail: `${minutesLate} min late to job #${job.jobNumber}`,
        jobId,
        dedupePerJob: true,
      }).catch((e) => console.error("late-arrival strike", e));
    }

    revalidatePath("/my-jobs");
    revalidatePath(`/jobs/${jobId}`);

    return { success: true, minutesLate, penalty };
  } catch (error) {
    console.error("Error clocking in:", error);
    return { success: false, error: "Failed to clock in" };
  }
}

