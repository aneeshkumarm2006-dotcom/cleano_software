// Clock events from the phone (API_V1.md §6), on top of the shared services.
//
// Every clock action from Bookmops Pro is an EVENT: a tap recorded on the
// phone with or without signal, sent when it can be, with an id (also the
// Idempotency-Key) and the time it happened. This file decides, per event:
//
//   WHICH TIME COUNTS. `decideEventTime` (@bookmops/core/time): the phone's
//   time when nothing disproves that it was offline and the gap is under five
//   minutes; otherwise the time the server received it. Lateness, the early
//   window, the penalty and the strike are all judged at the applied time.
//
//   WHAT THE OFFICE MUST SEE. When the phone's time was not applied as sent,
//   the event is applied at the received time AND a correction request carrying
//   the phone's time is raised (TimeLogChangeRequest, source PHONE). Approving
//   it moves the session or break to the phone's time through the same path an
//   admin edit takes. This is decision 2 of API_V1.md §12 as recommended:
//   office approval.
//
//   NOTHING IS DROPPED. An event that cannot be applied at all -- a clock-out
//   with no clock-in, a break outside a shift, an offline event on a job that
//   has since been paid or whose payroll is locked -- is not an error loop: it
//   becomes a correction request with the phone's time, and the answer says
//   `pendingReview: true`.
//
//   THE LOSER GETS THE WINNER'S RESULT. A second clock-in while clocked in, a
//   second break start while on break, an end with no break running: the state
//   the other tap already made true is returned, as a success.
//
// Replays never reach this file: the v1 wrapper answers a repeated
// Idempotency-Key with the stored response and fires nothing.
import "server-only";

import type { ClockEvent, ClockOutRequest, ClockStateResponse, ClockOutResponse, KitReportResponse } from "@bookmops/api/v1";
import {
  decideEventTime,
  kindForItemType,
  offlineCorrectionReason,
  TIME_LOG_REASON_MAX,
  type ClockEventKind,
  type EventTimeDecision,
} from "@bookmops/core/time";
import { Prisma } from "@prisma/client";

import { recordAdminNotification } from "@/lib/admin-notifications";
import { LOCKED_PAY_PERIOD_STATUSES } from "@/lib/hourly-pay.server";
import { db } from "@/lib/org-db";
import { fmtDateTime } from "@/lib/time";

import type { Actor } from "../actor";
import { effect, type Effect } from "../effects";
import { plannedMinutesOf } from "../jobs/detail";
import { myClocks } from "../jobs/summary";
import { failure, notFound, ok, type Failure, type Result } from "../result";
import { recentActivity } from "../v1/activity";
import { endBreakService, startBreakService } from "./breaks";
import { clockInService, reportClockInCrash } from "./clock-in";
import { clockOutService } from "./clock-out";
import { revalidateAfterBreak, revalidateAfterClockIn } from "./revalidate";

/** An event whose phone time is more than this old is "offline" for the paid/locked rule. */
const OFFLINE_MS = 60_000;

export interface PhoneEventContext {
  actor: Actor;
  jobId: string;
  receivedAt: Date;
  /** When the sending session was created (§6: a session newer than the tap disproves "offline"). */
  sessionCreatedAt: Date;
  /** The seconds this person made requests in, recently (§6: disproves "offline"). */
  activeSeconds: readonly Date[];
}

/** The context for a clock event, with the person's recent activity read. */
export async function phoneEventContext(
  ctx: { actor: Actor; receivedAt: Date; session: { createdAt: Date } },
  jobId: string,
): Promise<PhoneEventContext> {
  return {
    actor: ctx.actor,
    jobId,
    receivedAt: ctx.receivedAt,
    sessionCreatedAt: ctx.session.createdAt,
    activeSeconds: await recentActivity(ctx.actor.organizationId, ctx.actor.userId, ctx.receivedAt),
  };
}

