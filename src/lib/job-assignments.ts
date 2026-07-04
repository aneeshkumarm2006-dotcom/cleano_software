// Per-cleaner JobAssignment sync + status helpers (client-fixes item 9).
//
// JobAssignment rows complement the implicit Job.cleaners M2M with a live
// per-cleaner status (ASSIGNED → ON_THE_WAY → CLOCKED_IN → CLOCKED_OUT →
// COMPLETED / CANCELLED) and timestamps. Legacy jobs created before this
// feature have no rows — read-side code derives a fallback status from the
// job-level clockInTime/clockOutTime/onMyWayAt fields instead.

import { db } from "@/db";
import type { JobCleanerStatus } from "@prisma/client";

/**
 * Reconcile JobAssignment rows with the cleaners currently assigned to a job.
 * Upserts an ASSIGNED row per cleaner (existing rows keep their live status)
 * and removes rows for cleaners no longer on the job, preserving CANCELLED
 * rows as history.
 */
export async function syncJobAssignments(jobId: string, cleanerIds: string[]) {
  const ids = Array.from(new Set(cleanerIds.filter((id): id is string => !!id)));

  try {
    // Remove rows for cleaners taken off the job (keep CANCELLED history).
    await db.jobAssignment.deleteMany({
      where: {
        jobId,
        cleanerId: { notIn: ids },
        status: { not: "CANCELLED" },
      },
    });

    for (const cleanerId of ids) {
      await db.jobAssignment.upsert({
        where: { jobId_cleanerId: { jobId, cleanerId } },
        // Existing rows keep whatever live status they already reached.
        update: {},
        create: { jobId, cleanerId, status: "ASSIGNED" },
      });
    }
  } catch (e) {
    // Assignment rows are a status overlay — never fail the parent action.
    console.error("syncJobAssignments failed", jobId, e);
  }
}

/**
 * Record a status transition on ONE cleaner's assignment row. Upserts so
 * legacy jobs without rows still start tracking from the first action.
 */
export async function setAssignmentProgress(
  jobId: string,
  cleanerId: string,
  data: {
    status: JobCleanerStatus;
    onMyWayAt?: Date;
    clockInTime?: Date;
    clockOutTime?: Date;
  }
) {
  try {
    await db.jobAssignment.upsert({
      where: { jobId_cleanerId: { jobId, cleanerId } },
      update: data,
      create: { jobId, cleanerId, ...data },
    });
  } catch (e) {
    console.error("setAssignmentProgress failed", jobId, cleanerId, e);
  }
}
