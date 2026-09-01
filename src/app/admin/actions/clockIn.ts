"use server";

import { db } from "@/lib/org-db";
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
import {
  CLOCK_IN_BLOCKED_STATUSES,
  CLOCK_IN_EARLY_WINDOW_MIN,
  clockInOpensAt,
} from "@/lib/cleaner-jobs";
import { findOpenSession, syncClockMirrors } from "@/lib/work-sessions.server";
import { fmtDateTime } from "@/lib/time";

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

    // Fail closed: a soft-deleted job is not clockable.
    if (!job || job.deletedAt) {
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

    // Already on the clock? PER CLEANER, not per job (item 6).
    //
    // This used to read `job.clockInTime`, which is a JOB-level column — so on
    // any two-cleaner job the first person to clock in locked their teammate
    // out with "Already clocked in", and nobody could ever start a second
    // session. Sessions are keyed (jobId, cleanerId), so the question is now
    // the right one: is THIS cleaner running on THIS job.
    const openSession = await findOpenSession(jobId, session.user.id);
    if (openSession) {
      return { success: false, error: "You're already clocked in on this job" };
    }

    // A cancelled or paid job can't be clocked into. COMPLETED is deliberately
    // NOT blocked any more — reopening a finished job is exactly what "clock
    // back in" means, and the status is restored to IN_PROGRESS below.
    if ((CLOCK_IN_BLOCKED_STATUSES as readonly string[]).includes(job.status)) {
      return {
        success: false,
        error:
          job.status === "CANCELLED"
            ? "This job was cancelled — you can't clock in."
            : "This job has already been paid out — ask an admin to reopen it.",
      };
    }

    const now = new Date();

    // Is this a fresh start or a resume? Everything late-arrival-related hangs
    // off this: coming back at 6pm to finish a job you started on time is not
    // a late arrival, and must not raise a penalty, an email or a strike.
    const priorSessions = await db.jobWorkSession.count({
      where: { jobId, cleanerId: session.user.id },
    });
    const isResume = priorSessions > 0;

    // Date guard: clock-in opens a fixed window before the scheduled start.
    // Without this, a cleaner could clock in DAYS early and produce a
    // clockInTime that predates the job date (and bogus hours/pay). A resume
    // is exempt: the window has obviously already opened for work that has
    // already started.
    const opensAt = clockInOpensAt(job.startTime);
    if (!isResume && now.getTime() < opensAt.getTime()) {
      return {
        success: false,
        error: `Too early to clock in. Clock-in opens ${CLOCK_IN_EARLY_WINDOW_MIN / 60} hours before the start — from ${fmtDateTime(opensAt)}.`,
      };
    }

    /**
     * Late-arrival detection: minutes between scheduled start and clock-in.
     * Only ever measured on the FIRST session (see isResume above).
     *
     * A FLEXIBLE job cannot be late (Aug 31 list, item 11). Its start time is
     * only a slot on the day — the cleaner may do the work whenever suits, the
     * client is not standing at the door — so measuring lateness against it
     * produces a number that means nothing and then acts on it: a penalty
     * against the cleaner's pay, a late-arrival email to the office, and a
     * strike at 45 minutes. A cleaner working exactly as instructed was being
     * disciplined for it.
     */
    const minutesLate =
      isResume || job.isFlexible
        ? 0
        : Math.max(
            0,
            Math.floor((now.getTime() - job.startTime.getTime()) / 60_000)
          );
    const penalty =
      isResume || job.isFlexible ? null : computeLateArrivalPenalty(minutesLate);

    // Open the session. This is the record of work now; the columns below are
    // derived mirrors of it.
    await db.jobWorkSession.create({
      data: { jobId, cleanerId: session.user.id, startedAt: now },
    });

    // Job/assignment clock columns are recomputed from every session on the
    // job — so a resume correctly re-opens clockOutTime rather than leaving a
    // finished-looking job with somebody on site.
    await syncClockMirrors(jobId);

    // Status: back to IN_PROGRESS while anyone is working. PAID and CANCELLED
    // were refused above and are never resurrected here.
    if (job.status !== "IN_PROGRESS") {
      await db.job.update({
        where: { id: jobId },
        data: {
          status: "IN_PROGRESS",
          ...(penalty !== null
            ? { lateArrivalAt: now, lateArrivalRatingPenalty: penalty }
            : {}),
        },
      });
    } else if (penalty !== null) {
      await db.job.update({
        where: { id: jobId },
        data: { lateArrivalAt: now, lateArrivalRatingPenalty: penalty },
      });
    }

    // Create a log entry
    await db.jobLog.create({
      data: {
        jobId,
        userId: session.user.id,
        action: "CLOCKED_IN",
        description: isResume
          ? `${session.user.name} clocked back in (session ${priorSessions + 1})`
          : `${session.user.name} clocked in`,
      },
    });

    // Also log the status change
    if (job.status !== "IN_PROGRESS") {
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
    }

    // Admin email — gated by `admin.clock.clocked_in`. Sent on a resume too:
    // "they're back on site" is exactly as useful to dispatch as "they've
    // arrived", and the log line above says which it was.
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

    revalidatePath("/cleaners/my-jobs");
    revalidatePath(`/cleaners/my-jobs/${jobId}`);
    revalidatePath(`/cleaners/my-jobs/${jobId}/clock`);
    revalidatePath(`/admin/jobs/${jobId}`);
    revalidatePath("/admin/time-tracking");

    return { success: true, minutesLate, penalty, resumed: isResume };
  } catch (error) {
    console.error("Error clocking in:", error);
    return { success: false, error: "Failed to clock in" };
  }
}

