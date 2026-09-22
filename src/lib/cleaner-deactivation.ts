// Taking a cleaner off the schedule when they are switched off.
//
// Sept 17 list, item 23. Deactivating a cleaner locked them out of the app and
// did nothing else, so every job they were already booked on kept their name
// against it. The calendar showed a full crew, the Jobs table showed the job
// covered, and nobody found out until the morning of the clean.
//
// WHAT THIS DOES NOT TOUCH. Past and in-flight jobs keep the cleaner attached,
// which the PDF asks for outright: "past completed jobs should keep the cleaner
// attached for payroll, history, reporting, and records." A cleaner who worked
// Tuesday is paid for Tuesday whatever happens on Thursday. Only jobs that have
// not started yet are unassigned.
import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/org-db";
import { logActivity } from "@/lib/activity-log";
import { recordAdminNotification } from "@/lib/admin-notifications";
import { resolveJobLead } from "@/lib/job-assignments";
import { startOfStoreDay } from "@/lib/timezone";

/** A job that is over, one way or the other. Never reassigned. */
const SETTLED_STATUSES = ["COMPLETED", "CANCELLED", "PAID"] as const;

/**
 * Jobs a cleaner is on that have not happened yet.
 *
 * Pure, and shared by the preview and the write, so the number the admin is
 * warned about is the number that actually changes. Two functions asking the
 * same question two ways is how a confirmation dialog starts lying.
 *
 * "Not yet" is measured from the start of TODAY in the business timezone, not
 * from this instant. A job at 9 AM that an admin is deactivating someone from
 * at 2 PM is today's work, already begun or about to be, and pulling a cleaner
 * off it silently in the middle of the afternoon is not what anyone means by
 * "future jobs".
 */
export function futureAssignedJobsWhere(
  cleanerIds: string[],
  now: Date = new Date(),
): Prisma.JobWhereInput {
  return {
    deletedAt: null,
    startTime: { gte: startOfStoreDay(now) },
    status: { notIn: [...SETTLED_STATUSES] },
    // Both halves of an assignment. A cleaner can be the lead (`employeeId`),
    // a member of the crew (`cleaners`), or — on every modern job — both.
    OR: [
      { employeeId: { in: cleanerIds } },
      { cleaners: { some: { id: { in: cleanerIds } } } },
    ],
  };
}

export interface DeactivationImpact {
  /** How many upcoming jobs name at least one of these cleaners. */
  jobCount: number;
  /** How many of those would be left with nobody on them at all. */
  leftUnassigned: number;
  /** The soonest one, so the warning can say how urgent this is. */
  soonest: Date | null;
}

/**
 * What deactivating these cleaners would do, without doing it.
 *
 * The PDF asks for this specifically: "admin should see a warning before
 * deactivating the cleaner showing how many future jobs will be affected."
 */
export async function previewCleanerDeactivation(
  cleanerIds: string[],
  now: Date = new Date(),
): Promise<DeactivationImpact> {
  const ids = Array.from(new Set(cleanerIds.filter(Boolean)));
  if (ids.length === 0) return { jobCount: 0, leftUnassigned: 0, soonest: null };

  const jobs = await db.job.findMany({
    where: futureAssignedJobsWhere(ids, now),
    select: {
      startTime: true,
      employeeId: true,
      cleaners: { select: { id: true } },
    },
    orderBy: { startTime: "asc" },
  });

  const leftUnassigned = jobs.filter((j) => {
    const remaining = j.cleaners.map((c) => c.id).filter((id) => !ids.includes(id));
    return resolveJobLead(
      j.employeeId && !ids.includes(j.employeeId) ? j.employeeId : null,
      remaining,
    ) === null;
  }).length;

  return {
    jobCount: jobs.length,
    leftUnassigned,
    soonest: jobs[0]?.startTime ?? null,
  };
}

export interface DeactivationResult {
  jobsChanged: number;
  leftUnassigned: number;
}

/**
 * Take these cleaners off every job that has not happened yet.
 *
 * Mirrors `cancelShift` exactly, because it is the same act from the other
 * side of the desk: disconnect from the crew, hand the lead to whoever is
 * left, mark the `JobAssignment` row CANCELLED rather than deleting it, and
 * write a job log. Keeping the row is what stops the cleaner reappearing in
 * payroll as a ghost head — see Sept 10 items 3 and 5, where exactly that row
 * was being counted as payable.
 *
 * Per job rather than in one sweeping `updateMany`, because the new lead is a
 * different answer for every job and there is no way to express that in a bulk
 * update. Upcoming jobs per cleaner is a small number.
 *
 * Never throws. Deactivation is an access decision and must not fail because
 * the schedule could not be tidied; what did not happen is recorded instead.
 */
