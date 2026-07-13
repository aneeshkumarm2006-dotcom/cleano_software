// Per-cleaner JobAssignment sync + status helpers (client-fixes item 9).
//
// JobAssignment rows complement the implicit Job.cleaners M2M with a live
// per-cleaner status (ASSIGNED → ON_THE_WAY → CLOCKED_IN → CLOCKED_OUT →
// COMPLETED / CANCELLED) and timestamps. Legacy jobs created before this
// feature have no rows — read-side code derives a fallback status from the
// job-level clockInTime/clockOutTime/onMyWayAt fields instead.

import { db } from "@/db";
import type { JobCleanerStatus } from "@prisma/client";
import {
  availabilityWarning,
  dateKeyToStoredDate,
  evaluateAvailability,
  windowFromInstants,
  type AvailabilityEvaluation,
  type AvailabilityWindow,
} from "@/lib/availability";
import type { AvailabilityConflict } from "@/app/admin/actions/checkAvailability.types";

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

/**
 * Spec rule (pay/rating doc item 2): a Trainee must always work paired with a
 * Field Lead — never assigned solo (a lone trainee would be paid a flat 30% of
 * the full price, which the spec forbids). Returns an error message when the
 * assignment breaks the rule, or null when it's fine.
 */
export async function validateTraineePairing(
  cleanerIds: string[]
): Promise<string | null> {
  const ids = Array.from(new Set(cleanerIds.filter((id): id is string => !!id)));
  if (ids.length === 0) return null;
  const crew = await db.user.findMany({
    where: { id: { in: ids } },
    select: { cleanerTier: true },
  });
  const hasTrainee = crew.some((c) => c.cleanerTier === "TRAINEE");
  const hasFieldLead = crew.some((c) => c.cleanerTier === "FIELD_LEAD");
  if (hasTrainee && !hasFieldLead) {
    return "A Trainee must be paired with a Field Lead on the job. Add a Field Lead or change the trainee's assignment.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Availability conflicts (cleaner-app item 8)
//
// The DB-reading half of the availability engine. The pure evaluation rules live
// in `src/lib/availability.ts` (shared with the client-side pickers); everything
// here just loads the recurring weekly rules + one-off blocked dates and hands
// them over. Conflicts are ALWAYS advisory — assignment actions surface them as
// warnings and never hard-block, because admins must be able to override.
// ---------------------------------------------------------------------------

/**
 * Evaluate a wall-clock window for several employees in two queries.
 * Returns a map keyed by employeeId; employees with no rules resolve to NO_DATA.
 */
export async function evaluateEmployeesAvailability(
  employeeIds: string[],
  window: AvailabilityWindow
): Promise<Map<string, AvailabilityEvaluation>> {
  const ids = Array.from(new Set(employeeIds.filter((id): id is string => !!id)));
  const out = new Map<string, AvailabilityEvaluation>();
  if (ids.length === 0) return out;

  const storedDate = dateKeyToStoredDate(window.dateKey);

  const [rules, exceptions] = await Promise.all([
    db.employeeAvailability.findMany({
      where: { employeeId: { in: ids } },
      select: {
        employeeId: true,
        day: true,
        startTime: true,
        endTime: true,
        isAvailable: true,
        effectiveFrom: true,
        effectiveTo: true,
      },
    }),
    storedDate
      ? db.availabilityException.findMany({
          where: { employeeId: { in: ids }, date: storedDate },
          select: { employeeId: true, date: true, reason: true },
        })
      : Promise.resolve([]),
  ]);

  for (const id of ids) {
    out.set(
      id,
      evaluateAvailability(
        window,
        rules.filter((r) => r.employeeId === id),
        exceptions.filter((e) => e.employeeId === id)
      )
    );
  }
  return out;
}

/**
 * Evaluate ONE employee against MANY windows (bulk assign across jobs) in two
 * queries total — the rules and the blocked dates are loaded once, not per job.
 * The returned array is index-aligned with `windows`.
 */
export async function evaluateEmployeeWindows(
  employeeId: string,
  windows: AvailabilityWindow[]
): Promise<AvailabilityEvaluation[]> {
  if (!employeeId || windows.length === 0) return [];

  const dates = windows
    .map((w) => dateKeyToStoredDate(w.dateKey))
    .filter((d): d is Date => d !== null);

  const [rules, exceptions] = await Promise.all([
    db.employeeAvailability.findMany({
      where: { employeeId },
      select: {
        day: true,
        startTime: true,
        endTime: true,
        isAvailable: true,
        effectiveFrom: true,
        effectiveTo: true,
      },
    }),
    dates.length > 0
      ? db.availabilityException.findMany({
          where: { employeeId, date: { in: dates } },
          select: { date: true, reason: true },
        })
      : Promise.resolve([]),
  ]);

  // evaluateAvailability matches the exception to the window's own date key, so
  // handing it the whole set is safe.
  return windows.map((w) => evaluateAvailability(w, rules, exceptions));
}

/**
 * Conflicts for a set of cleaners against a job's scheduled window. Only
 * genuine conflicts come back (AVAILABLE and NO_DATA are dropped), each with a
 * ready-to-render warning line.
 */
export async function findAvailabilityConflicts(
  cleanerIds: string[],
  start: Date,
  end?: Date | null
): Promise<AvailabilityConflict[]> {
  const ids = Array.from(new Set(cleanerIds.filter((id): id is string => !!id)));
  if (ids.length === 0 || Number.isNaN(start.getTime())) return [];

  try {
    const window = windowFromInstants(start, end ?? null);
    const [evaluations, cleaners] = await Promise.all([
      evaluateEmployeesAvailability(ids, window),
      db.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      }),
    ]);

    const conflicts: AvailabilityConflict[] = [];
    for (const cleaner of cleaners) {
      const ev = evaluations.get(cleaner.id);
      if (!ev) continue;
      const warning = availabilityWarning(cleaner.name, ev);
      if (!warning) continue;
      conflicts.push({
        ...ev,
        cleanerId: cleaner.id,
        cleanerName: cleaner.name,
        warning,
      });
    }
    return conflicts;
  } catch (e) {
    // Advisory only — never fail an assignment because the warning lookup broke.
    console.error("findAvailabilityConflicts failed", e);
    return [];
  }
}
