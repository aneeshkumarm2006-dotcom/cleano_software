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
// The claim and the change it applies share one transaction
// (server/manager/time.ts, the service the phone's approvals also run), so a
// change that can't be applied takes the claim back with it.

import { fireEffects } from "@/server/effects";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/org-db";
import { isAdminRole } from "@/lib/role-routing";
import { fieldLeadGroupIds } from "@/lib/field-lead-group.server";
import { TIME_LOG_REASON_MAX } from "@bookmops/core/time";
import { actorFromSession } from "@/server/actor";
import { decideTimeRequest } from "@/server/manager/time";

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
    // The decision itself is the shared service (server/manager/time.ts), the
    // one the phone's approvals run: scope, the self rule, the claim and the
    // apply in ONE transaction, then the derived state and the activity line.
    const res = await decideTimeRequest(
      actorFromSession({ ...session.user, role: role ?? null }),
      {
        requestId: input.requestId,
        decision: input.approve ? "APPROVE" : "REJECT",
        note,
        now: new Date(),
        via: "web",
      },
    );
    if (!res.ok) return { success: false, error: res.message };
    fireEffects(res.effects);

    revalidatePath("/admin/notifications");
    revalidatePath(`/admin/jobs/${res.value.jobId}`);
    revalidatePath("/admin/time-tracking");
    revalidatePath(`/cleaners/my-jobs/${res.value.jobId}`);
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