export async function unassignFutureJobs(
  cleanerIds: string[],
  now: Date = new Date(),
): Promise<DeactivationResult> {
  const ids = Array.from(new Set(cleanerIds.filter(Boolean)));
  if (ids.length === 0) return { jobsChanged: 0, leftUnassigned: 0 };

  let jobsChanged = 0;
  let leftUnassigned = 0;

  try {
    const jobs = await db.job.findMany({
      where: futureAssignedJobsWhere(ids, now),
      select: {
        id: true,
        jobNumber: true,
        clientName: true,
        startTime: true,
        employeeId: true,
        cleaners: { select: { id: true } },
      },
    });

    for (const job of jobs) {
      const remaining = job.cleaners
        .map((c) => c.id)
        .filter((id) => !ids.includes(id));
      // The lead only moves if the lead is one of the people leaving. A job
      // whose lead sits outside the crew list (legacy rows predate the two
      // being kept in step) must not lose that lead to someone else's exit.
      const nextLead =
        job.employeeId && ids.includes(job.employeeId)
          ? resolveJobLead(null, remaining)
          : job.employeeId;

      try {
        await db.$transaction(async (tx) => {
          await tx.job.update({
            where: { id: job.id },
            data: {
              cleaners: { disconnect: ids.map((id) => ({ id })) },
              employeeId: nextLead,
            },
          });
          await tx.jobAssignment.updateMany({
            where: { jobId: job.id, cleanerId: { in: ids } },
            data: { status: "CANCELLED" },
          });
          await tx.jobLog.create({
            data: {
              jobId: job.id,
              action: "CLEANER_REMOVED",
              description:
                nextLead === null
                  ? "A cleaner was deactivated and taken off this job. Nobody is assigned to it now."
                  : "A cleaner was deactivated and taken off this job.",
            },
          });
        });
        jobsChanged++;
        if (nextLead === null) leftUnassigned++;
      } catch (e) {
        // One job failing must not abandon the rest — the remaining jobs still
        // have a deactivated cleaner on them, which is the state this exists
        // to prevent.
        console.error(`[deactivation] could not unassign job ${job.id}`, e);
        await logActivity({
          category: "ADMIN",
          action: "employee.deactivate.unassign_failed",
          status: "FAILED",
          targetType: "Job",
          targetId: job.id,
          message: `A deactivated cleaner could NOT be taken off job #${job.jobNumber} (${job.clientName}). They may still show as assigned.`,
          error: e instanceof Error ? e.message : String(e),
        }).catch(() => {});
      }
    }

    if (jobsChanged > 0) {
      await logActivity({
        category: "ADMIN",
        action: "employee.deactivate.unassigned",
        status: "SUCCESS",
        message: `Deactivating ${ids.length} cleaner${ids.length === 1 ? "" : "s"} took them off ${jobsChanged} upcoming job${jobsChanged === 1 ? "" : "s"}${leftUnassigned > 0 ? `, ${leftUnassigned} of which now has nobody assigned` : ""}. Past jobs were left untouched.`,
      }).catch(() => {});
    }

    // The jobs that now have nobody on them are the ones that will be missed,
    // so they get a feed entry of their own rather than being a clause in a
    // log line nobody reads.
    if (leftUnassigned > 0) {
      await recordAdminNotification({
        key: "admin.jobs.unassigned_by_deactivation",
        title: `${leftUnassigned} upcoming job${leftUnassigned === 1 ? "" : "s"} now ${leftUnassigned === 1 ? "has" : "have"} nobody assigned`,
        body: "A cleaner was deactivated and came off them. They need reassigning.",
        href: "/admin/jobs?attention=unassigned",
        severity: "WARN",
      });
    }
  } catch (e) {
    console.error("[deactivation] could not read upcoming jobs", e);
    await logActivity({
      category: "ADMIN",
      action: "employee.deactivate.unassign_failed",
      status: "FAILED",
      message:
        "A cleaner was deactivated but their upcoming jobs could not be read, so they may still be assigned to them.",
      error: e instanceof Error ? e.message : String(e),
    }).catch(() => {});
  }

  return { jobsChanged, leftUnassigned };
}
