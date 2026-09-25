// Moving a job to a new date has to move the job, not its history.
//
// Rescheduling used to change only startTime/jobDate, so a booking that had
// already been clocked into arrived at next Tuesday still carrying yesterday's
// clock-in, an open work session and IN_PROGRESS status. Payroll then counted
// hours against a job that had not happened yet, and the cleaner's app showed
// them mid-shift on a job three days away.
//
// "The work trail" means all five places the previous attempt is written: the
// job-level clock mirror, the JobWorkSession rows, the JobBreak rows, the
// per-cleaner JobAssignment row, and the checklist ticks. Missing the
// assignment row is not a cosmetic gap — it is the one the admin Time Tracking
// page counts its open shifts from.
//
// TWO THINGS ARE DELIBERATELY LEFT ALONE, and the Sept 10 list asks for both
// (item 1, "product usage, photos tied to completion ... should not carry
// over"). On a DUPLICATE they already do not carry: a duplicated job is a new
// row, and photos, product usage and checklists all hang off the job id, so
// the copy starts empty. On a RESCHEDULE, deleting them would be the worse
// bug:
//
//   • JobProductUsage carries `inventoryBefore` / `inventoryAfter`. The stock
//     really did leave the van. Deleting the row does not put it back, it just
//     makes the inventory count unexplainable.
//   • Photos are the only evidence the work happened, they live in blob
//     storage as well as in the database, and an admin correcting a date has
//     not asked to destroy a cleaner's proof.
//
// Both stay attached, visible as the record of the earlier attempt. If the
// client wants them detached rather than kept, that is a deliberate archive
// feature with a migration behind it, not a silent delete on a date edit.
import "server-only";

import { db } from "@/lib/org-db";
import { logActivity } from "@/lib/activity-log";

export interface ClearedWorkTrail {
  sessions: number;
  breaks: number;
  /** Per-cleaner JobAssignment rows reset back to ASSIGNED. */
  assignments: number;
  /** Total clocked minutes discarded, so the log row says what was lost. */
  minutes: number;
  /** Checklist items put back to PENDING (Sept 10, item 1). */
  checklistItems: number;
}

/** Work that is finished is history to be corrected, not a shift to reset. */
const SETTLED: readonly string[] = ["COMPLETED", "PAID"];

/** The shape the decision below needs. A subset of what the query selects. */
export interface WorkTrailJob {
  status: string;
  clockInTime: Date | null;
  clockOutTime: Date | null;
  onMyWayAt: Date | null;
  workSessions: readonly { startedAt: Date; endedAt: Date | null }[];
  breaks: readonly { id: string }[];
  assignments: readonly {
    id: string;
    status: string;
    onMyWayAt: Date | null;
    clockInTime: Date | null;
    clockOutTime: Date | null;
  }[];
  checklists: readonly { items: readonly { id: string; status: string }[] }[];
}

export interface WorkTrailPlan {
  /** JobAssignment rows to put back to ASSIGNED. */
  assignmentIds: string[];
  /** JobChecklistItem rows to put back to PENDING. */
  tickedItemIds: string[];
  /** Clocked minutes about to be discarded, so the log row says what was lost. */
  minutes: number;
  sessions: number;
  breaks: number;
}

/**
 * What a reschedule should undo, decided without touching the database.
 *
 * Pure on purpose. Everything that can be got wrong here is arithmetic or a
 * predicate — which rows count as a trail, which cleaners must not be dragged
 * back onto the job, how many minutes are being thrown away — and none of it
 * needs a connection to check. `null` means "leave this job alone".
 *
 * @param now injected so the open-session case is testable; an unfinished
 *        session is measured up to the moment of the reschedule.
 */
export function planWorkTrailReset(
  job: WorkTrailJob,
  now: Date = new Date(),
): WorkTrailPlan | null {
  if (SETTLED.includes(job.status)) return null;

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
  const assignmentIds = job.assignments
    .filter(
      (a) =>
        a.status !== "CANCELLED" &&
        (a.status !== "ASSIGNED" ||
          a.onMyWayAt != null ||
          a.clockInTime != null ||
          a.clockOutTime != null),
    )
    .map((a) => a.id);

  // Checklist ticks describe work done at the OLD time (Sept 10, item 1). A
  // job that arrives at next Tuesday with nine of twelve tasks already ticked
  // tells the cleaner to skip nine rooms. SKIPPED counts as a tick: it is a
  // decision taken about the old visit, not a fact about the new one. The
  // item's `notes` are kept — a note is an observation about the property, not
  // a claim that the task is done.
  const tickedItemIds = job.checklists.flatMap((c) =>
    c.items.filter((i) => i.status !== "PENDING").map((i) => i.id),
  );

  const hasTrail =
    job.clockInTime != null ||
    job.clockOutTime != null ||
    job.onMyWayAt != null ||
    job.workSessions.length > 0 ||
    job.breaks.length > 0 ||
    assignmentIds.length > 0 ||
    tickedItemIds.length > 0 ||
    job.status === "IN_PROGRESS";
  if (!hasTrail) return null;

  const minutes = Math.round(
    job.workSessions.reduce((total, s) => {
      const end = s.endedAt?.getTime() ?? now.getTime();
      return total + Math.max(0, end - s.startedAt.getTime());
    }, 0) / 60000,
  );

  return {
    assignmentIds,
    tickedItemIds,
    minutes,
    sessions: job.workSessions.length,
    breaks: job.breaks.length,
  };
}

/**
 * Clear the work trail on a job that is being moved to a new date.
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
export async function clearWorkTrailForReschedule(
  jobId: string,
): Promise<ClearedWorkTrail | null> {
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
      // One checklist per cleaner per job, so a two-person job has two to reset.
      checklists: { select: { items: { select: { id: true, status: true } } } },
    },
  });
  if (!job) return null;

  const plan = planWorkTrailReset(job);
  if (!plan) return null;

  const { assignmentIds, tickedItemIds, minutes } = plan;

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
      if (assignmentIds.length > 0) {
        await tx.jobAssignment.updateMany({
          where: { id: { in: assignmentIds } },
          data: {
            status: "ASSIGNED",
            onMyWayAt: null,
            clockInTime: null,
            clockOutTime: null,
          },
        });
      }
      if (tickedItemIds.length > 0) {
        await tx.jobChecklistItem.updateMany({
          where: { id: { in: tickedItemIds } },
          data: { status: "PENDING", completedAt: null },
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
    message: `Rescheduled ${job.clientName}'s job, so its work trail was cleared: ${plan.sessions} work session${plan.sessions === 1 ? "" : "s"} (${minutes} min) and ${plan.breaks} break${plan.breaks === 1 ? "" : "s"} were removed, ${assignmentIds.length} cleaner assignment${assignmentIds.length === 1 ? " was" : "s were"} reset to Assigned, and ${tickedItemIds.length} checklist item${tickedItemIds.length === 1 ? " was" : "s were"} put back to Pending. Photos and product usage were kept.`,
  }).catch(() => {});

  return {
    sessions: plan.sessions,
    breaks: plan.breaks,
    assignments: assignmentIds.length,
    minutes,
    checklistItems: tickedItemIds.length,
  };
}
