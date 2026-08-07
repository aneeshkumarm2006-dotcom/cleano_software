// The single writer for JobChecklist rows (awerfixes.pdf item 5, round 3).
//
// This used to live inside the `generateJobChecklist` server action, which made
// it unreachable from a server component: the action calls `revalidatePath`, and
// calling that during render throws. Item 12.a needs generation to happen when a
// cleaner OPENS the job — no button — so the DB work moved here and the action
// became a thin auth + revalidate wrapper around it.
//
// The rules it enforces are in job-checklist.ts (pure, unit-testable).

import { db } from "@/db";
import { templateMatchesJob } from "@/lib/checklist-triggers";
import {
  resolveChecklistAction,
  type ChecklistItemShape,
} from "@/lib/job-checklist";
import type {
  JobChecklistDTO,
  JobChecklistItemDTO,
} from "@/app/admin/actions/getJobChecklist.types";

export type EnsureChecklistFailure =
  | "JOB_NOT_FOUND"
  | "NOT_AUTHORIZED"
  | "ERROR";

export interface EnsureChecklistResult {
  /** Null when no template matches this job — see `reason`. */
  checklist: JobChecklistDTO | null;
  /**
   * True when the job's details changed after the checklist was created AND the
   * cleaner had already started, so their progress was kept instead of a rebuild.
   */
  stale: boolean;
  /** Set only when `checklist` is null. */
  reason: "NO_TEMPLATES" | EnsureChecklistFailure | null;
}

const EMPTY = (reason: EnsureChecklistResult["reason"]): EnsureChecklistResult => ({
  checklist: null,
  stale: false,
  reason,
});

function toDTO(
  checklist: {
    id: string;
    jobId: string;
    employeeId: string;
    items: {
      id: string;
      title: string;
      description: string | null;
      status: JobChecklistItemDTO["status"];
      isRequired: boolean;
      sortOrder: number;
      notes: string | null;
      completedAt: Date | null;
    }[];
  }
): JobChecklistDTO {
  return {
    id: checklist.id,
    jobId: checklist.jobId,
    employeeId: checklist.employeeId,
    items: checklist.items.map((it) => ({
      id: it.id,
      title: it.title,
      description: it.description,
      status: it.status,
      isRequired: it.isRequired,
      sortOrder: it.sortOrder,
      notes: it.notes,
      completedAt: it.completedAt,
      group: "standard",
      templateName: null,
    })),
  };
}

const ITEM_SELECT = {
  id: true,
  title: true,
  description: true,
  status: true,
  isRequired: true,
  sortOrder: true,
  notes: true,
  completedAt: true,
} as const;

/**
 * The item set the CURRENT active templates produce for this job.
 *
 * Every active template is loaded and filtered in memory rather than matched in
 * SQL: case-insensitive add-on matching can't be expressed with an `in` clause,
 * and the template table is small (one row per checklist, not per job).
 */
export async function expectedChecklistItems(job: {
  jobType: string | null;
  addOnNames: string[];
}): Promise<ChecklistItemShape[]> {
  const candidates = await db.checklistTemplate.findMany({
    where: { isActive: true },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });

  const matching = candidates.filter((t) =>
    templateMatchesJob(
      { jobType: t.jobType, addOnName: t.addOnName },
      { jobType: job.jobType, addOnNames: job.addOnNames }
    )
  );

  return matching.flatMap((tpl, tplIdx) =>
    tpl.items.map((item, itemIdx) => ({
      title: item.title,
      description: item.description,
      isRequired: item.isRequired,
      sortOrder: tplIdx * 1000 + (item.sortOrder ?? itemIdx),
    }))
  );
}

/**
 * Get this employee's checklist for this job, creating or refreshing it as the
 * job's details require. Safe to call on every page render: idempotent, and a
 * no-op once the stored items already match the job.
 *
 * Does NOT call `revalidatePath` — that is illegal during render and is the
 * caller's job when this runs inside a server action.
 */
