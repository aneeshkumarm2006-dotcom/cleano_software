// Clocking in: the rules the web's clockIn action has always applied, moved
// here so the phone's POST /api/v1/jobs/:id/clock-in runs the same code
// (API_V1.md §5). The action (app/admin/actions/clockIn.ts) is now a thin
// adapter and answers exactly as before.
//
// What changed in the move, and only this:
//   - "now" is an input. The web passes the current time; the phone passes
//     the time its event is applied at (§6), so the early window, lateness,
//     the penalty and the strike are judged at that time.
//   - the emails come back as effects instead of being fired here.
//   - the one-open-session index (migration 20260925120100) makes a second
//     session for the same cleaner and job impossible; losing that race is
//     answered like the sequential "already clocked in".
import "server-only";

import { computeLateArrivalPenalty } from "@bookmops/core/policy";
import { Prisma } from "@prisma/client";

import { recordAdminNotification } from "@/lib/admin-notifications";
import {
  CLOCK_IN_BLOCKED_STATUSES,
  CLOCK_IN_EARLY_WINDOW_MIN,
  clockInOpensAt,
  jobStaffing,
  type JobStaffing,
} from "@/lib/cleaner-jobs";
import { sendAdminClockedIn, sendAdminLateArrival, sendProviderLateArrival } from "@/lib/email";
import { db } from "@/lib/org-db";
import { applyStrike } from "@/lib/strikes";
import { fmtDateTime } from "@/lib/time";
import { findOpenSession, syncClockMirrors } from "@/lib/work-sessions.server";

import type { Actor } from "../actor";
import { effect, type Effect } from "../effects";
import { failure, ok, type Result } from "../result";

/** Minutes late that earns an accountability strike (subject to admin excuse). */
const STRIKE_LATE_MIN = 45;

export interface ClockInInput {
  jobId: string;
  /** The time the clock-in is applied at. */
  now: Date;
  /** Set for a phone event: recorded on the session for audit. */
  event?: { clientEventId: string; receivedAt: Date };
}

export interface ClockInValue {
  minutesLate: number;
  penalty: number | null;
  resumed: boolean;
  staffing: JobStaffing;
  sessionId: string;
}

