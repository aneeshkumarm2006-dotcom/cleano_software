"use server";

import { db } from "@/db";
import { requireOwnerAdmin } from "@/lib/action-guards";
import {
  activeMinutes,
  isStaleOpenShift,
  openShiftMinutes,
  resolveClockEntry,
  summariseBreaks,
} from "@/lib/time-tracking";
import type {
  ClockActivityEntry,
  ClockActivityPage,
} from "./getClockActivity.types";

/**
 * Recent clock-in / clock-out activity across all employees (item 12).
 *
 * Reads `JobAssignment` (per-cleaner clock times) and falls back to the
 * job-level `clockInTime`/`clockOutTime` for jobs created before per-cleaner
 * assignment rows existed — otherwise the history would look empty for older
 * work.
 *
 * Cursor pagination on the job's start time + id: the list is ordered by when
 * the work happened, and offset paging would shift rows as jobs are edited.
 *
 * OWNER/ADMIN only — this exposes every employee's hours.
 */

const PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

export async function getClockActivity(input?: {
  cursor?: string | null;
  pageSize?: number;
  cleanerId?: string | null;
  /** "all" (default) | "open" — only shifts with no clock-out yet. */
  filter?: "all" | "open";
}): Promise<
  { success: true; page: ClockActivityPage } | { success: false; error: string }
> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { success: false, error: guard.error };

  const requested = Number(input?.pageSize);
  const take = Number.isFinite(requested)
    ? Math.min(Math.max(1, Math.trunc(requested)), MAX_PAGE_SIZE)
    : PAGE_SIZE;

  const cursor =
    typeof input?.cursor === "string" && input.cursor.trim()
      ? input.cursor.trim()
      : null;
  const cleanerId =
    typeof input?.cleanerId === "string" && input.cleanerId.trim()
      ? input.cleanerId.trim()
      : null;
  const openOnly = input?.filter === "open";

  try {
    // Only jobs where SOMEONE has actually clocked something, so the page is
    // clock activity rather than a second jobs list.
    const jobs = await db.job.findMany({
      where: {
        deletedAt: null,
        OR: [
          { clockInTime: { not: null } },
          { assignments: { some: { clockInTime: { not: null } } } },
          { assignments: { some: { onMyWayAt: { not: null } } } },
        ],
        ...(cleanerId
          ? {
              OR: [
                { employeeId: cleanerId },
                { assignments: { some: { cleanerId } } },
              ],
            }
          : {}),
      },
      orderBy: [{ startTime: "desc" }, { id: "desc" }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        jobNumber: true,
        clientName: true,
        jobType: true,
        startTime: true,
        clockInTime: true,
        clockOutTime: true,
        onMyWayAt: true,
        employeeId: true,
        employee: { select: { id: true, name: true } },
        assignments: {
          select: {
            id: true,
            cleanerId: true,
            status: true,
            onMyWayAt: true,
            clockInTime: true,
            clockOutTime: true,
            cleaner: { select: { id: true, name: true } },
          },
        },
        // Breaks (item 26) — reported separately from worked time so payroll
        // review can see active vs elapsed.
        breaks: {
          select: { cleanerId: true, startedAt: true, endedAt: true },
        },
      },
    });

    const hasMore = jobs.length > take;
    const pageJobs = hasMore ? jobs.slice(0, take) : jobs;
    const now = new Date();

    const entries: ClockActivityEntry[] = [];

    for (const job of pageJobs) {
      const relevant = cleanerId
        ? job.assignments.filter((a) => a.cleanerId === cleanerId)
        : job.assignments;

      if (relevant.length > 0) {
        for (const a of relevant) {
          const entry = resolveClockEntry({ assignment: a });
          const brk = summariseBreaks(
            job.breaks.filter((b) => b.cleanerId === a.cleanerId),
            now
          );
          if (openOnly && !entry.isOpen) continue;
          // Skip rows where nothing has happened yet — "assigned" is not
          // clock activity.
          if (entry.status === "NOT_STARTED") continue;
          entries.push({
            id: a.id,
            jobId: job.id,
            jobNumber: job.jobNumber,
            clientName: job.clientName,
            jobType: job.jobType,
            scheduledStart: job.startTime.toISOString(),
            cleanerId: a.cleaner?.id ?? a.cleanerId,
            cleanerName: a.cleaner?.name ?? "Unknown",
            clockInTime: entry.clockInTime?.toISOString() ?? null,
            clockOutTime: entry.clockOutTime?.toISOString() ?? null,
            status: entry.status,
            minutesWorked: entry.minutesWorked,
            breakMinutes: brk.minutes,
            activeMinutes: activeMinutes(entry.minutesWorked, brk.minutes),
            isOnBreak: brk.isOnBreak,
            openMinutes: openShiftMinutes(entry, now),
            isStale: isStaleOpenShift(entry, now),
            isLegacy: false,
          });
        }
      } else {
        // Legacy job: no per-cleaner rows, so report the job-level clock.
        const entry = resolveClockEntry({
          jobClockIn: job.clockInTime,
          jobClockOut: job.clockOutTime,
          jobOnMyWayAt: job.onMyWayAt,
        });
        const legacyBreaks = summariseBreaks(job.breaks, now);
        if (entry.status === "NOT_STARTED") continue;
        if (openOnly && !entry.isOpen) continue;
        entries.push({
          id: job.id,
          jobId: job.id,
          jobNumber: job.jobNumber,
          clientName: job.clientName,
          jobType: job.jobType,
          scheduledStart: job.startTime.toISOString(),
          cleanerId: job.employee?.id ?? job.employeeId,
          cleanerName: job.employee?.name ?? "Unassigned",
          clockInTime: entry.clockInTime?.toISOString() ?? null,
          clockOutTime: entry.clockOutTime?.toISOString() ?? null,
          status: entry.status,
          minutesWorked: entry.minutesWorked,
          breakMinutes: legacyBreaks.minutes,
          activeMinutes: activeMinutes(entry.minutesWorked, legacyBreaks.minutes),
          isOnBreak: legacyBreaks.isOnBreak,
          openMinutes: openShiftMinutes(entry, now),
          isStale: isStaleOpenShift(entry, now),
          isLegacy: true,
        });
      }
    }

    // Open/stale counts are computed over ALL activity, not just this page —
    // a stale shift 200 rows down still needs to be surfaced at the top.
    const openAssignments = await db.jobAssignment.findMany({
      where: {
        clockInTime: { not: null },
        clockOutTime: null,
        job: { deletedAt: null },
        ...(cleanerId ? { cleanerId } : {}),
      },
      select: { clockInTime: true, clockOutTime: true, status: true },
    });
    let staleShifts = 0;
    for (const a of openAssignments) {
      if (isStaleOpenShift(resolveClockEntry({ assignment: a }), now)) {
        staleShifts += 1;
      }
    }

    return {
      success: true,
      page: {
        entries,
        nextCursor: hasMore ? pageJobs[pageJobs.length - 1].id : null,
        totals: { openShifts: openAssignments.length, staleShifts },
      },
    };
  } catch (error) {
    console.error("getClockActivity failed", error);
    return { success: false, error: "Could not load clock activity." };
  }
}
