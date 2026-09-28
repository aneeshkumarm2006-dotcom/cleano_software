// The Today screen in one request (GET /api/v1/today).
//
//   date         today, in the company's zone
//   nextJob      the job this cleaner is clocked into, or else the next of
//                their upcoming jobs they haven't finished
//   laterToday   today's other jobs that start after nextJob, in order
//   week         this company week (Sunday start, as the web's weeks are):
//                  jobs      jobs of theirs that start this week, not cancelled
//                  hours     their own active hours on sessions started this
//                            week, breaks removed
//                  earnings  their payout on this week's jobs they've finished
//   unread       office chat messages to them not yet read, and their own
//                unread, undismissed notifications
import "server-only";

import type { TodayResponse } from "@bookmops/api/v1";
import type { Prisma } from "@prisma/client";

import { cleanerAssignedWhere, upcomingJobsWhere } from "@/lib/cleaner-jobs";
import { cleanerPayoutForJobs } from "@/lib/cleaner-pay-display";
import { db } from "@/lib/org-db";
import { startOfStoreWeek, storeCivilDayRange, storeDateKey } from "@/lib/timezone";
import { summariseSessions } from "@/lib/work-sessions";

import type { Actor } from "../actor";
import { ok, type Result } from "../result";
import { SUMMARY_SELECT, summarise } from "./summary";

const DONE = new Set(["COMPLETED", "PAID"]);

/** YYYY-MM-DD plus n calendar days, on the calendar itself (DST-proof). */
function addCivilDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export async function todayFor(actor: Actor, now: Date): Promise<Result<TodayResponse>> {
  const date = storeDateKey(now);
  const day = storeCivilDayRange(date);
  const weekStart = startOfStoreWeek(now);
  const weekEnd = storeCivilDayRange(addCivilDays(storeDateKey(weekStart), 7)).start;
  const base = cleanerAssignedWhere(actor.userId);
  const scoped = (extra: Prisma.JobWhereInput): Prisma.JobWhereInput => ({
    ...base,
    AND: [...(base.AND as Prisma.JobWhereInput[]), extra],
  });

  const [openSession, todays, upcoming] = await Promise.all([
    db.jobWorkSession.findFirst({
      where: { cleanerId: actor.userId, endedAt: null, job: { deletedAt: null } },
      orderBy: { startedAt: "desc" },
      select: { jobId: true },
    }),
    db.job.findMany({
      where: scoped({ startTime: { gte: day.start, lt: day.end }, status: { not: "CANCELLED" } }),
      orderBy: [{ startTime: "asc" }, { id: "asc" }],
      take: 50,
      select: SUMMARY_SELECT,
    }),
    db.job.findMany({
      where: upcomingJobsWhere(actor.userId, now),
      orderBy: [{ startTime: "asc" }, { id: "asc" }],
      take: 10,
      select: SUMMARY_SELECT,
    }),
  ]);

  // The clocked-in job may be yesterday's overnight one, or even one the
  // cleaner has since been taken off (the stranded-session rule): it is still
  // the one to act on, so it is loaded by id within their scope or by session.
  const clockedIn = openSession
    ? await db.job.findFirst({
        where: { id: openSession.jobId, deletedAt: null },
        select: SUMMARY_SELECT,
      })
    : null;

  const candidates = [...(clockedIn ? [clockedIn] : []), ...upcoming, ...todays];
  const unique = [...new Map(candidates.map((j) => [j.id, j])).values()];
  const summaries = new Map((await summarise(unique, actor.userId)).map((s) => [s.id, s]));

  const next =
    (clockedIn && summaries.get(clockedIn.id)) ||
    upcoming
      .map((j) => summaries.get(j.id)!)
      .find((s) => s && s.clock.state !== "CLOCKED_OUT" && !DONE.has(s.status)) ||
    null;

  const laterToday = todays
    .map((j) => summaries.get(j.id)!)
    .filter((s) => s && s.id !== next?.id && (!next || s.startsAt >= next.startsAt));

  // ── The week ────────────────────────────────────────────────────────────
  const weekJobs = await db.job.findMany({
    where: scoped({ startTime: { gte: weekStart, lt: weekEnd }, status: { not: "CANCELLED" } }),
    select: { id: true, startTime: true, status: true },
  });
  const inWeek = weekJobs;
  const weekIds = inWeek.map((j) => j.id);
  const [sessions, breaks, pay] = await Promise.all([
    db.jobWorkSession.findMany({
      where: { cleanerId: actor.userId, startedAt: { gte: weekStart, lt: weekEnd } },
      select: { jobId: true, startedAt: true, endedAt: true },
    }),
    db.jobBreak.findMany({
      where: { cleanerId: actor.userId, startedAt: { gte: weekStart, lt: weekEnd } },
      select: { startedAt: true, endedAt: true },
    }),
    cleanerPayoutForJobs(weekIds, actor.userId),
  ]);
  const activeMinutes = summariseSessions(sessions, breaks, now).activeMinutes;
  const finishedByMe = new Set(sessions.filter((s) => s.endedAt).map((s) => s.jobId));
  const earnings = inWeek
    .filter((j) => DONE.has(j.status) || finishedByMe.has(j.id))
    .reduce((sum, j) => sum + (pay.get(j.id) ?? 0), 0);

  // ── Unread ──────────────────────────────────────────────────────────────
  const conversation = await db.chatConversation.findUnique({
    where: { employeeId: actor.userId },
    select: { id: true },
  });
  const [office, notifications] = await Promise.all([
    conversation
      ? db.chatMessage.count({
          where: { conversationId: conversation.id, senderRole: "ADMIN", readByEmployeeAt: null },
        })
      : Promise.resolve(0),
    db.alert.count({ where: { recipientUserId: actor.userId, isRead: false, isDismissed: false } }),
  ]);

  return ok({
    date,
    nextJob: next,
    laterToday,
    week: {
      hours: Math.round((activeMinutes / 60) * 10) / 10,
      jobs: inWeek.length,
      earningsCents: Math.round(earnings * 100),
    },
    unread: { office, notifications },
  });
}
