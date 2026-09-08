// Moving a job to a new date has to move the job, not its history.
//
// Rescheduling used to change only startTime/jobDate, so a booking that had
// already been clocked into arrived at next Tuesday still carrying yesterday's
// clock-in, an open work session and IN_PROGRESS status. Payroll then counted
// hours against a job that had not happened yet, and the cleaner's app showed
// them mid-shift on a job three days away.
import "server-only";

import { db } from "@/lib/org-db";
import { logActivity } from "@/lib/activity-log";

export interface ClearedClockTrail {
  sessions: number;
  breaks: number;
  /** Total clocked minutes discarded, so the log row says what was lost. */
  minutes: number;
}

/** Work that is finished is history to be corrected, not a shift to reset. */
const SETTLED: readonly string[] = ["COMPLETED", "PAID"];

/**
 * Clear the clock trail on a job that is being moved to a new date.
 *
 * Returns what was discarded, or null when there was nothing to clear or the
 * job is settled. A COMPLETED or PAID job is deliberately left alone: an admin
 * correcting the date on a finished job is fixing a record, and wiping the
 * hours it was paid from would be the more expensive bug.
 *
 * Call this only when the date ACTUALLY changed. Every save posts a date, and
 * clearing on a save that moved nothing would erase a live shift because
 * somebody edited a note.
 */
export async function clearClockTrailForReschedule(
  jobId: string,
): Promise<ClearedClockTrail | null> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      status: true,
      clockInTime: true,
      clockOutTime: true,
      onMyWayAt: true,
      clientName: true,
      workSessions: { select: { id: true, startedAt: true, endedAt: true } },
      breaks: { select: { id: true } },
    },
  });
  if (!job || SETTLED.includes(job.status)) return null;

  const hasTrail =
    job.clockInTime != null ||
    job.clockOutTime != null ||
    job.onMyWayAt != null ||
    job.workSessions.length > 0 ||
    job.breaks.length > 0 ||
    job.status === "IN_PROGRESS";
  if (!hasTrail) return null;

  const minutes = Math.round(
    job.workSessions.reduce((total, s) => {
      const end = s.endedAt?.getTime() ?? Date.now();
      return total + Math.max(0, end - s.startedAt.getTime());
    }, 0) / 60000,
  );

  await db.$transaction([
    db.jobWorkSession.deleteMany({ where: { jobId } }),
    db.jobBreak.deleteMany({ where: { jobId } }),
    db.job.update({
      where: { id: jobId },
      data: {
        clockInTime: null,
        clockOutTime: null,
        onMyWayAt: null,
        onMyWayLat: null,
        onMyWayLng: null,
        onMyWayLocationAt: null,
        noShowAt: null,
        lateArrivalAt: null,
        lateArrivalRatingPenalty: null,
        // Hours read off the clock go with the clock. An admin-entered figure
        // on a settled job never reaches here, because settled jobs return above.
        billedActualHours: null,
        // A job nobody has started yet is scheduled, whatever it was mid-move.
        ...(job.status === "IN_PROGRESS" ? { status: "SCHEDULED" as const } : {}),
      },
    }),
  ]);

  // Time data is never discarded quietly: this row is how an admin answers
  // "where did my hours go" without needing us to look in the database.
  await logActivity({
    category: "ADMIN",
    action: "job.reschedule.clock_cleared",
    status: "SUCCESS",
    targetType: "Job",
    targetId: jobId,
    message: `Rescheduled ${job.clientName}'s job, so its clock-in data was cleared: ${job.workSessions.length} work session${job.workSessions.length === 1 ? "" : "s"} (${minutes} min) and ${job.breaks.length} break${job.breaks.length === 1 ? "" : "s"} were removed.`,
  }).catch(() => {});

  return { sessions: job.workSessions.length, breaks: job.breaks.length, minutes };
}
