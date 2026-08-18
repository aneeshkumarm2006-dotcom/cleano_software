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
 * Fragment: the job's quote (if it has one) is settled, so it is real work.
 *
 * PDF #9 / Stage 11, step 11.7. A post-construction booking is created as a QUOTE
 * REQUEST — deposit paid, photos in, price provisional — and must not reach a
 * cleaner until an admin has priced it and the customer has accepted. Without this
 * a $200 deposit would put an unpriced job on the available-jobs board the moment
 * it was booked, where somebody could claim it and turn up.
 *
 * Written as `NULL or ACCEPTED` rather than `not in (…)` on purpose: in SQL,
 * `quoteStatus NOT IN ('PENDING_REVIEW', …)` is NULL — not TRUE — for the NULL
 * rows, which is every non-quote job in the business. Spelling the NULL case out
 * is what keeps this a guard on quotes instead of a filter that hides everything.
 */
export function quoteSettledFilter(): Prisma.JobWhereInput {
  return { OR: [{ quoteStatus: null }, { quoteStatus: "ACCEPTED" }] };
}

/**
 * Base scope: jobs this cleaner is allowed to see at all.
 * Authorization primitive — every cleaner job query starts here.
 *
 * The quote guard lives HERE rather than in each of the six derived helpers
 * below, so My Jobs, the dashboard, the calendar, the done/past/cancelled lists
 * and anything added later inherit it. `AND` (not a spread) because the `OR` key
 * is already spoken for by the assignment test — merging a second `OR` at the top
 * level would silently replace the first and widen this from "my jobs" to
 * "everyone's".
 */
export function cleanerAssignedWhere(cleanerId: string): Prisma.JobWhereInput {
  return {
    deletedAt: null,
    OR: [
      { employeeId: cleanerId },
      { cleaners: { some: { id: cleanerId } } },
    ],
    AND: [quoteSettledFilter()],
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

/**
 * The base scope with one more predicate ANDed on.
 *
 * ⚠️ The four helpers below used to spread `cleanerAssignedWhere` and then write
 * their own `AND:` key, which OVERWRITES whatever the base put there. That was
 * harmless while the base had no `AND` — and became a silent hole the moment
 * Stage 11 added the quote guard to it, since every one of those helpers would
 * have thrown the guard away. Composing through here is what makes "add a rule to
 * the base scope" mean it.
 */
function cleanerScopedWhere(
  cleanerId: string,
  extra: Prisma.JobWhereInput
): Prisma.JobWhereInput {
  const base = cleanerAssignedWhere(cleanerId);
  return { ...base, AND: [...(base.AND as Prisma.JobWhereInput[]), extra] };
}

/** Everything the cleaner has coming up. Use for lists AND for counts. */
export function upcomingJobsWhere(
  cleanerId: string,
  now: Date = new Date()
): Prisma.JobWhereInput {
  return cleanerScopedWhere(cleanerId, upcomingFilter(now));
}

/** Everything the cleaner has finished. */
export function doneJobsWhere(cleanerId: string): Prisma.JobWhereInput {
  return cleanerScopedWhere(cleanerId, doneFilter());
}

/** Jobs whose day has passed. */
export function pastJobsWhere(
  cleanerId: string,
  now: Date = new Date()
): Prisma.JobWhereInput {
  return cleanerScopedWhere(cleanerId, pastFilter(now));
}

/** The cleaner's cancelled jobs (Cancelled section only). */
export function cancelledJobsWhere(cleanerId: string): Prisma.JobWhereInput {
  return cleanerScopedWhere(cleanerId, cancelledFilter());
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
 * FIELD LEAD group scope: every job the lead OR any member of their group
 * leads (`employeeId`) or is assigned to (`cleaners`).
 *
 * The lead's own jobs are in here because `fieldLeadGroupIds()` puts the lead
 * first in the group — a lead coordinating a day needs to see their own work
 * next to their crew's, not a list with a hole where they are.
 *
 * `groupMemberIds` is passed IN rather than resolved from a lead id, because
 * resolving the group is a database read and this module is a pure where-clause
 * builder that client components import. The read lives in
 * `src/lib/field-lead-group.server.ts` (`fieldLeadGroupIds`), mirroring the
 * `field-lead-bonus.ts` / `field-lead-bonus.server.ts` split.
 *
 * FAILS CLOSED. An empty id list returns a predicate that matches nothing, not
 * one that matches everything — a lead with no group must see an empty
 * schedule, never the whole company's.
 */
export function fieldLeadScopedJobsWhere(
  groupMemberIds: string[]
): Prisma.JobWhereInput {
  const ids = Array.from(new Set(groupMemberIds.filter((id): id is string => !!id)));
  // `id: { in: [] }` is an unsatisfiable predicate — the deliberate closed door.
  if (ids.length === 0) return { id: { in: [] } };
  return {
    deletedAt: null,
    OR: [
      { employeeId: { in: ids } },
      { cleaners: { some: { id: { in: ids } } } },
    ],
    // A field lead's group schedule is a cleaner-facing surface, so it gets the
    // same quote guard (Stage 11, step 11.7). Largely belt-and-braces — an
    // unaccepted quote has no crew, so it would not match the ids above — but the
    // rule is "no cleaner sees unpriced work", not "no cleaner sees work we
    // happen to have left unassigned".
    AND: [quoteSettledFilter()],
  };
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
    // An unsettled quote is NOT claimable work (Stage 11 / PDF #9, step 11.7).
    // This board is the sharpest edge of the whole guard: a post-construction
    // quote is created as `status: CREATED` with no crew, which is exactly the
    // shape this predicate looks for — so without the guard every quote request
    // would appear here, at a provisional price, seconds after the deposit was
    // taken, ready for a cleaner to claim and show up to.
    AND: [quoteSettledFilter()],
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
