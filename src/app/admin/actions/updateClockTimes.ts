"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { isAdminRole } from "@/lib/role-routing";
import { fmtDateTime } from "@/lib/time";
import {
  assignmentStatusForClock,
  parseInstant,
  validateClockEdit,
} from "@/lib/clock-edit";
import { syncClockMirrors } from "@/lib/work-sessions.server";

/**
 * Admin correction of clock-in / clock-out times (new fix list item 4).
 *
 * Cleaners miss a clock-in, clock out on the drive home, or the app drops a
 * tap — until now nothing but `clockIn`/`clockOut`/`markArrived` could write
 * these fields, so a wrong time stayed wrong and carried into hours, payroll
 * review and job financials.
 *
 * Three scopes:
 *   • `sessionId` set   → one JobWorkSession row (awerfixes.pdf item 6, round
 *     3). This is the real record of work now; the two below are its mirrors.
 *   • `cleanerId` set   → that cleaner's `JobAssignment` row. LEGACY ONLY —
 *     refused once that cleaner has sessions, because syncClockMirrors would
 *     overwrite the edit on their next clock action and the admin would watch
 *     their correction silently revert.
 *   • neither           → the job-level `Job.clockInTime/clockOutTime`, the
 *     fallback for jobs created before per-cleaner assignments. Also refused
 *     once the job has sessions, for the same reason.
 *
 * Every edit writes a JobLog entry recording the original value, the new value,
 * who changed it and when — the audit note the spec asks for.
 */

export interface UpdateClockTimesInput {
  jobId: string;
  /**
   * Edit ONE work session. Takes precedence over `cleanerId` (item 6).
   */
  sessionId?: string | null;
  /** Null / omitted = edit the job-level clock fields. */
  cleanerId?: string | null;
  /** ISO instant, or null to clear the time. */
  clockInTime: string | null;
  clockOutTime: string | null;
  /** Optional free-text reason, kept in the audit note. */
  reason?: string;
}

export type UpdateClockTimesResult =
  | {
      success: true;
      /** Set when the edit lands in a pay period that's already locked. */
      warning?: string;
    }
  | { success: false; error: string };

