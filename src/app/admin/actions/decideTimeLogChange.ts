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
//
// WHO DECIDES WHAT.
//   • Nobody decides their own request. An admin or lead who works shifts files
//     requests like anyone else; approving them is paying themselves.
//   • OWNER, ADMIN and OPS_MANAGER decide anyone else's, company-wide.
//   • A FIELD_LEAD decides requests from their own group (`User.fieldLeadId`,
//     resolved server-side by field-lead-group.server.ts) and nobody else's.
//     Another group's request answers "not found", the same as one that does
//     not exist: a lead has no business learning it is there.
//
// ONE DECISION PER REQUEST. The status change is a conditional update on the
// still-decidable states, made BEFORE anything is applied. Two admins who open
// the same request both pass the read; only one of them gets the row, and the
// other is told it was already decided rather than applying it a second time.

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/org-db";
import { isAdminRole } from "@/lib/role-routing";
import { logActivity } from "@/lib/activity-log";
import {
  fieldLeadGroupIds,
  isFieldLeadGroupMember,
} from "@/lib/field-lead-group.server";
import {
  canDecide,
  DECIDABLE_TIME_LOG_STATUSES,
  TIME_LOG_REASON_MAX,
} from "@/lib/time-log-requests";
import { applyClockTimes } from "./_clockTimes";

type Result = { success: true } | { success: false; error: string };

/**
 * Which requests this viewer may see and decide, as a where-fragment. Null
 * means company-wide. A Field Lead gets their group minus themselves; archived
 * members are included, as `isFieldLeadGroupMember` includes them, so a lead
 * can still close out a request filed the week before someone left.
 */
async function requestScope(
  viewerId: string,
  role: string | undefined
): Promise<Prisma.TimeLogChangeRequestWhereInput | null> {
  if (role !== "FIELD_LEAD") return null;
  const ids = await fieldLeadGroupIds(viewerId, { includeArchived: true });
  return { cleanerId: { in: ids.filter((id) => id !== viewerId) } };
}

export async function decideTimeLogChange(input: {
  requestId: string;
  approve: boolean;
  note?: string;
}): Promise<Result> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (!isAdminRole(role)) return { success: false, error: "Not authorized" };

  if (
    typeof input.requestId !== "string" ||
    !input.requestId ||
    typeof input.approve !== "boolean"
  ) {
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
    if (req.cleanerId === session.user.id) {
      return {
        success: false,
        error: "You can't decide your own time change request. Another admin has to.",
      };
    }
    if (
      role === "FIELD_LEAD" &&
      !(await isFieldLeadGroupMember(session.user.id, req.cleanerId))
    ) {
      return { success: false, error: "Request not found" };
    }
    if (!canDecide(req.status)) {
      return {
        success: false,
        error: `This request was already ${req.status.toLowerCase()}.`,
      };
    }

    // Claim the decision first (see the header). 0 rows means somebody else's
    // decision landed between our read and now.
    const claimed = await db.timeLogChangeRequest.updateMany({
      where: { id: req.id, status: { in: [...DECIDABLE_TIME_LOG_STATUSES] } },
      data: {
        status: input.approve ? "APPROVED" : "REJECTED",
        decidedById: session.user.id,
        decidedAt: new Date(),
        decisionNote: note,
      },
    });
    if (claimed.count === 0) {
      const now = await db.timeLogChangeRequest.findUnique({
        where: { id: req.id },
        select: { status: true },
      });
      return {
        success: false,
        error: `This request was already ${(now?.status ?? "decided").toLowerCase()}.`,
      };
    }
    // Put the request back exactly as it was, for when the approved change
    // could not be applied. Conditional on still being OUR approval, so it can
    // never undo anything else.
    const release = () =>
      db.timeLogChangeRequest.updateMany({
        where: { id: req.id, status: "APPROVED", decidedById: session.user.id },
        data: {
          status: req.status,
          decidedById: req.decidedById,
          decidedAt: req.decidedAt,
          decisionNote: req.decisionNote,
        },
      });

    // Anything that throws before the change lands releases the claim too, or
    // a database hiccup would leave a request marked approved and never applied.
    try {
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
          ? await db.jobWorkSession
              .findUnique({
                where: { id: req.sessionId },
                select: { startedAt: true, endedAt: true, cleanerId: true },
              })
              // The session has to be the requester's. Scope was checked on the
              // request's cleaner, so it must be that cleaner's hours that move.
              .then((w) => (w && w.cleanerId === req.cleanerId ? w : null))
          : await db.jobAssignment
              .findUnique({
                where: { jobId_cleanerId: { jobId: req.jobId, cleanerId: req.cleanerId } },
                select: { clockInTime: true, clockOutTime: true },
              })
              .then((a) =>
                a ? { startedAt: a.clockInTime, endedAt: a.clockOutTime } : null,
              );
        if (!current) {
          await release();
          return {
            success: false,
            error: "That time entry no longer exists, so there is nothing to correct.",
          };
        }

        const nextIn = req.requestedStart ?? current.startedAt;
        const nextOut = req.requestedEnd ?? current.endedAt;

        // The request is already claimed as APPROVED, but it only STAYS approved
        // if the change actually lands. Otherwise it is released back to waiting,
        // because the worst outcome available here is a request stamped
        // APPROVED, a cleaner told their hours were fixed, and a clock that never
        // moved because the pay period was locked.
        //
        // Applied through the clock-edit core rather than the `updateClockTimes`
        // action: that action refuses a Field Lead (no direct edits), and an
        // approved request from their own group is exactly what a lead may apply.
        const applied = await applyClockTimes(
          {
            jobId: req.jobId,
            sessionId: req.sessionId ?? undefined,
            // No session means a legacy job whose times sit on the assignment row.
            cleanerId: req.sessionId ? undefined : req.cleanerId,
            clockInTime: nextIn ? nextIn.toISOString() : null,
            clockOutTime: nextOut ? nextOut.toISOString() : null,
            reason: `Approved ${req.cleaner?.name ?? "a cleaner"}'s time change request: ${req.reason}`,
          },
          { id: session.user.id, name: session.user.name ?? null },
        );
        if (!applied.success) {
          await release();
          return {
            success: false,
            error: `Couldn't apply it: ${applied.error} The request is still waiting.`,
          };
        }
      }
    } catch (e) {
      await release().catch(() => {});
      throw e;
    }

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
    const scope = await requestScope(session.user.id, role);
    const rows = await db.timeLogChangeRequest.findMany({
      where: {
        AND: [
          includeDecided ? {} : { status: "PENDING" },
          scope ?? {},
        ],
      },
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

/**
 * How many are waiting. Drives the subsection's count. Same gate and same
 * scope as the list: an exported server action is a public endpoint, and this
 * one used to answer anybody, signed in or not.
 */
export async function countPendingTimeLogRequests(): Promise<number> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return 0;
  const role = (session.user as { role?: string }).role;
  if (!isAdminRole(role)) return 0;
  try {
    const scope = await requestScope(session.user.id, role);
    return await db.timeLogChangeRequest.count({
      where: { AND: [{ status: "PENDING" }, scope ?? {}] },
    });
  } catch {
    return 0;
  }
}
