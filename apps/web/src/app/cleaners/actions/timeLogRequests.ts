"use server";

// A cleaner asking for their own clock times to be corrected (Sept 17, item 19).
//
// `updateClockTimes` already lets an admin fix a wrong clock. What did not
// exist was a way for the cleaner to ask. The alternatives in the field are a
// text message the office loses track of, or working the hours unpaid, and
// neither leaves a record anyone can audit afterwards.
//
// Nothing here changes payroll. A request is a proposal with a reason attached;
// `decideTimeLogChange` on the admin side is what applies it, and it does so
// through the same correction path an admin uses by hand.

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/org-db";
import { recordAdminNotification } from "@/lib/admin-notifications";
import { fmtDateTime } from "@/lib/time";
import {
  checkTimeLogRequest,
  describeChange,
  TIME_LOG_REASON_MAX,
} from "@/lib/time-log-requests";

type Result = { success: true } | { success: false; error: string };

const asDate = (v: string | null | undefined): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export async function requestTimeLogChange(input: {
  jobId: string;
  sessionId?: string | null;
  /** ISO strings from the form. */
  requestedStart?: string | null;
  requestedEnd?: string | null;
  reason: string;
}): Promise<Result> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };
  const cleanerId = session.user.id;

  if (typeof input.jobId !== "string" || !input.jobId) {
    return { success: false, error: "Invalid request" };
  }

  try {
    // AUTHZ: a cleaner may only ask about a job they are ON, and only about
    // their OWN times. Checked against the job rather than trusting the ids in
    // the payload — otherwise one cleaner could file a request that rewrites
    // another's hours, and an admin approving it in good faith would apply it.
    const job = await db.job.findUnique({
      where: { id: input.jobId },
      select: {
        id: true,
        jobNumber: true,
        clientName: true,
        deletedAt: true,
        employeeId: true,
        cleaners: { select: { id: true } },
      },
    });
    if (!job || job.deletedAt) return { success: false, error: "Job not found" };

    const onJob =
      job.employeeId === cleanerId || job.cleaners.some((c) => c.id === cleanerId);
    if (!onJob) {
      return { success: false, error: "You're not assigned to that job." };
    }

    let originalStart: Date | null = null;
    let originalEnd: Date | null = null;
    let sessionId: string | null = null;

    if (input.sessionId) {
      const row = await db.jobWorkSession.findUnique({
        where: { id: input.sessionId },
        select: { id: true, jobId: true, cleanerId: true, startedAt: true, endedAt: true },
      });
      // Both checks matter: the row must belong to this job AND to this
      // cleaner. Either one alone leaves a way to point at someone else's
      // session.
      if (!row || row.jobId !== job.id || row.cleanerId !== cleanerId) {
        return { success: false, error: "That time entry isn't yours." };
      }
      sessionId = row.id;
      originalStart = row.startedAt;
      originalEnd = row.endedAt;
    } else {
      // A job with no session rows: the cleaner's own assignment row holds the
      // times. `updateClockTimes` handles that shape too.
      const assignment = await db.jobAssignment.findUnique({
        where: { jobId_cleanerId: { jobId: job.id, cleanerId } },
        select: { clockInTime: true, clockOutTime: true },
      });
      originalStart = assignment?.clockInTime ?? null;
      originalEnd = assignment?.clockOutTime ?? null;
    }

    const requestedStart = asDate(input.requestedStart);
    const requestedEnd = asDate(input.requestedEnd);

    const check = checkTimeLogRequest({
      originalStart,
      originalEnd,
      requestedStart,
      requestedEnd,
      reason: input.reason,
    });
    if (!check.ok) return { success: false, error: check.error };

    // One open request per time entry. A second one is not extra information,
    // it is two proposals for the same hours and an admin approving both would
    // apply the older one last.
    const existing = await db.timeLogChangeRequest.findFirst({
      where: {
        jobId: job.id,
        cleanerId,
        sessionId: sessionId ?? null,
        status: "PENDING",
      },
      select: { id: true },
    });
    if (existing) {
      return {
        success: false,
        error: "You already have a change waiting on this time entry.",
      };
    }

    await db.timeLogChangeRequest.create({
      data: {
        jobId: job.id,
        cleanerId,
        sessionId,
        originalStart,
        originalEnd,
        requestedStart,
        requestedEnd,
        reason: check.reason.slice(0, TIME_LOG_REASON_MAX),
      },
    });

    const changes = [
      describeChange("Start", originalStart, requestedStart, fmtDateTime),
      describeChange("Finish", originalEnd, requestedEnd, fmtDateTime),
    ]
      .filter(Boolean)
      .join(" · ");

    // The PDF asks for this in as many words: "admin should receive a
    // notification when a cleaner submits a time change request."
    await recordAdminNotification({
      key: "admin.timelog.change_requested",
      title: `${session.user.name ?? "A cleaner"} asked to correct their hours`,
      body: `Job #${job.jobNumber} — ${job.clientName}. ${changes}. Reason: ${check.reason}`,
      href: "/admin/notifications?tab=timelog",
      severity: "WARN",
    });

    revalidatePath(`/cleaners/my-jobs/${job.id}`);
    return { success: true };
  } catch (e) {
    console.error("requestTimeLogChange", e);
    return { success: false, error: "Couldn't send that request. Try again." };
  }
}

/** This cleaner's own requests on one job, newest first. */
export async function listMyTimeLogRequests(jobId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return [];
  try {
    const rows = await db.timeLogChangeRequest.findMany({
      where: { jobId, cleanerId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      reason: r.reason,
      decisionNote: r.decisionNote,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      originalStart: r.originalStart?.toISOString() ?? null,
      originalEnd: r.originalEnd?.toISOString() ?? null,
      requestedStart: r.requestedStart?.toISOString() ?? null,
      requestedEnd: r.requestedEnd?.toISOString() ?? null,
    }));
  } catch {
    return [];
  }
}
