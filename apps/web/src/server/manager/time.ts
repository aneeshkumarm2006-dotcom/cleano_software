// Clock-time decisions: the queue and ruling on one item
// (packages/api/src/v1/manager-approvals.ts, "Clock times").
//
// One implementation, two front doors (API_V1.md §5): the web's
// decideTimeLogChange is a thin adapter over decideTimeRequest below, and the
// phone's POST /manager/approvals/time/:id/decision is another. The apply
// step is the web's own clock-edit core (writeClockEdit in
// app/admin/actions/_clockTimes.ts: validation, the one row it moves, the
// JobLog line), run through the transaction's client, so:
//   - the claim (a conditional update on PENDING, manager-access.ts rule 10)
//     and the times it applies commit together or not at all. The web used to
//     claim, apply, and put the claim back by hand when applying failed; a
//     crash between the two could leave a request approved and never applied.
//     Now a refusal rolls the claim back with everything else;
//   - the derived state (job and assignment mirrors, hourly pay, billed hours)
//     is rebuilt once the edit is committed, as the web always did, because
//     those read the sessions as committed.
//
// Who decides what (the web's rules, and the phone's narrowing):
//   - TIME_APPROVE decides; TIME_ADJUST may also set times nobody asked for;
//   - a FIELD_LEAD reaches only items whose cleaner is in their group
//     (archived members included, as the web's requestScope); anything else is
//     404. An empty group reaches nothing;
//   - nobody decides their own item: 403 SELF_APPROVAL, and the lists and the
//     count leave the caller's own out.
import "server-only";

import { can, type TimeItem, type TimeItemsResponse } from "@bookmops/api/v1";
import { canDecide, DECIDABLE_TIME_LOG_STATUSES, parseInstant, validateClockEdit } from "@bookmops/core/time";
import type { Prisma } from "@prisma/client";

import { recomputeAfterClockEdit, writeClockEdit } from "@/app/admin/actions/_clockTimes";
import { logActivity } from "@/lib/activity-log";
import type { ScopedTx } from "@/lib/db-scoped";
import { fieldLeadGroupIds } from "@/lib/field-lead-group.server";
import { snapshotBilledActualHours } from "@/lib/hourly-billing.server";
import { LOCKED_PAY_PERIOD_STATUSES, snapshotHourlyEmployeePay } from "@/lib/hourly-pay.server";
import { db } from "@/lib/org-db";
import { fmtDateTime } from "@/lib/time";

import type { Actor } from "../actor";
import { timeRequestDecidedPush } from "../push/notify";
import { failure, notFound, ok, type Failure, type Result } from "../result";
import { afterKeyset, badCursor, decodeKeyset, pageBy } from "./cursor";
import { clientNameFor } from "./scope";

const PAGE_SIZE = 30;
const NOT_FOUND = "Request not found";
export const SELF_TIME_DECISION = "You can't decide your own time change request. Another admin has to.";
const NO_ENTRY =
  "This came from the app with no time entry to change. Enter the times on the job by hand, then reject this request with a note.";
const ENTRY_GONE = "That time entry no longer exists, so there is nothing to correct.";
const FORBIDDEN = "Your role can't do this.";

// ── Scope ───────────────────────────────────────────────────────────────────

/**
 * The requests this caller may see and decide, as a where-fragment: never
 * their own; a FIELD_LEAD's group only (fails closed on an empty group).
 */
async function reachOf(actor: Actor): Promise<Prisma.TimeLogChangeRequestWhereInput> {
  if (actor.role !== "FIELD_LEAD") return { cleanerId: { not: actor.userId } };
  const ids = await fieldLeadGroupIds(actor.userId, { includeArchived: true });
  return { cleanerId: { in: ids.filter((id) => id !== actor.userId) } };
}

/**
 * One request, if this caller may act on it. Another group's is 404, the
 * same as one that doesn't exist; the caller's own is 403 SELF_APPROVAL, so
 * the app can say why.
 */
