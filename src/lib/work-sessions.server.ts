// The JobWorkSession store + the legacy mirror maintenance
// (awerfixes.pdf item 6, round 3). Pure rules live in work-sessions.ts.
//
// WHY MIRRORS AT ALL: `Job.clockInTime` / `Job.clockOutTime` and the
// `JobAssignment` pair are read in roughly forty places — cron sweeps, payroll
// selects, the wash-payouts page, the bulk-charge ordering, the admin time
// tracking list, three cleaner-app filters. Rewriting every one of them in the
// same change that introduces sessions would be a very large blast radius for
// no user-visible gain. So sessions are the truth, and those columns are kept
// as DERIVED values that always say what they always said:
//
//   Job.clockInTime  = the first moment anybody started work
//   Job.clockOutTime = the last moment everybody had stopped
//                      (NULL while anyone is still on the clock — otherwise a
//                      resumed job looks finished while a cleaner is on site)
//   JobAssignment.clockInTime  = that cleaner's first session start
//   JobAssignment.clockOutTime = that cleaner's last session end (NULL if open)

import { db } from "@/lib/org-db";
import { summariseSessions } from "@/lib/work-sessions";

export interface ClockMirrorState {
  /** Derived Job.clockInTime. */
  jobClockIn: Date | null;
  /** Derived Job.clockOutTime; null while any session is open. */
  jobClockOut: Date | null;
  /** True while ANY cleaner on this job is still clocked in. */
  anyOpen: boolean;
  /** How many cleaners have at least one session on this job. */
  cleanerCount: number;
}

/** This cleaner's currently-running session on this job, if any. */
export async function findOpenSession(jobId: string, cleanerId: string) {
  return db.jobWorkSession.findFirst({
    where: { jobId, cleanerId, endedAt: null },
    orderBy: { startedAt: "desc" },
    select: { id: true, startedAt: true },
  });
}

/**
 * The session this cleaner most recently CLOSED on this job, if it closed inside
 * `windowMs` (cleano_new_fixes.pdf fix 6 · Stage 5.4).
 *
 * This is how a retry is told apart from a mistake. `clockOut` commits its
 * writes in one transaction and then runs several steps that are not in it; if
 * one of those throws — or the response simply never reaches the phone — the
 * cleaner is shown a failure while their session is already closed. Every retry
 * then hit `findOpenSession` → null → "You're not clocked in on this job", with
 * the work half-saved and no way forward.
 *
 * A session closed seconds ago by the very cleaner now resubmitting is not an
 * unclocked-in cleaner; it is the previous attempt. The caller finishes the
 * post-transaction steps (all idempotent) and returns success, WITHOUT touching
 * inventory again — the closed session is itself the proof those writes
 * committed, since they shared a transaction with it.
 */
export async function findRecentlyClosedSession(
  jobId: string,
  cleanerId: string,
  windowMs: number
) {
  return db.jobWorkSession.findFirst({
    where: {
      jobId,
      cleanerId,
      endedAt: { not: null, gte: new Date(Date.now() - windowMs) },
    },
    orderBy: { endedAt: "desc" },
    select: { id: true, startedAt: true, endedAt: true },
  });
}

/** Every session on a job, oldest first. */
export async function listJobSessions(jobId: string) {
  return db.jobWorkSession.findMany({
    where: { jobId },
    orderBy: { startedAt: "asc" },
    select: {
      id: true,
      cleanerId: true,
      startedAt: true,
      endedAt: true,
    },
  });
}

export interface SyncClockMirrorsOptions {
  /**
   * Cleaners whose sessions this write touched, reconciled EVEN IF they now
   * have none left.
   *
   * Needed because "this cleaner has no sessions" is ambiguous: on a legacy job
   * it means the rows never existed and the mirrors are the only record, while
   * after a DELETE it means the record is gone and the mirrors are stale. The
   * loop below is driven by surviving sessions, so without this hint a deleted
   * cleaner is simply never visited and keeps the times that were removed —
   * which every reader then falls back to, making the delete invisible.
   *
   * Passing an id here also authorises clearing the JOB-level pair when the
   * last session on the job goes: the caller is asserting this job had sessions.
   */
  reconcile?: string[];
}

/**
 * Recompute `Job.clockInTime` / `Job.clockOutTime` and every `JobAssignment`
 * pair from the session rows. Call after ANY session write (clock in, clock
 * out, admin edit, admin delete).
 *
 * Deliberately does NOT touch `Job.status` — whether a job is IN_PROGRESS,
 * COMPLETED or PAID depends on payment and on which action ran, so that stays
 * with the caller.
 */
export async function syncClockMirrors(
  jobId: string,
  opts: SyncClockMirrorsOptions = {}
): Promise<ClockMirrorState> {
  const sessions = await listJobSessions(jobId);

  const overall = summariseSessions(sessions);
  const state: ClockMirrorState = {
    jobClockIn: overall.firstStartedAt,
    jobClockOut: overall.lastEndedAt,
    anyOpen: overall.isOpen,
    cleanerCount: new Set(sessions.map((s) => s.cleanerId)).size,
  };

  const byCleaner = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const list = byCleaner.get(s.cleanerId) ?? [];
    list.push(s);
    byCleaner.set(s.cleanerId, list);
  }

  // Cleaners named by the caller but with nothing left — their last session was
  // just deleted. They must still be visited so the pair they left behind is
  // cleared; the loop below is driven by surviving sessions and would skip them.
  const orphaned = (opts.reconcile ?? []).filter(
    (id) => id && !byCleaner.has(id)
  );

  // No sessions at all AND no hint that any were removed: this is a legacy job.
  // Leave the job-level pair alone rather than blanking history the legacy
  // fallback still reads.
  if (sessions.length === 0 && orphaned.length === 0) return state;

  // With the last session gone, the derived pair is NULL — anything else is the
  // deleted work still being reported.
  await db.job.update({
    where: { id: jobId },
    data: { clockInTime: state.jobClockIn, clockOutTime: state.jobClockOut },
  });

  for (const [cleanerId, mine] of byCleaner) {
    const summary = summariseSessions(mine);
    const existing = await db.jobAssignment.findUnique({
      where: { jobId_cleanerId: { jobId, cleanerId } },
      select: { status: true },
    });

    // A cleaner who cancelled their shift keeps that status — their row is
    // history, not a live assignment.
    if (existing?.status === "CANCELLED") continue;

    const status = summary.isOpen ? "CLOCKED_IN" : "CLOCKED_OUT";
    await db.jobAssignment.upsert({
      where: { jobId_cleanerId: { jobId, cleanerId } },
      update: {
        status,
        clockInTime: summary.firstStartedAt,
        clockOutTime: summary.lastEndedAt,
      },
      create: {
        jobId,
        cleanerId,
        status,
        clockInTime: summary.firstStartedAt,
        clockOutTime: summary.lastEndedAt,
      },
    });
  }

  for (const cleanerId of orphaned) {
    const existing = await db.jobAssignment.findUnique({
      where: { jobId_cleanerId: { jobId, cleanerId } },
      select: { status: true },
    });
    // Nothing to clear, and nothing to mint: a row is created only by a real
    // clock action, never by removing one.
    if (!existing || existing.status === "CANCELLED") continue;

    // Back to the model default — they are on the job, they just have no
    // recorded work on it any more.
    await db.jobAssignment.update({
      where: { jobId_cleanerId: { jobId, cleanerId } },
      data: { status: "ASSIGNED", clockInTime: null, clockOutTime: null },
    });
  }

  return state;
}
