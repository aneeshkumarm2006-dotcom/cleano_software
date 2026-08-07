// Single source of truth for "which jobs does this cleaner see, and where".
//
// Before this module, My Jobs, the Cleaner Dashboard and the Cleaner Calendar
// each rolled their own "upcoming" predicate, so the SAME job could appear on
// one surface and vanish from another (IN_PROGRESS jobs missing from the
// dashboard, soft-deleted jobs still rendering on the calendar, "Upcoming"
// counts that were really just page-size artifacts).
//
// Every cleaner-facing query MUST go through these helpers so the surfaces
// agree. Rules baked in here:
//   • soft-deleted jobs (deletedAt) are never visible to a cleaner;
//   • a cleaner only sees jobs they LEAD (employeeId) or are ON (cleaners);
//   • "upcoming" runs to the end of the business day, so a job that already
//     started today is still upcoming until it's clocked out / completed;
//   • CANCELLED jobs are never upcoming and never on the calendar grid — they
//     live in their own Cancelled view.
//
// Pure where-clause builders (type-only Prisma import) so this stays cheap to
// import anywhere on the server.

import type { Prisma } from "@prisma/client";
import { startOfDayTz } from "@/lib/time";

/** Statuses that close a job out — never "upcoming" work. */
export const CLEANER_CLOSED_STATUSES = ["COMPLETED", "CANCELLED"] as const;

/** Statuses that count as finished work for the cleaner. */
export const CLEANER_DONE_STATUSES = ["COMPLETED", "PAID"] as const;

/**
 * Base scope: jobs this cleaner is allowed to see at all.
 * Authorization primitive — every cleaner job query starts here.
 */
export function cleanerAssignedWhere(cleanerId: string): Prisma.JobWhereInput {
  return {
    deletedAt: null,
    OR: [
      { employeeId: cleanerId },
      { cleaners: { some: { id: cleanerId } } },
    ],
  };
}

/**
 * Fragment (no cleaner scope): the job is still ahead of the cleaner.
 * Not completed, not cancelled, not clocked out, and starting no earlier than
 * the start of *today* in the business timezone.
 */
export function upcomingFilter(now: Date = new Date()): Prisma.JobWhereInput {
  return {
    status: { notIn: [...CLEANER_CLOSED_STATUSES] },
    clockOutTime: null,
    startTime: { gte: startOfDayTz(now) },
  };
}

/** Fragment: work the cleaner has finished (completed / paid / clocked out). */
export function doneFilter(): Prisma.JobWhereInput {
  return {
    OR: [
      { status: { in: [...CLEANER_DONE_STATUSES] } },
      { clockOutTime: { not: null }, status: { not: "CANCELLED" } },
    ],
  };
}

/** Fragment: jobs whose day has passed (business timezone). */
export function pastFilter(now: Date = new Date()): Prisma.JobWhereInput {
  return { startTime: { lt: startOfDayTz(now) } };
}

/** Fragment: cancelled jobs (their own section — never mixed into upcoming). */
export function cancelledFilter(): Prisma.JobWhereInput {
  return { status: "CANCELLED" };
}

/** Fragment: currently in progress (clocked in, not out). */
export function inProgressFilter(): Prisma.JobWhereInput {
  return {
    OR: [
      { status: "IN_PROGRESS" },
      { clockInTime: { not: null }, clockOutTime: null, status: { not: "CANCELLED" } },
    ],
  };
}

/** Everything the cleaner has coming up. Use for lists AND for counts. */
export function upcomingJobsWhere(
  cleanerId: string,
  now: Date = new Date()
): Prisma.JobWhereInput {
  return { ...cleanerAssignedWhere(cleanerId), AND: [upcomingFilter(now)] };
}

/** Everything the cleaner has finished. */
export function doneJobsWhere(cleanerId: string): Prisma.JobWhereInput {
  return { ...cleanerAssignedWhere(cleanerId), AND: [doneFilter()] };
}

/** Jobs whose day has passed. */
export function pastJobsWhere(
  cleanerId: string,
  now: Date = new Date()
): Prisma.JobWhereInput {
  return { ...cleanerAssignedWhere(cleanerId), AND: [pastFilter(now)] };
}

/** The cleaner's cancelled jobs (Cancelled section only). */
export function cancelledJobsWhere(cleanerId: string): Prisma.JobWhereInput {
  return { ...cleanerAssignedWhere(cleanerId), AND: [cancelledFilter()] };
}

/**
 * Calendar scope: everything assigned to the cleaner, past and future, minus
 * soft-deleted jobs. Cancelled jobs are included in the payload but the client
 * hides them by default (behind an explicit "Show cancelled" chip) and never
 * counts them — see CleanerCalendarClient.
 */
export function calendarJobsWhere(cleanerId: string): Prisma.JobWhereInput {
  return cleanerAssignedWhere(cleanerId);
}

/**
 * Available-jobs board scope: genuinely open, claimable work only.
 * Deliberately narrow — IN_PROGRESS / COMPLETED / PAID / CANCELLED jobs and
 * jobs the cleaner already leads or is already on are NOT claimable.
 */
export function claimableJobsWhere(
  cleanerId: string,
  now: Date = new Date()
): Prisma.JobWhereInput {
  return {
    deletedAt: null,
    status: { in: ["CREATED", "SCHEDULED"] },
    startTime: { gte: now },
    // Already ON the job (as a cleaner) or already LEADING it (employeeId) →
    // not claimable. The lead check was missing, so leads saw (and could claim)
    // their own jobs and ended up double-assigned.
    cleaners: { none: { id: cleanerId } },
    OR: [{ employeeId: null }, { employeeId: { not: cleanerId } }],
  };
}

/**
 * How early a cleaner may clock in, relative to the scheduled start.
 * Enforced server-side in clockIn.ts and mirrored in the job-detail UI.
 */
export const CLOCK_IN_EARLY_WINDOW_MIN = 120;

/** The moment clock-in opens for a job. */
export function clockInOpensAt(startTime: Date): Date {
  return new Date(startTime.getTime() - CLOCK_IN_EARLY_WINDOW_MIN * 60_000);
}

/**
 * Statuses a job can never be clocked into.
 *
 * COMPLETED was removed here in awerfixes.pdf item 6 (round 3): a cleaner who
 * clocks out and then has to go back — a forgotten room, a supply run, a second
 * visit the same day — needs to reopen a finished job, and that is precisely
 * what "clock back in" is. Doing so restores the job to IN_PROGRESS.
 *
 * PAID and CANCELLED stay blocked: the money has moved, or the work is off.
 * The same two statuses are RESUME_BLOCKED_STATUSES in src/lib/work-sessions.ts,
 * which is the pure copy the UI reads.
 */
export const CLOCK_IN_BLOCKED_STATUSES = ["CANCELLED", "PAID"] as const;