async function reachable(actor: Actor, id: string) {
  const row = await db.timeLogChangeRequest.findFirst({ where: { id }, select: ITEM_SELECT });
  if (!row) return notFound(NOT_FOUND);
  if (actor.role === "FIELD_LEAD") {
    const group = await fieldLeadGroupIds(actor.userId, { includeArchived: true });
    if (!group.includes(row.cleanerId)) return notFound(NOT_FOUND);
  }
  if (row.cleanerId === actor.userId) return failure(403, "SELF_APPROVAL", SELF_TIME_DECISION);
  return ok(row);
}

// ── Reading ─────────────────────────────────────────────────────────────────

const ITEM_SELECT = {
  id: true,
  jobId: true,
  cleanerId: true,
  sessionId: true,
  breakId: true,
  originalStart: true,
  originalEnd: true,
  requestedStart: true,
  requestedEnd: true,
  reason: true,
  status: true,
  decidedById: true,
  decidedAt: true,
  decisionNote: true,
  source: true,
  eventKind: true,
  offlineReason: true,
  occurredAt: true,
  receivedAt: true,
  createdAt: true,
  cleaner: { select: { name: true } },
  job: { select: { jobNumber: true, clientName: true, startTime: true, clockInTime: true, clockOutTime: true } },
} as const satisfies Prisma.TimeLogChangeRequestSelect;

type ItemRow = Prisma.TimeLogChangeRequestGetPayload<{ select: typeof ITEM_SELECT }>;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Rows to wire items, with the times on record now, in four queries however many. */
async function toItems(actor: Actor, rows: ItemRow[]): Promise<TimeItem[]> {
  if (rows.length === 0) return [];
  const sessionIds = rows.map((r) => r.sessionId).filter((v): v is string => !!v);
  const breakIds = rows.map((r) => r.breakId).filter((v): v is string => !!v);
  const deciderIds = [...new Set(rows.map((r) => r.decidedById).filter((v): v is string => !!v))];
  const [sessions, breaks, assignments, deciders] = await Promise.all([
    sessionIds.length
      ? db.jobWorkSession.findMany({ where: { id: { in: sessionIds } }, select: { id: true, startedAt: true, endedAt: true } })
      : [],
    breakIds.length
      ? db.jobBreak.findMany({ where: { id: { in: breakIds } }, select: { id: true, startedAt: true, endedAt: true } })
      : [],
    db.jobAssignment.findMany({
      where: { jobId: { in: rows.map((r) => r.jobId) }, cleanerId: { in: rows.map((r) => r.cleanerId) } },
      select: { jobId: true, cleanerId: true, clockInTime: true, clockOutTime: true },
    }),
    deciderIds.length ? db.user.findMany({ where: { id: { in: deciderIds } }, select: { id: true, name: true } }) : [],
  ]);
  const sessionBy = new Map(sessions.map((s) => [s.id, s]));
  const breakBy = new Map(breaks.map((b) => [b.id, b]));
  const assignmentBy = new Map(assignments.map((a) => [`${a.jobId}:${a.cleanerId}`, a]));
  const deciderBy = new Map(deciders.map((u) => [u.id, u.name]));

  return rows.map((r) => {
    let current: { start: Date | null; end: Date | null };
    if (r.breakId) {
      const b = breakBy.get(r.breakId);
      current = { start: b?.startedAt ?? null, end: b?.endedAt ?? null };
    } else if (r.sessionId) {
      const s = sessionBy.get(r.sessionId);
      current = { start: s?.startedAt ?? null, end: s?.endedAt ?? null };
    } else {
      const a = assignmentBy.get(`${r.jobId}:${r.cleanerId}`);
      current = { start: a?.clockInTime ?? r.job.clockInTime, end: a?.clockOutTime ?? r.job.clockOutTime };
    }
    const offline = r.source === "OFFLINE_CLOCK";
    return {
      id: r.id,
      kind: offline ? "OFFLINE_CLOCK" : "CLEANER_REQUEST",
      status: r.status,
      cleaner: { id: r.cleanerId, name: r.cleaner.name },
      job: {
        id: r.jobId,
        jobNumber: r.job.jobNumber,
        clientName: r.job.clientName ? clientNameFor(actor.role, r.job.clientName) || null : null,
        startsAt: r.job.startTime.toISOString(),
      },
      current: { start: iso(current.start), end: iso(current.end) },
      original: { start: iso(r.originalStart), end: iso(r.originalEnd) },
      requested: { start: iso(r.requestedStart), end: iso(r.requestedEnd) },
      reason: offline ? null : r.reason,
      offline:
        offline && r.eventKind && r.occurredAt && r.receivedAt
          ? {
              event: r.eventKind,
              why: r.offlineReason ?? "COULD_NOT_APPLY",
              occurredAt: r.occurredAt.toISOString(),
              receivedAt: r.receivedAt.toISOString(),
            }
          : null,
      createdAt: r.createdAt.toISOString(),
      decided:
        r.decidedAt && r.status !== "PENDING"
          ? {
              by: (r.decidedById && deciderBy.get(r.decidedById)) || "Someone in the office",
              at: r.decidedAt.toISOString(),
              note: r.decisionNote,
            }
          : null,
    } as TimeItem;
  });
}

