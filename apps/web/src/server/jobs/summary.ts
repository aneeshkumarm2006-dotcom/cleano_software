// A job as the phone's lists show it (packages/api/src/v1/jobs.ts JobSummary).
//
// Built from the same helpers the web's cleaner screens use, so the two can't
// disagree about what a job is: the address resolver, the service label with
// the admin's own names, this cleaner's payout, and this cleaner's own clock
// (their sessions, not the job-level pair a teammate may have set).
import "server-only";

import type { JobSummary } from "@bookmops/api/v1";
import { resolveAddressParts } from "@bookmops/core/property";
import { jobTypeLabel, normalizeJobType } from "@bookmops/core/services";
import type { Prisma } from "@prisma/client";

import { cleanerPayoutForJobs } from "@/lib/cleaner-pay-display";
import { db } from "@/lib/org-db";
import { getServiceCatalogWithLabels } from "@/lib/service-catalog.server";
import { sessionsFromLegacyPair, summariseSessions } from "@/lib/work-sessions";

/** The columns every summary needs. */
export const SUMMARY_SELECT = {
  id: true,
  startTime: true,
  endTime: true,
  location: true,
  aptNumber: true,
  postalCode: true,
  jobType: true,
  status: true,
  clockInTime: true,
  clockOutTime: true,
  clientAddress: { select: { aptNumber: true, city: true, postalCode: true } },
} satisfies Prisma.JobSelect;

export type SummaryJob = Prisma.JobGetPayload<{ select: typeof SUMMARY_SELECT }>;

export type ClockState = "NOT_STARTED" | "CLOCKED_IN" | "ON_BREAK" | "CLOCKED_OUT";

export interface MyClock {
  state: ClockState;
  clockedInAt: Date | null;
  clockedOutAt: Date | null;
  openSession: { id: string; startedAt: Date } | null;
  sessions: { id: string | null; startedAt: Date; endedAt: Date | null }[];
  breaks: { id: string; startedAt: Date; endedAt: Date | null }[];
}

/**
 * This cleaner's clock on each job: their own sessions and breaks, or, on a
 * job so old it has no session rows at all, the job-level pair it always had.
 * Same fallback as the web's job page.
 */
export async function myClocks(
  jobs: { id: string; clockInTime: Date | null; clockOutTime: Date | null }[],
  cleanerId: string,
): Promise<Map<string, MyClock>> {
  const ids = jobs.map((j) => j.id);
  const out = new Map<string, MyClock>();
  if (ids.length === 0) return out;

  const [mine, anyone, breaks] = await Promise.all([
    db.jobWorkSession.findMany({
      where: { jobId: { in: ids }, cleanerId },
      orderBy: { startedAt: "asc" },
      select: { id: true, jobId: true, startedAt: true, endedAt: true },
    }),
    db.jobWorkSession.findMany({
      where: { jobId: { in: ids } },
      distinct: ["jobId"],
      select: { jobId: true },
    }),
    db.jobBreak.findMany({
      where: { jobId: { in: ids }, cleanerId },
      orderBy: { startedAt: "asc" },
      select: { id: true, jobId: true, startedAt: true, endedAt: true },
    }),
  ]);
  const withSessions = new Set(anyone.map((r) => r.jobId));

  for (const job of jobs) {
    const own = mine.filter((s) => s.jobId === job.id);
    const sessions: MyClock["sessions"] =
      own.length > 0
        ? own.map((s) => ({ id: s.id, startedAt: s.startedAt, endedAt: s.endedAt }))
        : withSessions.has(job.id)
          ? []
          : sessionsFromLegacyPair(job.clockInTime, job.clockOutTime).map((s) => ({
              id: null,
              startedAt: new Date(s.startedAt),
              endedAt: s.endedAt ? new Date(s.endedAt) : null,
            }));
    const myBreaks = breaks
      .filter((b) => b.jobId === job.id)
      .map((b) => ({ id: b.id, startedAt: b.startedAt, endedAt: b.endedAt }));
    const summary = summariseSessions(sessions, myBreaks);
    const open = own.find((s) => !s.endedAt) ?? null;
    const onBreak = summary.isOpen && myBreaks.some((b) => !b.endedAt);
    out.set(job.id, {
      state:
        summary.count === 0
          ? "NOT_STARTED"
          : summary.isOpen
            ? onBreak
              ? "ON_BREAK"
              : "CLOCKED_IN"
            : "CLOCKED_OUT",
      clockedInAt: summary.isOpen ? (open?.startedAt ?? summary.firstStartedAt) : null,
      clockedOutAt: summary.isOpen ? null : summary.lastEndedAt,
      openSession: open ? { id: open.id, startedAt: open.startedAt } : null,
      sessions,
      breaks: myBreaks,
    });
  }
  return out;
}

/** Everything a list of summaries needs, loaded once for the whole page. */
export async function summarise(jobs: SummaryJob[], cleanerId: string): Promise<JobSummary[]> {
  if (jobs.length === 0) return [];
  const [{ labels }, pay, clocks] = await Promise.all([
    getServiceCatalogWithLabels(),
    cleanerPayoutForJobs(
      jobs.map((j) => j.id),
      cleanerId,
    ),
    myClocks(jobs, cleanerId),
  ]);
  return jobs.map((job) => toSummary(job, labels, pay.get(job.id), clocks.get(job.id)));
}

export function toSummary(
  job: SummaryJob,
  labels: Record<string, string>,
  payout: number | undefined,
  clock: MyClock | undefined,
): JobSummary {
  const address = resolveAddressParts({
    address: job.location,
    aptNumber: job.aptNumber ?? job.clientAddress?.aptNumber ?? null,
    city: job.clientAddress?.city ?? null,
    postalCode: job.postalCode ?? job.clientAddress?.postalCode ?? null,
  });
  const category = normalizeJobType(job.jobType) ?? "OTHER";
  return {
    id: job.id,
    startsAt: job.startTime.toISOString(),
    endsAt: job.endTime ? job.endTime.toISOString() : null,
    address: {
      line1: address.street || job.location || "",
      line2: address.aptLabel ?? null,
      area: address.city ?? null,
    },
    service: {
      category,
      label: jobTypeLabel(job.jobType, labels) || "Cleaning",
    },
    payCents: typeof payout === "number" && Number.isFinite(payout) ? Math.round(payout * 100) : null,
    // Typed as the open enum's output; the value is the database's own.
    status: job.status as JobSummary["status"],
    clock: {
      state: clock?.state ?? "NOT_STARTED",
      clockedInAt: clock?.clockedInAt ? clock.clockedInAt.toISOString() : null,
    },
  };
}