export async function updateClockTimes(
  input: UpdateClockTimesInput
): Promise<UpdateClockTimesResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };

  const role = (session.user as { role?: string }).role;
  if (!isAdminRole(role)) {
    return { success: false, error: "Not authorized" };
  }

  const parsedIn = parseInstant(input.clockInTime);
  const parsedOut = parseInstant(input.clockOutTime);
  const invalid = validateClockEdit({ clockIn: parsedIn, clockOut: parsedOut });
  if (invalid) return { success: false, error: invalid };

  // Past validation these are real Dates or null.
  const clockIn = parsedIn as Date | null;
  const clockOut = parsedOut as Date | null;

  const job = await db.job.findUnique({
    where: { id: input.jobId },
    select: {
      id: true,
      jobNumber: true,
      jobDate: true,
      startTime: true,
      clockInTime: true,
      clockOutTime: true,
      deletedAt: true,
      employeeId: true,
      cleaners: { select: { id: true } },
    },
  });
  if (!job) return { success: false, error: "Job not found" };
  if (job.deletedAt) {
    return { success: false, error: "This job is archived." };
  }

  const sessionId = input.sessionId || null;
  const cleanerId = input.cleanerId || null;
  let cleanerName: string | null = null;
  let previousIn: Date | null;
  let previousOut: Date | null;

  if (sessionId) {
    // ── Edit ONE work session (item 6) ────────────────────────────────
    const row = await db.jobWorkSession.findUnique({
      where: { id: sessionId },
      select: { id: true, jobId: true, cleanerId: true, startedAt: true, endedAt: true },
    });
    if (!row || row.jobId !== job.id) {
      return { success: false, error: "Session not found on this job" };
    }
    // A session with no start is not a session. Clearing both times is how you
    // delete one — that's deleteJobWorkSession, so the intent is explicit.
    if (!clockIn) {
      return {
        success: false,
        error:
          "A session needs a start time. To remove it entirely, delete the session.",
      };
    }

    const cleaner = await db.user.findUnique({
      where: { id: row.cleanerId },
      select: { name: true },
    });
    cleanerName = cleaner?.name ?? null;
    previousIn = row.startedAt;
    previousOut = row.endedAt;

    await db.jobWorkSession.update({
      where: { id: sessionId },
      data: { startedAt: clockIn, endedAt: clockOut },
    });
    // Job + assignment columns are derived, so they are rebuilt rather than
    // edited — an admin fixing a session must not leave the mirrors stale.
    await syncClockMirrors(job.id);
  } else if (cleanerId) {
    // Only someone actually on the job can have times recorded against them.
    // Without this, the upsert below would MINT a JobAssignment row for an
    // unassigned cleaner — and `jobParticipantIds` treats an assignment row as
    // proof of participation, so that cleaner would start drawing pay from
    // this job. Assigning is a separate, deliberate action.
    const onTheJob =
      job.cleaners.some((c) => c.id === cleanerId) || job.employeeId === cleanerId;
    if (!onTheJob) {
      return {
        success: false,
        error: "That cleaner isn't assigned to this job — assign them first.",
      };
    }

    // Once this cleaner has sessions, the assignment pair is DERIVED from them
    // — writing it here would be overwritten by the next syncClockMirrors, and
    // the admin would see their correction quietly revert.
    const sessionCount = await db.jobWorkSession.count({
      where: { jobId: job.id, cleanerId },
    });
    if (sessionCount > 0) {
      return {
        success: false,
        error:
          "This cleaner has recorded work sessions — edit the session times instead. The clock-in/out shown here is calculated from them.",
      };
    }

    const assignment = await db.jobAssignment.findUnique({
      where: { jobId_cleanerId: { jobId: job.id, cleanerId } },
      select: { clockInTime: true, clockOutTime: true },
    });
    const cleaner = await db.user.findUnique({
      where: { id: cleanerId },
      select: { name: true },
    });
    if (!cleaner) return { success: false, error: "Cleaner not found" };
    cleanerName = cleaner.name;
    // Legacy jobs have no assignment row yet — the job-level times are what
    // was showing for this cleaner, so that's what the audit note compares to.
    previousIn = assignment?.clockInTime ?? job.clockInTime;
    previousOut = assignment?.clockOutTime ?? job.clockOutTime;

    const status = assignmentStatusForClock(clockIn, clockOut);
    await db.jobAssignment.upsert({
      where: { jobId_cleanerId: { jobId: job.id, cleanerId } },
      update: { clockInTime: clockIn, clockOutTime: clockOut, status },
      create: {
        jobId: job.id,
        cleanerId,
        clockInTime: clockIn,
        clockOutTime: clockOut,
        status,
      },
    });
  } else {
    // Same reasoning as the per-cleaner branch: the job-level pair is derived
    // once any session exists.
    const sessionCount = await db.jobWorkSession.count({
      where: { jobId: job.id },
    });
    if (sessionCount > 0) {
      return {
        success: false,
        error:
          "This job has recorded work sessions — edit the session times instead. The job clock is calculated from them.",
      };
    }
    previousIn = job.clockInTime;
    previousOut = job.clockOutTime;
    await db.job.update({
      where: { id: job.id },
      data: { clockInTime: clockIn, clockOutTime: clockOut },
    });
  }

  // ── Audit note ───────────────────────────────────────────────────
  const fmt = (d: Date | null) => (d ? fmtDateTime(d) : "—");
  const scope = sessionId
    ? `${cleanerName ?? "A cleaner"}'s session`
    : cleanerName
      ? `${cleanerName}'s`
      : "Job";
  const changes: string[] = [];
  if (previousIn?.getTime() !== clockIn?.getTime()) {
    changes.push(`clock-in ${fmt(previousIn)} → ${fmt(clockIn)}`);
  }
  if (previousOut?.getTime() !== clockOut?.getTime()) {
    changes.push(`clock-out ${fmt(previousOut)} → ${fmt(clockOut)}`);
  }

  if (changes.length > 0) {
    await db.jobLog
      .create({
        data: {
          jobId: job.id,
          userId: session.user.id,
          action: "UPDATED",
          field: sessionId
            ? `sessionTimes:${sessionId}`
            : cleanerId
              ? `clockTimes:${cleanerId}`
              : "clockTimes",
          oldValue: `in=${fmt(previousIn)} out=${fmt(previousOut)}`,
          newValue: `in=${fmt(clockIn)} out=${fmt(clockOut)}`,
          description:
            `${scope} times edited by ${session.user.name ?? "an admin"}: ` +
            changes.join(", ") +
            (input.reason?.trim() ? ` — ${input.reason.trim()}` : ""),
        },
      })
      .catch((e) => console.error("clock-edit log", e));
  }

  // ── Payroll already closed on this date? ──────────────────────────
  // Hours are snapshotted into Payout rows when a pay period is generated. An
  // edit inside a period that's been approved or paid does NOT rewrite that
  // frozen payout — the admin is told so they can adjust it deliberately.
  let warning: string | undefined;
  const jobDay = job.jobDate ?? job.startTime;
  const period = await db.payPeriod.findFirst({
    where: {
      status: { in: ["PENDING_APPROVAL", "APPROVED", "PAID"] },
      startDate: { lte: jobDay },
      endDate: { gte: jobDay },
    },
    select: { status: true },
  });
  if (period) {
    warning = `Payroll for this date is already ${period.status
      .toLowerCase()
      .replace("_", " ")}. The recorded payout was not changed — adjust it on the pay period if this edit affects it.`;
  }

  revalidatePath(`/admin/jobs/${job.id}`);
  revalidatePath("/admin/jobs");
  revalidatePath("/admin/time-tracking");
  revalidatePath("/admin/payouts");
  revalidatePath(`/cleaners/my-jobs/${job.id}`);

  return warning ? { success: true, warning } : { success: true };
}