/** GET /manager/approvals/time: pending oldest first, decided newest first. */
export async function listTimeItems(
  actor: Actor,
  status: "pending" | "decided",
  cursorRaw: string | undefined,
): Promise<Result<TimeItemsResponse>> {
  if (!can(actor.role, "TIME_APPROVE")) return failure(403, "FORBIDDEN", FORBIDDEN);
  const cursor = decodeKeyset(cursorRaw);
  if (cursor === "invalid") return badCursor();
  const reach = await reachOf(actor);
  const pending = status === "pending";
  const field = pending ? "createdAt" : "decidedAt";
  const dir = pending ? "asc" : "desc";
  const rows = await db.timeLogChangeRequest.findMany({
    where: {
      AND: [
        reach,
        pending ? { status: "PENDING" } : { status: { in: ["APPROVED", "REJECTED"] }, decidedAt: { not: null } },
        afterKeyset(field, dir, cursor),
      ],
    },
    orderBy: [{ [field]: dir }, { id: dir }],
    take: PAGE_SIZE + 1,
    select: ITEM_SELECT,
  });
  const page = pageBy(rows, PAGE_SIZE, (r) => ({ at: (pending ? r.createdAt : r.decidedAt) ?? r.createdAt, id: r.id }));
  return ok({ items: await toItems(actor, page.rows), nextCursor: page.nextCursor });
}

/** GET /manager/approvals/time/:id */
export async function timeItemFor(actor: Actor, id: string): Promise<Result<TimeItem>> {
  if (!can(actor.role, "TIME_APPROVE")) return failure(403, "FORBIDDEN", FORBIDDEN);
  const found = await reachable(actor, id);
  if (!found.ok) return found;
  const [item] = await toItems(actor, [found.value]);
  return ok(item);
}

/** The Approvals badge's time count: what the list would show as pending. */
export async function pendingTimeCount(actor: Actor): Promise<number> {
  return db.timeLogChangeRequest.count({ where: { AND: [await reachOf(actor), { status: "PENDING" }] } });
}

// ── Deciding ────────────────────────────────────────────────────────────────

export type TimeDecisionKind = "APPROVE" | "ADJUST" | "REJECT";

export interface TimeDecisionInput {
  requestId: string;
  decision: TimeDecisionKind;
  /** ADJUST only: the times to set instead of the ones asked for. */
  start?: Date | null;
  /** ADJUST only. Undefined or null leaves an entry still running open; refused over a clock-out on record. */
  end?: Date | null;
  note: string | null;
  now: Date;
  /**
   * Which front door. "app" refuses an edit inside a locked pay period (409
   * PAY_PERIOD_LOCKED, the item stays pending) and says "from the app" in the
   * log; "web" keeps the web's behaviour, which applies it and warns elsewhere.
   */
  via: "web" | "app";
}