interface JobForClock {
  id: string;
  status: string;
  startTime: Date;
  endTime: Date | null;
  jobDate: Date | null;
  employeeId: string | null;
  cleaners: { id: string }[];
}

/**
 * The job, when this cleaner may clock on it: they are on it now, or they
 * have work recorded on it (the stranded-session rule: taken off the roster
 * mid-shift, they can still stop the clock). Anything else is 404, including
 * another company's job, which the scoped client can't even see.
 */
async function jobForClock(actor: Actor, jobId: string): Promise<JobForClock | null> {
  const job = await db.job.findFirst({
    where: { id: jobId, deletedAt: null },
    select: {
      id: true,
      status: true,
      startTime: true,
      endTime: true,
      jobDate: true,
      employeeId: true,
      cleaners: { select: { id: true } },
    },
  });
  if (!job) return null;
  const onJob = job.employeeId === actor.userId || job.cleaners.some((c) => c.id === actor.userId);
  if (onJob) return job;
  const worked = await db.jobWorkSession.count({ where: { jobId, cleanerId: actor.userId } });
  return worked > 0 ? job : null;
}

/** Is payroll for this job's day already approved or paid? */
async function payrollLocked(job: JobForClock): Promise<boolean> {
  const day = job.jobDate ?? job.startTime;
  const period = await db.payPeriod.findFirst({
    where: { status: { in: [...LOCKED_PAY_PERIOD_STATUSES] }, startDate: { lte: day }, endDate: { gte: day } },
    select: { id: true },
  });
  return !!period;
}

// ── The state the app shows ─────────────────────────────────────────────────

export async function clockStateFor(actor: Actor, jobId: string): Promise<Result<ClockStateResponse>> {
  const job = await jobForClock(actor, jobId);
  if (!job) return notFound("This job isn't available.");
  return ok(await buildState(actor, job));
}

async function buildState(actor: Actor, job: JobForClock & { clockInTime?: Date | null; clockOutTime?: Date | null }): Promise<ClockStateResponse> {
  const pair = job.clockInTime !== undefined
    ? { clockInTime: job.clockInTime ?? null, clockOutTime: job.clockOutTime ?? null }
    : await db.job.findUnique({ where: { id: job.id }, select: { clockInTime: true, clockOutTime: true } });
  const clocks = await myClocks(
    [{ id: job.id, clockInTime: pair?.clockInTime ?? null, clockOutTime: pair?.clockOutTime ?? null }],
    actor.userId,
  );
  const mine = clocks.get(job.id)!;
  const pending = await db.timeLogChangeRequest.count({
    where: { jobId: job.id, cleanerId: actor.userId, source: "OFFLINE_CLOCK", status: "PENDING" },
  });
  return {
    jobId: job.id,
    state: mine.state,
    clockedInAt: mine.clockedInAt ? mine.clockedInAt.toISOString() : null,
    clockedOutAt: mine.clockedOutAt ? mine.clockedOutAt.toISOString() : null,
    breaks: mine.breaks.map((b) => ({
      startedAt: b.startedAt.toISOString(),
      endedAt: b.endedAt ? b.endedAt.toISOString() : null,
    })),
    plannedMinutes: plannedMinutesOf(job),
    pendingReview: pending > 0,
  };
}

// ── Correction requests ─────────────────────────────────────────────────────

interface CorrectionInput {
  ctx: PhoneEventContext;
  kind: ClockEventKind;
  occurredAt: Date;
  clientEventId: string;
  why: "NOT_PROVEN_OFFLINE" | "GAP_OVER_LIMIT" | "COULD_NOT_APPLY";
  detail?: string;
  /** What approval would change; absent when the office has to enter it by hand. */
  target?:
    | { sessionId: string; side: "start" | "end" }
    | { breakId: string; side: "start" | "end" };
}

/**
 * Raise the office's correction request for an event, once per event id.
 * Returns the notification to send, as an effect.
 */
