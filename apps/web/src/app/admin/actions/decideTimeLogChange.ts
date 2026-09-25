"use server";

// Approving or rejecting a cleaner's clock-correction request (Sept 17, item 19).
//
// APPROVAL DELEGATES. It would have been shorter to write the new times onto
// the session here, and wrong: `updateClockTimes` is not a one-line update. It
// validates the pair, refuses an edit inside a locked pay period, rewrites the
// job-level and assignment mirrors so the next clock action does not silently
// revert the change, re-snapshots hourly employee pay and billed hours, and
// writes the job log. A correction made through this route has to be
// byte-identical to one an admin typed, or payroll ends up with two kinds of
// corrected hours that behave differently.
//
// So this file does the DECISION — authorisation, state transition, history,
// telling the cleaner — and hands the actual change to the code that already
// knows how to make it.

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/org-db";
import { isAdminRole } from "@/lib/role-routing";
import { logActivity } from "@/lib/activity-log";
import { canDecide, TIME_LOG_REASON_MAX } from "@/lib/time-log-requests";
import { updateClockTimes } from "./updateClockTimes";

type Result = { success: true } | { success: false; error: string };

export async function decideTimeLogChange(input: {
  requestId: string;
  approve: boolean;
  note?: string;
}): Promise<Result> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (!isAdminRole(role)) return { success: false, error: "Not authorized" };

  if (typeof input.requestId !== "string" || !input.requestId) {
    return { success: false, error: "Invalid request" };
  }
  const note = String(input.note ?? "").trim().slice(0, TIME_LOG_REASON_MAX) || null;

  try {
    const req = await db.timeLogChangeRequest.findUnique({
      where: { id: input.requestId },
      include: {
        cleaner: { select: { name: true } },
        job: { select: { jobNumber: true, clientName: true } },
      },
    });
    if (!req) return { success: false, error: "Request not found" };
    if (!canDecide(req.status)) {
      return {
        success: false,
        error: `This request was already ${req.status.toLowerCase()}.`,
      };
    }

    if (input.approve) {
      // BOTH times have to be sent, every time.
      //
      // `updateClockTimes` reads null as "CLEAR this time", not "leave it
      // alone" — so approving a request that only moves the start time, and
      // passing null for the finish, would wipe the cleaner's clock-out and
      // zero their hours. The side the cleaner did not ask about is therefore
      // re-read from the clock as it stands NOW and passed back unchanged.
      //
      // Now, not from the request's stored `original*`: those were captured
      // when the cleaner filed it, and an admin may have corrected the entry
      // in the meantime. Using the stale value would silently undo that edit
      // as a side effect of approving something unrelated.
      const current = req.sessionId
        ? await db.jobWorkSession.findUnique({
            where: { id: req.sessionId },
            select: { startedAt: true, endedAt: true },
          })
        : await db.jobAssignment
            .findUnique({
              where: { jobId_cleanerId: { jobId: req.jobId, cleanerId: req.cleanerId } },
              select: { clockInTime: true, clockOutTime: true },
            })
            .then((a) =>
              a ? { startedAt: a.clockInTime, endedAt: a.clockOutTime } : null,
            );
      if (!current) {
        return {
          success: false,
          error: "That time entry no longer exists, so there is nothing to correct.",
        };
      }

      const nextIn = req.requestedStart ?? current.startedAt;
      const nextOut = req.requestedEnd ?? current.endedAt;

      // Apply FIRST, and only mark it approved if the change actually landed.
      // The other order produces the worst outcome available here: a request
      // stamped APPROVED, a cleaner told their hours were fixed, and a clock
      // that never moved because the pay period was locked.
      const applied = await updateClockTimes({
        jobId: req.jobId,
        sessionId: req.sessionId ?? undefined,
        // No session means a legacy job whose times sit on the assignment row.
        cleanerId: req.sessionId ? undefined : req.cleanerId,
        clockInTime: nextIn ? nextIn.toISOString() : null,
        clockOutTime: nextOut ? nextOut.toISOString() : null,
        reason: `Approved ${req.cleaner?.name ?? "a cleaner"}'s time change request: ${req.reason}`,
      });
      if (!applied.success) {
        return {
          success: false,
          error: `Couldn't apply it: ${applied.error} The request is still waiting.`,
        };
      }
    }

    await db.timeLogChangeRequest.update({
      where: { id: req.id },
      data: {
        status: input.approve ? "APPROVED" : "REJECTED",
        decidedById: session.user.id,
        decidedAt: new Date(),
        decisionNote: note,
      },
    });

    // The whole history the PDF asks for — original time, requested time,
    // reason, cleaner, decision and timestamp — is on the row itself. This is
    // the line that puts the DECISION where an admin browsing the log will see
    // it next to everything else that happened that day.
    await logActivity({
      category: "ADMIN",
      action: input.approve ? "timelog.request.approved" : "timelog.request.rejected",
      status: "SUCCESS",
      targetType: "Job",
      targetId: req.jobId,
      message:
        `${session.user.name ?? "An admin"} ${input.approve ? "approved" : "rejected"} ` +
        `${req.cleaner?.name ?? "a cleaner"}'s time change on job #${req.job?.jobNumber} ` +
        `(${req.job?.clientName}). Their reason: ${req.reason}.` +
        (note ? ` Decision note: ${note}` : ""),
    }).catch(() => {});

    revalidatePath("/admin/notifications");
    revalidatePath(`/admin/jobs/${req.jobId}`);
    revalidatePath("/admin/time-tracking");
    revalidatePath(`/cleaners/my-jobs/${req.jobId}`);
    return { success: true };
  } catch (e) {
    console.error("decideTimeLogChange", e);
    return { success: false, error: "Couldn't record that decision. Nothing was changed." };
  }
}