/** Thrown inside the transaction to roll it back, claim included. */
class Refusal extends Error {
  constructor(readonly failure: Failure) {
    super(failure.code);
  }
}

const refuse = (status: 400 | 403 | 404 | 409, code: string, message: string): never => {
  throw new Refusal(failure(status, code, message));
};

const stillWaiting = (why: string) => `Couldn't apply it: ${why} The request is still waiting.`;

/**
 * Move one break to the time decided (an OFFLINE_CLOCK item with a breakId),
 * through the transaction's client. The snapshots that read breaks run after
 * the commit.
 */
async function writeBreakCorrection(
  tx: ScopedTx,
  args: { jobId: string; cleanerId: string; breakId: string; start: Date | null; end: Date | null; adminName: string },
): Promise<void> {
  const row = await tx.jobBreak.findFirst({
    where: { id: args.breakId, jobId: args.jobId, cleanerId: args.cleanerId },
    select: { id: true, startedAt: true, endedAt: true },
  });
  if (!row) refuse(409, "COULD_NOT_APPLY", stillWaiting("That break no longer exists."));
  const b = row!;
  const nextStart = args.start ?? b.startedAt;
  const nextEnd = args.end ?? b.endedAt;
  if (nextEnd && nextEnd.getTime() <= nextStart.getTime()) {
    refuse(409, "COULD_NOT_APPLY", stillWaiting("The break would end before it starts."));
  }
  await tx.jobBreak.update({ where: { id: b.id }, data: { startedAt: nextStart, endedAt: nextEnd } });
  await tx.jobLog.create({
    data: {
      jobId: args.jobId,
      userId: args.cleanerId,
      action: "NOTE_ADDED",
      field: "breakTimes",
      oldValue: `start=${fmtDateTime(b.startedAt)} end=${b.endedAt ? fmtDateTime(b.endedAt) : "—"}`,
      newValue: `start=${fmtDateTime(nextStart)} end=${nextEnd ? fmtDateTime(nextEnd) : "—"}`,
      description: `Break times corrected by ${args.adminName}, approving the time the app reported.`,
    },
  });
}

/**
 * Rule on one time item: claim it, apply what was decided, record the
 * decision, all in one transaction; then rebuild what derives from the
 * sessions and write the activity line. The caller has already validated the
 * shape of the input; everything that depends on the data is checked here.
 */
