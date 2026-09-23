// Finding the forgotten clocks. Pure rules live in stale-clock.ts.
//
// READ ONLY. Nothing here writes. Closing a session is an admin action with a
// confirmed time behind it (`closeStaleSession`), never a sweep, for the reason
// set out at the top of stale-clock.ts: the right end time is a fact about a
// day nobody here witnessed.

import "server-only";
import { db } from "@/lib/org-db";
import {
  STALE_SESSION_HOURS,
  describeOpenFor,
  isStale,
  severityOf,
  suggestedEnd,
  type StaleSeverity,
} from "@/lib/stale-clock";

export interface StaleClockRow {
  sessionId: string;
  jobId: string;
  jobNumber: number | null;
  clientName: string | null;
  cleanerId: string;
  cleanerName: string | null;
  startedAt: string;
  /** The job's scheduled finish, which is the strongest hint at the real one. */
  jobEndTime: string | null;
  jobStartTime: string | null;
  /** Prefill for the confirm form. Null when we genuinely cannot guess. */
  suggestedEnd: string | null;
  openFor: string;
  severity: StaleSeverity;
  /** True while the job itself is still open, which changes the advice. */
  jobStatus: string;
}

/**
 * Every session left running past the threshold, worst first.
 *
 * The cutoff is applied in SQL rather than in JS so this stays one indexed
 * read: `endedAt: null` plus a `startedAt` bound, both of which the
 * `(jobId, cleanerId)` and `(cleanerId)` indexes can serve. `isStale` is then
 * re-applied in memory as the single source of truth for the rule, so the
 * query and the definition cannot drift apart.
 */
export async function listStaleClocks(
  now: Date = new Date(),
): Promise<StaleClockRow[]> {
  const cutoff = new Date(now.getTime() - STALE_SESSION_HOURS * 60 * 60 * 1000);

  const rows = await db.jobWorkSession.findMany({
    where: { endedAt: null, startedAt: { lt: cutoff } },
    orderBy: { startedAt: "asc" },
    take: 200,
    select: {
      id: true,
      jobId: true,
      cleanerId: true,
      startedAt: true,
      cleaner: { select: { name: true } },
      job: {
        select: {
          jobNumber: true,
          clientName: true,
          startTime: true,
          endTime: true,
          status: true,
          deletedAt: true,
        },
      },
    },
  });

  return rows
    // An archived job's clock is not a problem anybody needs to act on, and
    // showing it would put rows in the queue that cannot be usefully closed.
    .filter((r) => !r.job?.deletedAt)
    .filter((r) =>
      isStale(
        { startedAt: r.startedAt, endedAt: null },
        now,
      ),
    )
    .map((r) => {
      const shape = {
        startedAt: r.startedAt,
        endedAt: null,
        jobStartTime: r.job?.startTime ?? null,
        jobEndTime: r.job?.endTime ?? null,
      };
      return {
        sessionId: r.id,
        jobId: r.jobId,
        jobNumber: r.job?.jobNumber ?? null,
        clientName: r.job?.clientName ?? null,
        cleanerId: r.cleanerId,
        cleanerName: r.cleaner?.name ?? null,
        startedAt: r.startedAt.toISOString(),
        jobStartTime: r.job?.startTime?.toISOString() ?? null,
        jobEndTime: r.job?.endTime?.toISOString() ?? null,
        suggestedEnd: suggestedEnd(shape, now)?.toISOString() ?? null,
        openFor: describeOpenFor(shape, now),
        severity: severityOf(shape, now),
        jobStatus: r.job?.status ?? "UNKNOWN",
      };
    });
}

/** How many are waiting. Drives the badge without shipping every row. */
export async function countStaleClocks(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_SESSION_HOURS * 60 * 60 * 1000);
  try {
    return await db.jobWorkSession.count({
      where: { endedAt: null, startedAt: { lt: cutoff }, job: { deletedAt: null } },
    });
  } catch {
    return 0;
  }
}