async function raiseCorrection(input: CorrectionInput): Promise<Effect[]> {
  const { ctx, target } = input;
  let originalStart: Date | null = null;
  let originalEnd: Date | null = null;
  let sessionId: string | null = null;
  let breakId: string | null = null;

  if (target && "sessionId" in target) {
    const row = await db.jobWorkSession.findFirst({
      where: { id: target.sessionId, jobId: ctx.jobId, cleanerId: ctx.actor.userId },
      select: { id: true, startedAt: true, endedAt: true },
    });
    if (row) {
      sessionId = row.id;
      originalStart = row.startedAt;
      originalEnd = row.endedAt;
    }
  } else if (target && "breakId" in target) {
    const row = await db.jobBreak.findFirst({
      where: { id: target.breakId, jobId: ctx.jobId, cleanerId: ctx.actor.userId },
      select: { id: true, startedAt: true, endedAt: true },
    });
    if (row) {
      breakId = row.id;
      originalStart = row.startedAt;
      originalEnd = row.endedAt;
    }
  }

  const side = target?.side ?? (input.kind === "CLOCK_IN" || input.kind === "BREAK_START" ? "start" : "end");
  const reason = offlineCorrectionReason({
    kind: input.kind,
    occurredAt: input.occurredAt,
    receivedAt: ctx.receivedAt,
    why: input.why,
    detail: input.detail,
    fmt: (d) => fmtDateTime(d),
  }).slice(0, TIME_LOG_REASON_MAX);

  try {
    await db.timeLogChangeRequest.create({
      data: {
        jobId: ctx.jobId,
        cleanerId: ctx.actor.userId,
        sessionId,
        breakId,
        originalStart,
        originalEnd,
        requestedStart: side === "start" ? input.occurredAt : null,
        requestedEnd: side === "end" ? input.occurredAt : null,
        reason,
        source: "OFFLINE_CLOCK",
        eventKind: input.kind,
        offlineReason: input.why,
        clientEventId: input.clientEventId,
        occurredAt: input.occurredAt,
        receivedAt: ctx.receivedAt,
      },
    });
  } catch (e) {
    // The same event already raised its request: nothing more to say.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return [];
    throw e;
  }

  const who = ctx.actor.name ?? "A cleaner";
  return [
    effect("phone correction notification", () =>
      recordAdminNotification({
        key: "admin.timelog.change_requested",
        title: `${who}'s ${input.kind.toLowerCase().replace("_", "-")} from the app needs a look`,
        body: reason,
        href: "/admin/notifications?tab=timelog",
        severity: "WARN",
      }),
    ),
  ];
}

// ── Choosing the applied time ───────────────────────────────────────────────

interface Applied {
  at: Date;
  decision: EventTimeDecision;
  /** The phone's time was not applied and the office should see it. */
  review: boolean;
  why: "NOT_PROVEN_OFFLINE" | "GAP_OVER_LIMIT" | "COULD_NOT_APPLY";
  detail?: string;
}

function applyTime(ctx: PhoneEventContext, occurredAt: Date, notBefore: Date | null): Applied {
  const decision = decideEventTime({
    occurredAt,
    receivedAt: ctx.receivedAt,
    activeSeconds: ctx.activeSeconds,
    sessionCreatedAt: ctx.sessionCreatedAt,
  });
  let at = decision.appliedAt;
  let review = decision.kind === "RECEIVED" && decision.review;
  let why: Applied["why"] =
    decision.kind === "RECEIVED" && decision.reason === "NOT_PROVEN_OFFLINE" ? "NOT_PROVEN_OFFLINE" : "GAP_OVER_LIMIT";
  let detail: string | undefined;
  // Ordering against the cleaner's own records: a claimed time that would put
  // this event before the one it follows (a clock-out before its clock-in) is
  // not applied as sent.
  if (notBefore && at.getTime() < notBefore.getTime()) {
    at = ctx.receivedAt;
    review = true;
    why = "COULD_NOT_APPLY";
    detail = "it was earlier than the entry it follows";
  }
  return { at, decision, review, why, detail };
}

