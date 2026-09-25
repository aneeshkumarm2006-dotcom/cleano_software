"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { fmtDateTime } from "@/lib/time";
import { syncClockMirrors } from "@/lib/work-sessions.server";
import { snapshotBilledActualHours } from "@/lib/hourly-billing.server";
import {
  LOCKED_PAY_PERIOD_STATUSES,
  snapshotHourlyEmployeePay,
} from "@/lib/hourly-pay.server";
import {
  applyClockTimes,
  OWN_ENTRY,
  type UpdateClockTimesInput,
  type UpdateClockTimesResult,
} from "./_clockTimes";

export type { UpdateClockTimesInput, UpdateClockTimesResult };

/**
 * Who may type clock times in directly: OWNER, ADMIN and OPS_MANAGER.
 *
 * NOT a Field Lead. A lead approves or rejects their own group's requests
 * (`decideTimeLogChange`), and that is the whole of their say over hours: a
 * request carries the cleaner's reason and leaves a decision on record, a
 * direct edit does neither. The core (`./_clockTimes.ts`) separately refuses
 * an edit to the editor's own entry, whoever they are.
 */
const CLOCK_EDIT_ROLES = ["OWNER", "ADMIN", "OPS_MANAGER"];

export async function updateClockTimes(
  input: UpdateClockTimesInput
): Promise<UpdateClockTimesResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };

  const role = (session.user as { role?: string }).role;
  if (!role || !CLOCK_EDIT_ROLES.includes(role)) {
    return { success: false, error: "Not authorized" };
  }

  return applyClockTimes(input, {
    id: session.user.id,
    name: session.user.name ?? null,
  });
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
  if (!role || !CLOCK_EDIT_ROLES.includes(role)) {
    return { success: false, error: "Not authorized" };
  }

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
  // Deleting a session is the bluntest edit of all to one's own hours.
  if (row.cleanerId === session.user.id) return OWN_ENTRY;

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
  // Deleted work is work the customer is no longer billed for (Stage 8) — and
  // not work the crew is paid for either (round 4, fix 5).
  await snapshotBilledActualHours(job.id).catch((e) =>
    console.error("billed-hours snapshot", e)
  );
  await snapshotHourlyEmployeePay(job.id).catch((e) =>
    console.error("hourly-pay snapshot", e)
  );

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
      status: { in: [...LOCKED_PAY_PERIOD_STATUSES] },
      startDate: { lte: jobDay },
      endDate: { gte: jobDay },
    },
    select: { status: true },
  });
  if (period) {
    warning = `Payroll for this date is already ${period.status
      .toLowerCase()
      .replace("_", " ")}. The recorded payout was not changed, and neither was this job's stored cleaner pay — adjust it on the pay period if this edit affects it.`;
  }

  revalidatePath(`/admin/jobs/${job.id}`);
  revalidatePath("/admin/time-tracking");
  revalidatePath("/admin/payouts");
  revalidatePath(`/cleaners/my-jobs/${job.id}`);

  return warning ? { success: true, warning } : { success: true };
}
