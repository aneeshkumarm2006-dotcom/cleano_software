// Recurring-series helpers (awer_fixes.pdf item 9).
//
// A recurring booking is a PARENT job plus N child jobs linked by
// `Job.parentJobId`. Each child is a real, independently editable Job row —
// that is what already satisfies "move or edit one instance without changing
// the full series". What was missing is the other half: applying an edit to the
// WHOLE series at once.

import { db } from "@/db";

/**
 * Fields that propagate when an admin chooses "apply to the whole series".
 *
 * Deliberately EXCLUDES:
 *   • startTime / jobDate / endTime — each occurrence has its own slot; that's
 *     the entire point of a recurring series;
 *   • status, paymentReceived, paidAt, invoiceSent, clock times, tips —
 *     per-occurrence facts, not series settings;
 *   • discountAmount — a child's discount carries its own recurring-frequency
 *     component, so copying the edited job's figure across would either wipe or
 *     duplicate that. Left alone on purpose.
 */
export const SERIES_PROPAGATED_FIELDS = [
  "clientName",
  "clientId",
  "location",
  "aptNumber",
  "description",
  "jobType",
  "price",
  "employeePay",
  "payType",
  "hourlyRate",
  "payRateMultiplier",
  "notes",
  "paymentType",
  "bedCount",
  "bathCount",
  "halfBathCount",
  "squareFootage",
  "taxExempt",
  "isFlexible",
  "requiredCleaners",
] as const;

export type SeriesField = (typeof SERIES_PROPAGATED_FIELDS)[number];

/**
 * The id every member of this job's series hangs off: the parent when the job
 * is a child, otherwise the job itself.
 */
export function seriesRootId(job: {
  id: string;
  parentJobId: string | null;
}): string {
  return job.parentJobId ?? job.id;
}

/**
 * Statuses that must never be rewritten by a series edit. Changing the price of
 * a job that is already completed and paid would corrupt financial history and
 * silently disagree with an invoice that has already gone out.
 */
const IMMUTABLE_STATUSES = ["COMPLETED", "PAID", "CANCELLED"] as const;

export interface SeriesUpdateResult {
  /** How many sibling jobs were updated (excludes the edited job itself). */
  updated: number;
  /** How many were skipped because they are completed/paid/cancelled. */
  skipped: number;
}

/**
 * Apply an edit across a recurring series.
 *
 * `data` should be the same field set saveJob built for the edited job; only
 * the keys in SERIES_PROPAGATED_FIELDS are copied, so callers can pass the
 * whole object without accidentally overwriting dates or payment state.
 *
 * Completed / paid / cancelled occurrences are left untouched and reported via
 * `skipped`, so the admin is told the series was not blanket-rewritten.
 */
export async function applyToJobSeries(
  editedJobId: string,
  rootId: string,
  data: Record<string, unknown>,
  cleanerIds?: string[]
): Promise<SeriesUpdateResult> {
  const payload: Record<string, unknown> = {};
  for (const field of SERIES_PROPAGATED_FIELDS) {
    if (field in data) payload[field] = data[field];
  }

  const siblings = await db.job.findMany({
    where: {
      deletedAt: null,
      id: { not: editedJobId },
      OR: [{ id: rootId }, { parentJobId: rootId }],
    },
    select: { id: true, status: true },
  });

  const editable = siblings.filter(
    (j) => !(IMMUTABLE_STATUSES as readonly string[]).includes(j.status)
  );
  const skipped = siblings.length - editable.length;

  if (editable.length === 0) return { updated: 0, skipped };

  if (Object.keys(payload).length > 0) {
    await db.job.updateMany({
      where: { id: { in: editable.map((j) => j.id) } },
      data: payload,
    });
  }

  // The cleaner team is a relation, so it can't ride along in updateMany.
  if (cleanerIds) {
    const { resolveJobLead, syncJobAssignments } = await import(
      "@/lib/job-assignments"
    );
    for (const j of editable) {
      await db.job.update({
        where: { id: j.id },
        data: {
          employeeId: resolveJobLead(null, cleanerIds),
          cleaners:
            cleanerIds.length > 0
              ? { set: cleanerIds.map((id) => ({ id })) }
              : { set: [] },
        },
      });
      await syncJobAssignments(j.id, cleanerIds);
    }
  }

  return { updated: editable.length, skipped };
}

/** Series membership info for the job modal's "apply to" control. */
export async function getSeriesInfo(jobId: string): Promise<{
  isSeries: boolean;
  rootId: string;
  /** Occurrences that a series edit would actually change. */
  editableCount: number;
}> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { id: true, parentJobId: true },
  });
  if (!job) return { isSeries: false, rootId: jobId, editableCount: 0 };

  const rootId = seriesRootId(job);
  const members = await db.job.findMany({
    where: {
      deletedAt: null,
      id: { not: jobId },
      OR: [{ id: rootId }, { parentJobId: rootId }],
    },
    select: { status: true },
  });

  const editableCount = members.filter(
    (m) => !(IMMUTABLE_STATUSES as readonly string[]).includes(m.status)
  ).length;

  return { isSeries: members.length > 0, rootId, editableCount };
}
