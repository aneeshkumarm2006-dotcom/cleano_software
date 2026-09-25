// Starting and ending a break while clocked in (awer_fixes.pdf item 26),
// moved here from app/admin/actions/jobBreak.ts so the phone's
// POST /api/v1/jobs/:id/breaks and …/breaks/:id/end run the same rules.
//
// AUTHZ: everything is scoped to the acting cleaner — they can only start or
// end their own break, on a job they are clocked in to.
//
// Breaks are separate rows, so a cleaner can take several on a long job. Break
// time is subtracted from active working time (see src/lib/time-tracking.ts)
// so it can never inflate paid hours.
//
// What changed in the move: "now" is an input (the web passes the current
// time; the phone the time its event is applied at), a phone event's id and
// arrival are recorded on the row, and the one-open-break index (migration
// 20260925120100) turns a double tap that races past the check into the same
// "already on a break" answer.
import "server-only";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/org-db";

import type { Actor } from "../actor";
import { failure, ok, type Result } from "../result";

/** Is this cleaner currently clocked in to this job? */
export async function currentClockIn(jobId: string, cleanerId: string): Promise<boolean> {
  const assignment = await db.jobAssignment.findUnique({
    where: { jobId_cleanerId: { jobId, cleanerId } },
    select: { clockInTime: true, clockOutTime: true },
  });
  if (assignment?.clockInTime && !assignment.clockOutTime) return true;

  // Legacy jobs with no per-cleaner assignment row fall back to the job-level
  // clock, same as the rest of the time-tracking read paths.
  if (!assignment) {
    const job = await db.job.findFirst({
      where: { id: jobId, employeeId: cleanerId },
      select: { clockInTime: true, clockOutTime: true },
    });
    return !!job?.clockInTime && !job.clockOutTime;
  }
  return false;
}

export interface BreakInput {
  jobId: string;
  now: Date;
  event?: { clientEventId: string; receivedAt: Date };
}

export async function startBreakService(actor: Actor, input: BreakInput): Promise<Result<{ breakId: string }>> {
  const { jobId } = input;
  if (typeof jobId !== "string" || !jobId.trim()) {
    return failure(400, "VALIDATION_FAILED", "Job is required");
  }
  const cleanerId = actor.userId;

  if (!(await currentClockIn(jobId, cleanerId))) {
    return failure(409, "NOT_CLOCKED_IN", "You need to be clocked in to this job to start a break.");
  }

  // Guard against a double-tap opening two overlapping breaks, which would
  // double-count the time against the cleaner.
  const running = await db.jobBreak.findFirst({
    where: { jobId, cleanerId, endedAt: null },
    select: { id: true },
  });
  if (running) return failure(409, "ALREADY_ON_BREAK", "You're already on a break.");

  try {
    const created = await db.jobBreak.create({
      data: {
        jobId,
        cleanerId,
        startedAt: input.now,
        ...(input.event ? { clientEventId: input.event.clientEventId, receivedAt: input.event.receivedAt } : {}),
      },
      select: { id: true },
    });
    return ok({ breakId: created.id });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return failure(409, "ALREADY_ON_BREAK", "You're already on a break.");
    }
    throw e;
  }
}

export async function endBreakService(actor: Actor, input: BreakInput): Promise<Result<{ breakId: string }>> {
  const { jobId } = input;
  if (typeof jobId !== "string" || !jobId.trim()) {
    return failure(400, "VALIDATION_FAILED", "Job is required");
  }
  const cleanerId = actor.userId;

  const running = await db.jobBreak.findFirst({
    where: { jobId, cleanerId, endedAt: null },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
  if (!running) return failure(409, "NOT_ON_BREAK", "You're not on a break.");

  await db.jobBreak.update({
    where: { id: running.id },
    data: {
      endedAt: input.now,
      ...(input.event ? { endClientEventId: input.event.clientEventId, endReceivedAt: input.event.receivedAt } : {}),
    },
  });
  return ok({ breakId: running.id });
}