const isOffline = (ctx: PhoneEventContext, occurredAt: Date) =>
  ctx.receivedAt.getTime() - occurredAt.getTime() > OFFLINE_MS;

// ── The four events ─────────────────────────────────────────────────────────

export async function phoneClockIn(ctx: PhoneEventContext, event: ClockEvent): Promise<Result<ClockStateResponse>> {
  const job = await jobForClock(ctx.actor, ctx.jobId);
  if (!job) return notFound("This job isn't available.");
  const occurredAt = new Date(event.occurredAt);

  const sessions = await db.jobWorkSession.findMany({
    where: { jobId: job.id, cleanerId: ctx.actor.userId },
    orderBy: { startedAt: "desc" },
    select: { id: true, startedAt: true, endedAt: true },
  });
  // Already clocked in: the other tap won.
  if (sessions.some((s) => !s.endedAt)) return ok(await buildState(ctx.actor, job));

  const lastEnd = sessions.find((s) => s.endedAt)?.endedAt ?? null;
  const applied = applyTime(ctx, occurredAt, lastEnd);

  // Offline on a job since paid, or into locked payroll: not applied, sent
  // to the office (API_V1.md §6, "Events that arrive after a job looks finished").
  if (isOffline(ctx, occurredAt) && (job.status === "PAID" || (await payrollLocked(job)))) {
    const effects = await raiseCorrection({
      ctx,
      kind: "CLOCK_IN",
      occurredAt,
      clientEventId: event.clientEventId,
      why: "COULD_NOT_APPLY",
      detail: job.status === "PAID" ? "the job had already been paid" : "payroll for that day is closed",
    });
    return ok(await buildState(ctx.actor, job), effects);
  }

  const onJob = job.employeeId === ctx.actor.userId || job.cleaners.some((c) => c.id === ctx.actor.userId);
  if (!onJob) {
    // Taken off the job and not clocked in: the tap is kept for the office.
    const effects = await raiseCorrection({
      ctx,
      kind: "CLOCK_IN",
      occurredAt,
      clientEventId: event.clientEventId,
      why: "COULD_NOT_APPLY",
      detail: "they are no longer on this job",
    });
    return ok(await buildState(ctx.actor, job), effects);
  }

  let res: Awaited<ReturnType<typeof clockInService>>;
  try {
    res = await clockInService(ctx.actor, {
      jobId: job.id,
      now: applied.at,
      event: { clientEventId: event.clientEventId, receivedAt: ctx.receivedAt },
    });
  } catch (e) {
    await reportClockInCrash(ctx.actor, job.id, e).catch(() => {});
    throw e;
  }

  if (!res.ok) {
    if (res.code === "ALREADY_CLOCKED_IN") return ok(await buildState(ctx.actor, job));
    return res;
  }

  const effects = [...res.effects];
  if (applied.review) {
    effects.push(
      ...(await raiseCorrection({
        ctx,
        kind: "CLOCK_IN",
        occurredAt,
        clientEventId: event.clientEventId,
        why: applied.why,
        detail: applied.detail,
        target: { sessionId: res.value.sessionId, side: "start" },
      })),
    );
  }
  revalidateAfterClockIn(job.id);
  return ok(await buildState(ctx.actor, job), effects);
}

