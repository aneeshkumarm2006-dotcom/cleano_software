// Moving a job to a new date has to move the job, not its history.
//
// Rescheduling used to change only startTime/jobDate, so a booking that had
// already been clocked into arrived at next Tuesday still carrying yesterday's
// clock-in, an open work session and IN_PROGRESS status. Payroll then counted
// hours against a job that had not happened yet, and the cleaner's app showed
// them mid-shift on a job three days away.
//
// "The clock trail" means all four places the clock is written: the job-level
// mirror, the JobWorkSession rows, the JobBreak rows AND the per-cleaner
// JobAssignment row. Missing the last one is not a cosmetic gap — it is the
// one the admin Time Tracking page counts its open shifts from.
import "server-only";

import { db } from "@/lib/org-db";
import { logActivity } from "@/lib/activity-log";

export interface ClearedClockTrail {
  sessions: number;
  breaks: number;
  /** Per-cleaner JobAssignment rows reset back to ASSIGNED. */
  assignments: number;
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
      assignments: {
        select: {
          id: true,
          status: true,
          onMyWayAt: true,
          clockInTime: true,
          clockOutTime: true,
        },
      },
    },
  });
  if (!job || SETTLED.includes(job.status)) return null;

  // The PER-CLEANER rows, not the job-level mirror, are what the admin's
  // Time Tracking page counts: getClockActivity totals `openShifts` straight
  // off jobAssignment rows with a clockInTime and no clockOutTime. Clearing
  // only Job.clockInTime therefore left the phantom open shift ticking up
  // against a job dated a week and a half in the future -- visible to payroll,
  // invisible on the job itself.
  //
  // CANCELLED rows are left alone: that cleaner was taken off this job, and
  // resetting them to ASSIGNED would silently put them back on it. Everything
  // else goes back to ASSIGNED, which is exactly what a job nobody has started
  // yet looks like.
  const assignments = job.assignments.filter(
    (a) =>
      a.status !== "CANCELLED" &&
      (a.status !== "ASSIGNED" ||
        a.onMyWayAt != null ||
        a.clockInTime != null ||
        a.clockOutTime != null),
  );

  const hasTrail =
    job.clockInTime != null ||
    job.clockOutTime != null ||
    job.onMyWayAt != null ||
    job.workSessions.length > 0 ||
    job.breaks.length > 0 ||
    assignments.length > 0 ||
    job.status === "IN_PROGRESS";
  if (!hasTrail) return null;

  const minutes = Math.round(
    job.workSessions.reduce((total, s) => {
      const end = s.endedAt?.getTime() ?? Date.now();
      return total + Math.max(0, end - s.startedAt.getTime());
    }, 0) / 60000,
  );

  // INTERACTIVE transaction, not the array form. `db` here is the org-scoped
  // tenant client, whose model calls are EAGER -- `db.job.update(...)` fires
  // the moment it is written -- so the array form dispatched all three writes
  // outside any transaction and only then threw
  // "db.$transaction([...]) is not supported on the tenant client"
  // (see lib/org-db.ts). The clear was therefore neither atomic nor reported:
  // the throw jumped over the activity-log write below, so a half-cleared job
  // left no row in /admin/logs. Everything inside runs on `tx`.
  try {
    await db.$transaction(async (tx) => {
      await tx.jobWorkSession.deleteMany({ where: { jobId } });
      await tx.jobBreak.deleteMany({ where: { jobId } });
      if (assignments.length > 0) {
        await tx.jobAssignment.updateMany({
          where: { id: { in: assignments.map((a) => a.id) } },
          data: {
            status: "ASSIGNED",
            onMyWayAt: null,
            clockInTime: null,
            clockOutTime: null,
          },
        });
      }
      await tx.job.update({
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
      });
    });
  } catch (e) {
    // A failed clear is the dangerous outcome -- the job has already moved, so
    // silence here is what leaves a live shift pointing at a future date. It is
    // recorded where an admin will actually see it (/admin/logs) as well as in
    // the server log, and then rethrown so the caller can surface it too.
    console.error(
      `[job-reschedule] clearing the clock trail for job ${jobId} failed`,
      e,
    );
    await logActivity({
      category: "ADMIN",
      action: "job.reschedule.clock_clear_failed",
      status: "FAILED",
      targetType: "Job",
      targetId: jobId,
      message: `Rescheduled ${job.clientName}'s job, but its clock-in data could NOT be cleared — the job may still show as clocked in at its new date. Check Time Tracking.`,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }

  // Time data is never discarded quietly: this row is how an admin answers
  // "where did my hours go" without needing us to look in the database.
  await logActivity({
    category: "ADMIN",
    action: "job.reschedule.clock_cleared",
    status: "SUCCESS",
    targetType: "Job",
    targetId: jobId,
    message: `Rescheduled ${job.clientName}'s job, so its clock-in data was cleared: ${job.workSessions.length} work session${job.workSessions.length === 1 ? "" : "s"} (${minutes} min) and ${job.breaks.length} break${job.breaks.length === 1 ? "" : "s"} were removed, and ${assignments.length} cleaner assignment${assignments.length === 1 ? " was" : "s were"} reset to Assigned.`,
  }).catch(() => {});

  return {
    sessions: job.workSessions.length,
    breaks: job.breaks.length,
    assignments: assignments.length,
    minutes,
  };
}
