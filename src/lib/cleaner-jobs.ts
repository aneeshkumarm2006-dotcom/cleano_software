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
import { ON_HOLD_STATUS } from "@/lib/job-hold";

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
 * Starting no earlier than the start of *today* in the business timezone, and
 * not already clocked out.
 *
 * ── Round 4, fix 2 ─────────────────────────────────────────────────────────
 * A cleaner was assigned to a job on Aug 19 and the job never appeared on their
 * schedule (IMG-2/IMG-3). The assignment had saved perfectly — M2M row,
 * `JobAssignment` row and `employeeId` all named her. What hid the job was its
 * *status*: something had stamped a job dated TOMORROW as `COMPLETED` (fix 1),
 * and `COMPLETED` is in `CLEANER_CLOSED_STATUSES`, so the plain `notIn` this
 * used to be threw the row away.
 *
 * The PDF's rule is that an assigned future job is never hidden "by date
 * filtering, availability warnings, job status, or sync issues". So the status
 * test is now split in two:
 *
 *   • FUTURE work (`startTime > now`) — only a CANCELLATION removes it. Whatever
 *     else the status column says about a job that has not started yet, the
 *     cleaner still has to turn up to it.
 *   • Work that has already STARTED today — unchanged: `COMPLETED`/`CANCELLED`
 *     close it out. A job the crew finished this afternoon must not resurface
 *     as upcoming, which is exactly what a blanket "future-ish jobs are always
 *     upcoming" rule would have done.
 *
 * `clockOutTime: null` stays common to both arms, and is the same tie-breaker
 * `isFutureJob` (src/lib/metrics-shared.ts) uses: a clock-out is the strongest
 * "this really happened" signal a job row carries, so an early finish counts as
 * finished even when the scheduled start is still ahead.
 *
 * This is defense in depth, not the whole fix — fix 1 stops the bad statuses
 * being written and a backfill repairs the rows already stored. But a read-side
 * rule is what makes an assigned future job reach its cleaner no matter which
 * writer misbehaves next, and the field-lead group schedule already worked this
 * way (`getMyTeam.ts` filters on CANCELLED alone).
 */
export function upcomingFilter(now: Date = new Date()): Prisma.JobWhereInput {
  return {
    startTime: { gte: startOfDayTz(now) },
    clockOutTime: null,
    OR: [
      // Not started yet → only a cancellation takes it off the schedule.
      { startTime: { gt: now }, status: { not: "CANCELLED" } },
      // Already under way today → the closing statuses still close it.
      { status: { notIn: [...CLEANER_CLOSED_STATUSES] } },
    ],
  };
}

/**
 * Fragment: work the cleaner has finished (completed / paid / clocked out).
 *
 * Carries the mirror image of `upcomingFilter`'s guard (round 4, fix 2): a job
 * that has not started and was never clocked out cannot be finished, whatever
 * its status enum claims. Without this the same mis-stamped future job would
 * appear in BOTH lists — restored to Upcoming by the filter above and still
 * sitting in Completed here — which reads as a duplicate rather than a fix.
 */
export function doneFilter(now: Date = new Date()): Prisma.JobWhereInput {
  return {
    NOT: { startTime: { gt: now }, clockOutTime: null },
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
export function doneJobsWhere(
  cleanerId: string,
  now: Date = new Date()
): Prisma.JobWhereInput {
  return cleanerScopedWhere(cleanerId, doneFilter(now));
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
 * Fragment: the job is open work, and not a hold anybody has explained.
 *
 * ── Round 4, fix 6, the follow-on ──────────────────────────────────────────
 * The PDF asks that on-hold jobs "not be treated as active/scheduled jobs
 * unless admin releases them", and the available-jobs board is the sharpest
 * version of that: an unpriced $0 import must not be claimable by a cleaner who
 * would then turn up to it.
 *
 * The obvious edit — delete `CREATED` from the status list — was deliberately
 * NOT made, because it is only safe AFTER `scripts/releaseLegacyJobHolds.ts`
 * has run. Until then most `CREATED` rows are not holds at all: they are
 * ordinary jobs born on the Prisma default back when `saveJob` set no status
 * (16 such rows on live data today, every one of them `holdReason IS NULL`).
 * Dropping the status outright would have deleted all of them from the board —
 * recreating fix 2, the P0 this round opened with.
 *
 * So the rule keys on the REASON instead of the status, which is what the round
 * actually made possible: a hold now says why it is held. Read it as "we only
 * refuse work we can explain refusing".
 *
 *   • `SCHEDULED`                    → claimable, as always.
 *   • `CREATED` + a `holdReason`     → a REAL hold. Not claimable. Every
 *     producer stamps one (`$0` import, quote pending/declined, flexible
 *     booking, created-without-a-date), so every hold made from this round on
 *     is covered the moment it is created — no backfill required.
 *   • `CREATED` + no reason          → a legacy default, i.e. real scheduled
 *     work. Still claimable, exactly as today.
 *   • anything else (IN_PROGRESS / COMPLETED / PAID / CANCELLED) → excluded, as
 *     the old `status: { in: [...] }` did.
 *
 * It also SELF-COMPLETES: `releaseLegacyJobHolds --commit` moves the legacy
 * rows to `SCHEDULED` and stamps the genuine ones with their reason, after
 * which no `CREATED` row is claimable and this filter means precisely "drop
 * CREATED" — without a second deploy.
 */
export function openForClaimFilter(): Prisma.JobWhereInput {
  return {
    OR: [
      { status: "SCHEDULED" },
      { status: ON_HOLD_STATUS, holdReason: null },
    ],
  };
}

/**
 * Available-jobs board scope: genuinely open, claimable work only.
 * Deliberately narrow — IN_PROGRESS / COMPLETED / PAID / CANCELLED jobs, holds
 * carrying a reason, and jobs the cleaner already leads or is already on are
 * NOT claimable.
 */
export function claimableJobsWhere(
  cleanerId: string,
  now: Date = new Date()
): Prisma.JobWhereInput {
  return {
    deletedAt: null,
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
    //
    // The hold guard rides in the SAME `AND` array rather than as a second
    // top-level `OR:` key — that key is already spoken for by the employeeId
    // test above, and a duplicate would silently REPLACE it, widening the board
    // from "jobs I'm not on" to "everything". Same trap `cleanerScopedWhere`
    // documents.
    AND: [quoteSettledFilter(), openForClaimFilter()],
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