export interface TimeLogRequestRow {
  id: string;
  status: string;
  reason: string;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
  cleanerName: string | null;
  decidedByName: string | null;
  jobId: string;
  jobNumber: number | null;
  clientName: string | null;
  originalStart: string | null;
  originalEnd: string | null;
  requestedStart: string | null;
  requestedEnd: string | null;
}

/**
 * The requests queue. Pending first, because those are the only ones anyone
 * has to do something about; decided ones stay for the history the PDF asks
 * for ("keep history showing original time, requested time, reason, cleaner,
 * admin decision, and timestamp").
 */
export async function listTimeLogRequests(
  includeDecided = false,
): Promise<TimeLogRequestRow[]> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return [];
  const role = (session.user as { role?: string }).role;
  if (!isAdminRole(role)) return [];

  try {
    const rows = await db.timeLogChangeRequest.findMany({
      where: includeDecided ? undefined : { status: "PENDING" },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 100,
      include: {
        cleaner: { select: { name: true } },
        job: { select: { jobNumber: true, clientName: true } },
      },
    });
    const deciderIds = Array.from(
      new Set(rows.map((r) => r.decidedById).filter((v): v is string => !!v)),
    );
    const deciders = deciderIds.length
      ? await db.user.findMany({
          where: { id: { in: deciderIds } },
          select: { id: true, name: true },
        })
      : [];
    const byId = new Map(deciders.map((u) => [u.id, u.name]));

    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      reason: r.reason,
      decisionNote: r.decisionNote,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      cleanerName: r.cleaner?.name ?? null,
      decidedByName: r.decidedById ? byId.get(r.decidedById) ?? null : null,
      jobId: r.jobId,
      jobNumber: r.job?.jobNumber ?? null,
      clientName: r.job?.clientName ?? null,
      originalStart: r.originalStart?.toISOString() ?? null,
      originalEnd: r.originalEnd?.toISOString() ?? null,
      requestedStart: r.requestedStart?.toISOString() ?? null,
      requestedEnd: r.requestedEnd?.toISOString() ?? null,
    }));
  } catch (e) {
    console.error("listTimeLogRequests", e);
    return [];
  }
}

/** How many are waiting. Drives the subsection's count. */
export async function countPendingTimeLogRequests(): Promise<number> {
  try {
    return await db.timeLogChangeRequest.count({ where: { status: "PENDING" } });
  } catch {
    return 0;
  }
}
