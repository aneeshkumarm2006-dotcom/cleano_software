// One job, for the cleaner on it (GET /api/v1/jobs/:id).
//
// Found inside the cleaner's own scope (lib/cleaner-jobs.ts
// cleanerAssignedWhere), so a job they aren't on, one in another company, a
// soft-deleted one and an unsettled quote all answer the same 404.
//
// Notes go through the same sanitiser as the web's job page, so billing and
// price text never reach a cleaner, and the client is a first name only.
import "server-only";

import type { JobDetailResponse } from "@bookmops/api/v1";
import { sanitizeCleanerNotes } from "@bookmops/core/jobs";
import type { Prisma } from "@prisma/client";

import { cleanerAssignedWhere } from "@/lib/cleaner-jobs";
import { cleanerPayoutForJobs } from "@/lib/cleaner-pay-display";
import { db } from "@/lib/org-db";
import { getServiceCatalogWithLabels } from "@/lib/service-catalog.server";

import type { Actor } from "../actor";
import { checklistForCleaner } from "../checklist/checklist";
import { notFound, ok, type Result } from "../result";
import { myClocks, SUMMARY_SELECT, toSummary } from "./summary";

/** The job, only if it is in this cleaner's scope. */
export async function findMyJob<S extends Prisma.JobSelect>(actor: Actor, jobId: string, select: S) {
  const base = cleanerAssignedWhere(actor.userId);
  return db.job.findFirst({
    where: { ...base, AND: [...(base.AND as Prisma.JobWhereInput[]), { id: jobId }] },
    select,
  });
}

/** Scheduled length, for the clock screen's ring. */
export function plannedMinutesOf(job: { startTime: Date; endTime: Date | null }): number | null {
  if (!job.endTime) return null;
  const m = Math.round((job.endTime.getTime() - job.startTime.getTime()) / 60_000);
  return m > 0 && m < 24 * 60 ? m : null;
}

function firstName(clientName: string | null): string | null {
  const first = (clientName ?? "").trim().split(/\s+/)[0];
  return first ? first : null;
}

export async function jobDetailFor(actor: Actor, jobId: string): Promise<Result<JobDetailResponse>> {
  const job = await findMyJob(actor, jobId, {
    ...SUMMARY_SELECT,
    clientName: true,
    notes: true,
    quoteStatus: true,
    employeeId: true,
    employee: { select: { id: true, name: true } },
    cleaners: { select: { id: true, name: true } },
  });
  if (!job) return notFound("This job isn't available.");

  const [{ labels }, pay, clocks, checklist] = await Promise.all([
    getServiceCatalogWithLabels(),
    cleanerPayoutForJobs([job.id], actor.userId),
    myClocks([job], actor.userId),
    checklistForCleaner(actor, job),
  ]);

  const items = checklist?.checklist?.items ?? [];
  const crew = new Map<string, { id: string; name: string; isLead: boolean }>();
  if (job.employee) crew.set(job.employee.id, { id: job.employee.id, name: job.employee.name, isLead: true });
  for (const c of job.cleaners) {
    if (!crew.has(c.id)) crew.set(c.id, { id: c.id, name: c.name, isLead: c.id === job.employeeId });
  }

  return ok({
    ...toSummary(job, labels, pay.get(job.id), clocks.get(job.id)),
    client: { firstName: firstName(job.clientName) },
    notes: sanitizeCleanerNotes(job.notes) || null,
    checklist: { done: items.filter((i) => i.status === "COMPLETED").length, total: items.length },
    crew: [...crew.values()],
    plannedMinutes: plannedMinutesOf(job),
  });
}