export async function clockInService(actor: Actor, input: ClockInInput): Promise<Result<ClockInValue>> {
  const { jobId, now } = input;

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
    return failure(404, "NOT_FOUND", "Job not found");
  }

  // Check if user is assigned to this job (either as employee or cleaner)
  const isEmployee = job.employeeId === actor.userId;
  const isCleaner = job.cleaners.some((cleaner) => cleaner.id === actor.userId);

  if (!isEmployee && !isCleaner) {
    return failure(404, "NOT_ASSIGNED", "You are not assigned to this job");
  }

  // Already on the clock? PER CLEANER, not per job (item 6).
  //
  // This used to read `job.clockInTime`, which is a JOB-level column — so on
  // any two-cleaner job the first person to clock in locked their teammate
  // out with "Already clocked in", and nobody could ever start a second
  // session. Sessions are keyed (jobId, cleanerId), so the question is now
  // the right one: is THIS cleaner running on THIS job.
  const openSession = await findOpenSession(jobId, actor.userId);
  if (openSession) {
    return failure(409, "ALREADY_CLOCKED_IN", "You're already clocked in on this job");
  }

  // A cancelled or paid job can't be clocked into. COMPLETED is deliberately
  // NOT blocked any more — reopening a finished job is exactly what "clock
  // back in" means, and the status is restored to IN_PROGRESS below.
  if ((CLOCK_IN_BLOCKED_STATUSES as readonly string[]).includes(job.status)) {
    return failure(
      409,
      "JOB_CLOSED",
      job.status === "CANCELLED"
        ? "This job was cancelled — you can't clock in."
        : "This job has already been paid out — ask an admin to reopen it.",
    );
  }

  // Is this a fresh start or a resume? Everything late-arrival-related hangs
  // off this: coming back at 6pm to finish a job you started on time is not
  // a late arrival, and must not raise a penalty, an email or a strike.
  const priorSessions = await db.jobWorkSession.count({
    where: { jobId, cleanerId: actor.userId },
  });
  const isResume = priorSessions > 0;

  // Date guard: clock-in opens a fixed window before the scheduled start.
  // Without this, a cleaner could clock in DAYS early and produce a
  // clockInTime that predates the job date (and bogus hours/pay). A resume
  // is exempt: the window has obviously already opened for work that has
  // already started.
  const opensAt = clockInOpensAt(job.startTime);
  if (!isResume && now.getTime() < opensAt.getTime()) {
    return failure(
      409,
      "TOO_EARLY",
      `Too early to clock in. Clock-in opens ${CLOCK_IN_EARLY_WINDOW_MIN / 60} hours before the start — from ${fmtDateTime(opensAt)}.`,
    );
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
      : Math.max(0, Math.floor((now.getTime() - job.startTime.getTime()) / 60_000));
  const penalty = isResume || job.isFlexible ? null : computeLateArrivalPenalty(minutesLate);

  // Open the session. This is the record of work now; the columns below are
  // derived mirrors of it.
  let sessionId: string;
  try {
    const created = await db.jobWorkSession.create({
      data: {
        jobId,
        cleanerId: actor.userId,
        startedAt: now,
        ...(input.event
          ? { clientEventId: input.event.clientEventId, receivedAt: input.event.receivedAt }
          : {}),
      },
      select: { id: true },
    });
    sessionId = created.id;
  } catch (e) {
    // Two taps, or two devices, raced past the check above; the partial
    // unique index let exactly one through. The loser is told what the
    // winner's tap already made true.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return failure(409, "ALREADY_CLOCKED_IN", "You're already clocked in on this job");
    }
    throw e;
  }

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
        ...(penalty !== null ? { lateArrivalAt: now, lateArrivalRatingPenalty: penalty } : {}),
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
      userId: actor.userId,
      action: "CLOCKED_IN",
      description: isResume
        ? `${actor.name} clocked back in (session ${priorSessions + 1})`
        : `${actor.name} clocked in`,
    },
  });

  // Also log the status change
  if (job.status !== "IN_PROGRESS") {
    await db.jobLog.create({
      data: {
        jobId,
        userId: actor.userId,
        action: "STATUS_CHANGED",
        field: "status",
        oldValue: job.status,
        newValue: "IN_PROGRESS",
        description: `Status changed from ${job.status} to IN_PROGRESS`,
      },
    });
  }

  const effects: Effect[] = [];

  // Admin email — gated by `admin.clock.clocked_in`. Sent on a resume too:
  // "they're back on site" is exactly as useful to dispatch as "they've
  // arrived", and the log line above says which it was.
  effects.push(
    effect("admin clocked-in email", () =>
      sendAdminClockedIn({
        jobId,
        jobNumber: job.jobNumber,
        clientName: job.clientName,
        cleanerName: actor.name ?? "Cleaner",
      }),
    ),
  );

  // Late-arrival emails (admin + cleaner) when the penalty is in effect.
  if (penalty !== null) {
    effects.push(
      effect("admin late-arrival email", () =>
        sendAdminLateArrival({
          jobId,
          jobNumber: job.jobNumber,
          clientName: job.clientName,
          cleanerName: actor.name ?? "Cleaner",
          minutesLate,
          penalty,
        }),
      ),
    );

    if (actor.email) {
      effects.push(
        effect("provider late-arrival email", () =>
          sendProviderLateArrival({
            to: actor.email,
            providerName: actor.name ?? "Cleaner",
            jobId,
            jobNumber: job.jobNumber,
            minutesLate,
            penalty,
          }),
        ),
      );
    }

    await db.jobLog.create({
      data: {
        jobId,
        userId: actor.userId,
        action: "NOTE_ADDED",
        description: `Late arrival: clocked in ${minutesLate} min after scheduled start. Rating for this job reduced by ${penalty} stars.`,
      },
    });
  }

  // Accountability strike: 45+ minutes late without approved notice.
  // Admin can excuse it later if there was an approved notice.
  if (minutesLate >= STRIKE_LATE_MIN) {
    await applyStrike({
      cleanerId: actor.userId,
      reasonCode: "LATE_45",
      detail: `${minutesLate} min late to job #${job.jobNumber}`,
      jobId,
      dedupePerJob: true,
    }).catch((e) => console.error("late-arrival strike", e));
  }

  // Reported, never enforced (Sept 3 fix 4). A thin crew is a fact about the
  // job, not a reason to refuse the shift — the callers turn this into a
  // warning and the cleaner clocks in either way.
  return ok(
    {
      minutesLate,
      penalty,
      resumed: isResume,
      staffing: jobStaffing(job),
      sessionId,
    },
    effects,
  );
}

/**
 * Sept 10, item 4. Only the THROWN case is reported, never the refusals: "too
 * early", "not assigned" and "already clocked in" are the rules working, and a
 * feed that announces them would train the office to ignore it. This is the
 * case where the cleaner did everything right and the software did not.
 */
export async function reportClockInCrash(actor: Actor, jobId: string, error: unknown): Promise<void> {
  await recordAdminNotification({
    key: "admin.clock.clock_in_failed",
    title: `Clock-in failed — ${actor.name ?? "a cleaner"}`,
    body: error instanceof Error ? error.message.slice(0, 200) : "Unknown error",
    href: `/admin/jobs/${jobId}`,
    severity: "ERROR",
  });
}
