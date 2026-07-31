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

/**
 * Admin correction of clock-in / clock-out times (new fix list item 4).
 *
 * Cleaners miss a clock-in, clock out on the drive home, or the app drops a
 * tap — until now nothing but `clockIn`/`clockOut`/`markArrived` could write
 * these fields, so a wrong time stayed wrong and carried into hours, payroll
 * review and job financials.
 *
 * Two scopes:
 *   • `cleanerId` set  → that cleaner's `JobAssignment` row (the per-cleaner
 *     record payroll and the Team card read).
 *   • `cleanerId` null → the job-level `Job.clockInTime/clockOutTime`, which is
 *     the legacy fallback for jobs created before per-cleaner assignments.
 *
 * Every edit writes a JobLog entry recording the original value, the new value,
 * who changed it and when — the audit note the spec asks for.
 */

export interface UpdateClockTimesInput {
  jobId: string;
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

  const cleanerId = input.cleanerId || null;
  let cleanerName: string | null = null;
  let previousIn: Date | null;
  let previousOut: Date | null;

  if (cleanerId) {
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
    previousIn = job.clockInTime;
    previousOut = job.clockOutTime;
    await db.job.update({
      where: { id: job.id },
      data: { clockInTime: clockIn, clockOutTime: clockOut },
    });
  }

  // ── Audit note ───────────────────────────────────────────────────
  const fmt = (d: Date | null) => (d ? fmtDateTime(d) : "—");
  const scope = cleanerName ? `${cleanerName}'s` : "Job";
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
          field: cleanerId ? `clockTimes:${cleanerId}` : "clockTimes",
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

  return warning ? { success: true, warning } : { success: true };
}