/**
 * Remove a work session recorded in error (awerfixes.pdf item 6, round 3).
 *
 * A cleaner who taps clock-in on the wrong job leaves a session that inflates
 * their hours, and squashing it into a neighbouring one to make it disappear is
 * exactly the kind of fudge an audit trail is supposed to prevent. Deleting is
 * logged with the times that were removed, so the record still shows what
 * happened.
 *
 * Deliberately NOT paired with a "create session" action: minting work that was
 * never clocked is a bigger decision than correcting work that was.
 */
export async function deleteJobWorkSession(input: {
  jobId: string;
  sessionId: string;
  reason?: string;
}): Promise<UpdateClockTimesResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };

  const role = (session.user as { role?: string }).role;
  if (!isAdminRole(role)) return { success: false, error: "Not authorized" };

  const job = await db.job.findUnique({
    where: { id: input.jobId },
    select: { id: true, jobDate: true, startTime: true, deletedAt: true },
  });
  if (!job) return { success: false, error: "Job not found" };
  if (job.deletedAt) return { success: false, error: "This job is archived." };

  const row = await db.jobWorkSession.findUnique({
    where: { id: input.sessionId },
    select: { id: true, jobId: true, cleanerId: true, startedAt: true, endedAt: true },
  });
  if (!row || row.jobId !== job.id) {
    return { success: false, error: "Session not found on this job" };
  }

  const cleaner = await db.user.findUnique({
    where: { id: row.cleanerId },
    select: { name: true },
  });

  await db.jobWorkSession.delete({ where: { id: row.id } });
  // `reconcile` is what makes the delete visible. Without it, a cleaner left
  // with no sessions is never visited by the mirror rebuild (it iterates the
  // sessions that survive), so their JobAssignment pair — and, when this was
  // the job's last session, Job.clockInTime/clockOutTime — would keep the times
  // that were just removed. Every reader falls back to those columns, so the
  // deleted work would go on being reported in hours, payroll and time tracking.
  await syncClockMirrors(job.id, { reconcile: [row.cleanerId] });

  const fmt = (d: Date | null) => (d ? fmtDateTime(d) : "—");
  await db.jobLog
    .create({
      data: {
        jobId: job.id,
        userId: session.user.id,
        action: "UPDATED",
        field: `sessionDeleted:${row.cleanerId}`,
        oldValue: `in=${fmt(row.startedAt)} out=${fmt(row.endedAt)}`,
        newValue: "removed",
        description:
          `${cleaner?.name ?? "A cleaner"}'s work session (${fmt(row.startedAt)} → ${fmt(row.endedAt)}) ` +
          `was deleted by ${session.user.name ?? "an admin"}` +
          (input.reason?.trim() ? ` — ${input.reason.trim()}` : ""),
      },
    })
    .catch((e) => console.error("session-delete log", e));

  // Same locked-payout rule as an edit: the frozen Payout row is not rewritten.
  let warning: string | undefined;
  const jobDay = job.jobDate ?? job.startTime;
  const period = await db.payPeriod.findFirst({
    where: {
      status: { in: ["PENDING_APPROVAL", "APPROVED", "PAID"] },
      startDate: { lte: jobDay },
      endDate: { gte: jobDay },
    },
    select: { status: true },
  });
  if (period) {
    warning = `Payroll for this date is already ${period.status
      .toLowerCase()
      .replace("_", " ")}. The recorded payout was not changed — adjust it on the pay period if this edit affects it.`;
  }

  revalidatePath(`/admin/jobs/${job.id}`);
  revalidatePath("/admin/time-tracking");
  revalidatePath("/admin/payouts");
  revalidatePath(`/cleaners/my-jobs/${job.id}`);

  return warning ? { success: true, warning } : { success: true };
}