export async function decideTimeRequest(
  actor: Actor,
  input: TimeDecisionInput,
): Promise<Result<{ requestId: string; jobId: string }>> {
  if (!can(actor.role, "TIME_APPROVE")) return failure(403, "FORBIDDEN", FORBIDDEN);
  if (input.decision === "ADJUST" && !can(actor.role, "TIME_ADJUST")) return failure(403, "FORBIDDEN", FORBIDDEN);

  const found = await reachable(actor, input.requestId);
  if (!found.ok) return found;
  const req = found.value;
  if (!canDecide(req.status)) {
    return failure(409, "ALREADY_DECIDED", `This request was already ${req.status.toLowerCase()}.`);
  }
  const applying = input.decision !== "REJECT";
  // Raised by the server from a phone clock event that could not be applied
  // at all: there is no entry to move. Refused before the claim, as the web.
  if (applying && req.source === "OFFLINE_CLOCK" && !req.breakId && !req.sessionId) {
    return failure(409, "NOTHING_TO_APPLY", NO_ENTRY);
  }

  const adminName = actor.name ?? "an admin";
  const fromApp = input.via === "app" ? " from the app" : "";
  const approved = applying ? "APPROVED" : "REJECTED";

  let applied: { kind: "none" } | { kind: "break" } | { kind: "clock"; recompute: boolean; applied: [Date | null, Date | null] };
  try {
    applied = await db.$transaction(async (tx) => {
      // 1. The claim. Zero rows: someone else decided it first; nothing applied.
      const claimed = await tx.timeLogChangeRequest.updateMany({
        where: { id: req.id, status: { in: [...DECIDABLE_TIME_LOG_STATUSES] } },
        data: { status: approved, decidedById: actor.userId, decidedAt: input.now, decisionNote: input.note },
      });
      if (claimed.count === 0) {
        const now = await tx.timeLogChangeRequest.findFirst({ where: { id: req.id }, select: { status: true } });
        refuse(409, "ALREADY_DECIDED", `This request was already ${(now?.status ?? "decided").toLowerCase()}.`);
      }
      if (!applying) return { kind: "none" as const };

      // 2a. A break the phone reported: move the break, not the session.
      if (req.source === "OFFLINE_CLOCK" && req.breakId) {
        await writeBreakCorrection(tx, {
          jobId: req.jobId,
          cleanerId: req.cleanerId,
          breakId: req.breakId,
          start: input.decision === "ADJUST" ? (input.start ?? null) : req.requestedStart,
          end: input.decision === "ADJUST" ? (input.end ?? null) : req.requestedEnd,
          adminName,
        });
        return { kind: "break" as const };
      }

      // 2b. A session, or a legacy assignment. BOTH times are always sent: the
      // clock-edit core reads null as "clear", so the side nobody asked about
      // is re-read as it stands NOW (never the stored original, which an
      // admin may have corrected since) and passed back unchanged.
      const current = req.sessionId
        ? await tx.jobWorkSession
            .findFirst({ where: { id: req.sessionId }, select: { startedAt: true, endedAt: true, cleanerId: true } })
            .then((w) => (w && w.cleanerId === req.cleanerId ? w : null))
        : await tx.jobAssignment
            .findFirst({
              where: { jobId: req.jobId, cleanerId: req.cleanerId },
              select: { clockInTime: true, clockOutTime: true },
            })
            .then((a) => (a ? { startedAt: a.clockInTime, endedAt: a.clockOutTime } : null));
      if (!current) refuse(409, "COULD_NOT_APPLY", ENTRY_GONE);
      const cur = current!;

      let nextIn: Date | null;
      let nextOut: Date | null;
      if (input.decision === "ADJUST") {
        nextIn = input.start ?? null;
        nextOut = input.end ?? null;
        // A null end would CLEAR a clock-out on record and zero the hours.
        if (!nextOut && cur.endedAt) {
          refuse(400, "VALIDATION_FAILED", "This entry has a clock-out on record, so an end time is required.");
        }
      } else {
        nextIn = req.requestedStart ?? cur.startedAt;
        nextOut = req.requestedEnd ?? cur.endedAt;
      }

      const reason =
        input.decision === "ADJUST"
          ? `Adjusted${fromApp} on ${req.cleaner.name ?? "a cleaner"}'s time change request${input.note ? `: ${input.note}` : ""}`
          : `Approved${fromApp} ${req.cleaner.name ?? "a cleaner"}'s time change request: ${req.reason}`;
      const written = await writeClockEdit(
        tx,
        {
          jobId: req.jobId,
          sessionId: req.sessionId ?? undefined,
          // No session means a legacy job whose times sit on the assignment row.
          cleanerId: req.sessionId ? undefined : req.cleanerId,
          clockInTime: nextIn ? nextIn.toISOString() : null,
          clockOutTime: nextOut ? nextOut.toISOString() : null,
          reason,
        },
        { id: actor.userId, name: actor.name },
      );
      if (!written.success) refuse(409, "COULD_NOT_APPLY", stillWaiting(written.error));
      const w = written as Extract<typeof written, { success: true }>;

      // 3. The phone never applies hours under payroll that is already closed:
      // the item stays pending for someone to adjust the period deliberately.
      if (input.via === "app") {
        const period = await tx.payPeriod.findFirst({
          where: {
            status: { in: [...LOCKED_PAY_PERIOD_STATUSES] },
            startDate: { lte: w.jobDay },
            endDate: { gte: w.jobDay },
          },
          select: { status: true },
        });
        if (period) {
          refuse(
            409,
            "PAY_PERIOD_LOCKED",
            stillWaiting(`Payroll for this date is already ${period.status.toLowerCase().replace("_", " ")}.`),
          );
        }
      }
      return { kind: "clock" as const, recompute: w.recompute, applied: [nextIn, nextOut] as [Date | null, Date | null] };
    });
  } catch (e) {
    if (e instanceof Refusal) return e.failure;
    throw e;
  }

  // Derived state, from the sessions as committed. Each refuses a paid job or
  // a locked period on its own.
  if (applied.kind === "clock" && applied.recompute) await recomputeAfterClockEdit(req.jobId);
  if (applied.kind === "break") {
    await snapshotBilledActualHours(req.jobId).catch((e) => console.error("billed-hours snapshot", e));
    await snapshotHourlyEmployeePay(req.jobId).catch((e) => console.error("hourly-pay snapshot", e));
  }

  const verb = input.decision === "APPROVE" ? "approved" : input.decision === "ADJUST" ? "adjusted" : "rejected";
  const times =
    applied.kind === "clock" && input.decision === "ADJUST"
      ? ` Set to ${applied.applied[0] ? fmtDateTime(applied.applied[0]) : "—"} → ${applied.applied[1] ? fmtDateTime(applied.applied[1]) : "—"}.`
      : "";
  await logActivity({
    category: "ADMIN",
    action: applying ? "timelog.request.approved" : "timelog.request.rejected",
    status: "SUCCESS",
    actorId: actor.userId,
    actorLabel: actor.name,
    targetType: "Job",
    targetId: req.jobId,
    message:
      `${actor.name ?? "An admin"} ${verb}${fromApp} ` +
      `${req.cleaner.name ?? "a cleaner"}'s time change on job #${req.job.jobNumber} ` +
      `(${req.job.clientName}). Their reason: ${req.reason}.` +
      times +
      (input.note ? ` Decision note: ${input.note}` : ""),
  }).catch(() => {});

  return ok({ requestId: req.id, jobId: req.jobId }, [timeRequestDecidedPush(req.id, actor.userId)]);
}