export async function phoneClockOut(
  ctx: PhoneEventContext,
  body: ClockOutRequest,
): Promise<Result<ClockOutResponse>> {
  const job = await jobForClock(ctx.actor, ctx.jobId);
  if (!job) return notFound("This job isn't available.");
  const occurredAt = new Date(body.occurredAt);

  const sessions = await db.jobWorkSession.findMany({
    where: { jobId: job.id, cleanerId: ctx.actor.userId },
    orderBy: { startedAt: "desc" },
    select: { id: true, startedAt: true, endedAt: true, endClientEventId: true },
  });
  const open = sessions.find((s) => !s.endedAt) ?? null;
  const report = { items: body.report.items };

  if (!open) {
    // This very event already closed a session and its answer was lost to a
    // failure after the commit: finish the job's tail, as the web's retry does.
    const closedByThis = sessions.find((s) => s.endClientEventId === body.clientEventId);
    if (closedByThis) {
      const outcome = await clockOutService(ctx.actor, {
        jobId: job.id,
        report: { items: [] },
        now: ctx.receivedAt,
        allowResume: true,
      });
      if (!outcome.result.success) return clockOutFailure(outcome.result);
      return ok(
        {
          clock: await buildState(ctx.actor, job),
          jobCompleted: outcome.result.jobCompleted,
          restockNeeded: false,
        },
        outcome.effects,
      );
    }
    // Clocked out already (another device, an earlier tap): the other tap won.
    if (sessions.length > 0) {
      return ok({ clock: await buildState(ctx.actor, job), jobCompleted: false, restockNeeded: false });
    }
    // A clock-out with no clock-in: kept for the office, never dropped.
    const effects = await raiseCorrection({
      ctx,
      kind: "CLOCK_OUT",
      occurredAt,
      clientEventId: body.clientEventId,
      why: "COULD_NOT_APPLY",
      detail: "there was no clock-in to close",
    });
    return ok({ clock: await buildState(ctx.actor, job), jobCompleted: false, restockNeeded: false }, effects);
  }

  const openBreak = await db.jobBreak.findFirst({
    where: { jobId: job.id, cleanerId: ctx.actor.userId, endedAt: null },
    select: { startedAt: true },
  });
  const notBefore =
    openBreak && openBreak.startedAt > open.startedAt ? openBreak.startedAt : open.startedAt;
  const applied = applyTime(ctx, occurredAt, notBefore);

  if (isOffline(ctx, occurredAt) && (await payrollLocked(job))) {
    const effects = await raiseCorrection({
      ctx,
      kind: "CLOCK_OUT",
      occurredAt,
      clientEventId: body.clientEventId,
      why: "COULD_NOT_APPLY",
      detail: "payroll for that day is closed",
      target: { sessionId: open.id, side: "end" },
    });
    return ok({ clock: await buildState(ctx.actor, job), jobCompleted: false, restockNeeded: false }, effects);
  }

  const outcome = await clockOutService(ctx.actor, {
    jobId: job.id,
    report,
    now: applied.at,
    allowResume: false,
    lenientReport: true,
    event: { clientEventId: body.clientEventId, receivedAt: ctx.receivedAt },
  });
  if (!outcome.result.success) return clockOutFailure(outcome.result);

  const effects = [...outcome.effects];
  if (applied.review && outcome.sessionId) {
    effects.push(
      ...(await raiseCorrection({
        ctx,
        kind: "CLOCK_OUT",
        occurredAt,
        clientEventId: body.clientEventId,
        why: applied.why,
        detail: applied.detail,
        target: { sessionId: outcome.sessionId, side: "end" },
      })),
    );
  }
  return ok(
    {
      clock: await buildState(ctx.actor, job),
      jobCompleted: outcome.result.jobCompleted,
      restockNeeded: outcome.result.restockNeeded,
    },
    effects,
  );
}

/** A clock-out failure, as the envelope's error. */
function clockOutFailure(f: { code: string; error: string; retryable: boolean }): Failure {
  switch (f.code) {
    case "JOB_NOT_FOUND":
    case "NOT_ASSIGNED":
      return failure(404, "NOT_FOUND", "This job isn't available.");
    case "NOT_CLOCKED_IN":
    case "ALREADY_CLOCKED_OUT":
      return failure(409, f.code, f.error);
    default:
      // SYNC_INCOMPLETE and the transient database classes are retryable; the
      // outbox tries again and the replay-safe paths above finish the job.
      return failure(f.retryable ? 409 : 422, f.code, f.error, f.retryable);
  }
}