export async function ensureJobChecklist(
  jobId: string,
  employeeId: string,
  opts: { bypassParticipantCheck?: boolean } = {}
): Promise<EnsureChecklistResult> {
  try {
    const job = await db.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        deletedAt: true,
        jobType: true,
        employeeId: true,
        cleaners: { select: { id: true } },
        addOns: { select: { name: true } },
      },
    });
    if (!job || job.deletedAt) return EMPTY("JOB_NOT_FOUND");

    const isParticipant =
      job.employeeId === employeeId ||
      job.cleaners.some((c) => c.id === employeeId);
    if (!isParticipant && !opts.bypassParticipantCheck) {
      return EMPTY("NOT_AUTHORIZED");
    }

    const expected = await expectedChecklistItems({
      jobType: job.jobType,
      addOnNames: job.addOns.map((a) => a.name),
    });

    // `findFirst` ordered by createdAt: there is no unique constraint on
    // (jobId, employeeId) in the deployed database yet, so if a duplicate ever
    // slipped through, every reader must at least agree on WHICH row is the
    // real one. getJobChecklist orders the same way.
    const existing = await db.jobChecklist.findFirst({
      where: { jobId, employeeId },
      orderBy: { createdAt: "asc" },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });

    if (!existing) {
      // A job with no matching template gets NO ROW. The old code created an
      // empty checklist here, and its own `findFirst` early-return then made
      // that permanent — adding a template later could never take effect. With
      // generation now firing on every page open, that would have baked an
      // empty checklist into every job on day one.
      if (expected.length === 0) return EMPTY("NO_TEMPLATES");
      return { checklist: await createChecklist(jobId, employeeId, expected), stale: false, reason: null };
    }

    const action = resolveChecklistAction(
      existing.items.map((it) => ({
        title: it.title,
        description: it.description,
        isRequired: it.isRequired,
        sortOrder: it.sortOrder,
        status: it.status,
        notes: it.notes,
      })),
      expected
    );

    if (action === "KEEP") {
      return { checklist: toDTO(existing), stale: false, reason: null };
    }

    if (action === "STALE") {
      // The cleaner is mid-way through. Their ticks are worth more than a tidy
      // list, so keep them and let the UI say the job changed.
      return { checklist: toDTO(existing), stale: true, reason: null };
    }

    if (action === "DISCARD") {
      // Nothing matches any more and nothing has been ticked — remove the row
      // rather than leave an empty checklist behind (see above).
      await db.jobChecklist.delete({ where: { id: existing.id } });
      return EMPTY("NO_TEMPLATES");
    }

    // REGENERATE — untouched, so rebuilding costs the cleaner nothing. Replace
    // the items in place so the checklist id (and anything referencing it)
    // survives.
    const [, refreshed] = await db.$transaction([
      db.jobChecklistItem.deleteMany({ where: { checklistId: existing.id } }),
      db.jobChecklist.update({
        where: { id: existing.id },
        data: { items: { create: expected } },
        select: {
          id: true,
          jobId: true,
          employeeId: true,
          items: { select: ITEM_SELECT, orderBy: { sortOrder: "asc" } },
        },
      }),
    ]);
    return { checklist: toDTO(refreshed), stale: false, reason: null };
  } catch (error) {
    console.error("ensureJobChecklist failed", jobId, employeeId, error);
    return EMPTY("ERROR");
  }
}

async function createChecklist(
  jobId: string,
  employeeId: string,
  items: ChecklistItemShape[]
): Promise<JobChecklistDTO> {
  const select = {
    id: true,
    jobId: true,
    employeeId: true,
    items: { select: ITEM_SELECT, orderBy: { sortOrder: "asc" as const } },
  };
  try {
    return toDTO(
      await db.jobChecklist.create({
        data: { jobId, employeeId, templateId: null, items: { create: items } },
        select,
      })
    );
  } catch (e) {
    // Generating on render turns a rare race into a routine one: two concurrent
    // requests for the same job both miss the `findFirst` and both create. The
    // unique index makes the loser fail with P2002 instead of writing a
    // duplicate; re-read and use the winner's row.
    const code = (e as { code?: string }).code;
    if (code !== "P2002") throw e;
    const winner = await db.jobChecklist.findFirst({
      where: { jobId, employeeId },
      orderBy: { createdAt: "asc" },
      select,
    });
    if (!winner) throw e;
    return toDTO(winner);
  }
}

/**
 * Read this employee's checklist without creating or refreshing anything.
 *
 * Used for finished jobs (COMPLETED / PAID): whatever was generated while the
 * job ran is the record of what was done, and regenerating it against today's
 * templates would rewrite history.
 */
export async function readJobChecklist(
  jobId: string,
  employeeId: string
): Promise<EnsureChecklistResult> {
  try {
    const checklist = await db.jobChecklist.findFirst({
      where: { jobId, employeeId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        jobId: true,
        employeeId: true,
        items: { select: ITEM_SELECT, orderBy: { sortOrder: "asc" } },
      },
    });
    if (!checklist) return EMPTY("NO_TEMPLATES");
    return { checklist: toDTO(checklist), stale: false, reason: null };
  } catch (error) {
    console.error("readJobChecklist failed", jobId, employeeId, error);
    return EMPTY("ERROR");
  }
}

/** Required items still outstanding — the clock-out gate's one question. */
export function pendingRequiredCount(
  items: { isRequired: boolean; status: string }[]
): number {
  return items.filter((i) => i.isRequired && i.status !== "COMPLETED").length;
}