/** The phone's decision: the service above, answered with the item as it now stands. */
export async function decideTimeItemFor(
  actor: Actor,
  id: string,
  body: { decision: TimeDecisionKind; start?: string | null; end?: string | null; note?: string },
  now: Date,
): Promise<Result<TimeItem>> {
  const note = body.note?.trim() || null;
  if (body.decision !== "APPROVE" && !note) {
    return failure(400, "NOTE_REQUIRED", "Add a note so the cleaner knows why their time was changed or refused.");
  }
  // Times are read for ADJUST only; APPROVE applies what was asked, REJECT nothing.
  if (body.decision === "ADJUST") {
    if (!body.start) return failure(400, "VALIDATION_FAILED", "A start time is required.");
    const invalid = validateClockEdit({ clockIn: parseInstant(body.start), clockOut: parseInstant(body.end ?? null) });
    if (invalid) return failure(400, "VALIDATION_FAILED", invalid);
  }
  const res = await decideTimeRequest(actor, {
    requestId: id,
    decision: body.decision,
    start: body.decision === "ADJUST" && body.start ? new Date(body.start) : null,
    end: body.decision === "ADJUST" && body.end ? new Date(body.end) : null,
    note,
    now,
    via: "app",
  });
  if (!res.ok) return res;
  const row = await db.timeLogChangeRequest.findFirst({ where: { id }, select: ITEM_SELECT });
  if (!row) return notFound(NOT_FOUND);
  const [item] = await toItems(actor, [row]);
  return ok(item, res.effects);
}