export async function phoneBreak(
  ctx: PhoneEventContext,
  event: ClockEvent,
  kind: "BREAK_START" | "BREAK_END",
  breakRef: string | null,
): Promise<Result<ClockStateResponse>> {
  const job = await jobForClock(ctx.actor, ctx.jobId);
  if (!job) return notFound("This job isn't available.");
  const occurredAt = new Date(event.occurredAt);

  const [open, openBreak] = await Promise.all([
    db.jobWorkSession.findFirst({
      where: { jobId: job.id, cleanerId: ctx.actor.userId, endedAt: null },
      select: { id: true, startedAt: true },
    }),
    db.jobBreak.findFirst({
      where: { jobId: job.id, cleanerId: ctx.actor.userId, endedAt: null },
      orderBy: { startedAt: "desc" },
      select: { id: true, startedAt: true },
    }),
  ]);

  if (kind === "BREAK_END" && breakRef && breakRef !== "current" && openBreak && openBreak.id !== breakRef) {
    return notFound("That break isn't running.");
  }

  if (kind === "BREAK_START") {
    if (openBreak) return ok(await buildState(ctx.actor, job));
    if (!open) {
      const effects = await raiseCorrection({
        ctx,
        kind,
        occurredAt,
        clientEventId: event.clientEventId,
        why: "COULD_NOT_APPLY",
        detail: "they were not clocked in at the time",
      });
      return ok(await buildState(ctx.actor, job), effects);
    }
    const applied = applyTime(ctx, occurredAt, open.startedAt);
    const res = await startBreakService(ctx.actor, {
      jobId: job.id,
      now: applied.at,
      event: { clientEventId: event.clientEventId, receivedAt: ctx.receivedAt },
    });
    if (!res.ok) {
      if (res.code === "ALREADY_ON_BREAK") return ok(await buildState(ctx.actor, job));
      return res;
    }
    const effects = applied.review
      ? await raiseCorrection({
          ctx,
          kind,
          occurredAt,
          clientEventId: event.clientEventId,
          why: applied.why,
          detail: applied.detail,
          target: { breakId: res.value.breakId, side: "start" },
        })
      : [];
    revalidateAfterBreak(job.id);
    return ok(await buildState(ctx.actor, job), effects);
  }

  // BREAK_END
  if (!openBreak) return ok(await buildState(ctx.actor, job));
  const applied = applyTime(ctx, occurredAt, openBreak.startedAt);
  const res = await endBreakService(ctx.actor, {
    jobId: job.id,
    now: applied.at,
    event: { clientEventId: event.clientEventId, receivedAt: ctx.receivedAt },
  });
  if (!res.ok) {
    if (res.code === "NOT_ON_BREAK") return ok(await buildState(ctx.actor, job));
    return res;
  }
  const effects = applied.review
    ? await raiseCorrection({
        ctx,
        kind,
        occurredAt,
        clientEventId: event.clientEventId,
        why: applied.why,
        detail: applied.detail,
        target: { breakId: res.value.breakId, side: "end" },
      })
    : [];
  revalidateAfterBreak(job.id);
  return ok(await buildState(ctx.actor, job), effects);
}

// ── The closing kit report ──────────────────────────────────────────────────

export async function kitReportFor(actor: Actor, jobId: string): Promise<Result<KitReportResponse>> {
  const job = await jobForClock(actor, jobId);
  if (!job) return notFound("This job isn't available.");
  const kit = await db.employeeProduct.findMany({
    where: { employeeId: actor.userId },
    include: { product: { select: { name: true, unit: true, itemType: true } } },
    orderBy: { product: { name: "asc" } },
  });
  return ok({
    items: kit.map((ep) => ({
      productId: ep.productId,
      name: ep.product.name,
      unit: ep.product.unit,
      kind: kindForItemType(ep.product.itemType) as KitReportResponse["items"][number]["kind"],
      quantity: Math.round(ep.quantity),
    })),
  });
}
