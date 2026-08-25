// The single writer for JobChecklist rows (awerfixes.pdf item 5, round 3).
//
// This used to live inside the `generateJobChecklist` server action, which made
// it unreachable from a server component: the action calls `revalidatePath`, and
// calling that during render throws. Item 12.a needs generation to happen when a
// cleaner OPENS the job — no button — so the DB work moved here and the action
// became a thin auth + revalidate wrapper around it.
//
// The rules it enforces are in job-checklist.ts (pure, unit-testable).

import { db } from "@/lib/org-db";
import {
  resolveChecklistTemplates,
  type ChecklistResolutionTier,
  type ChecklistScopedJob,
} from "@/lib/checklist-triggers";
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
 * What the CURRENT active templates produce for this job: the items, plus which
 * templates produced them and under which precedence tier.
 *
 * Every active template is loaded and filtered in memory rather than matched in
 * SQL: case-insensitive add-on matching can't be expressed with an `in` clause,
 * the customer/service precedence is a multi-tier rule rather than a filter, and
 * the template table is small (one row per checklist, not per job).
 */
export interface ExpectedChecklist {
  items: ChecklistItemShape[];
  /** Templates behind `items`, in the order their items appear. */
  templates: { id: string; name: string }[];
  tier: ChecklistResolutionTier;
  /** The job pins a template that is deleted or deactivated — see the resolver. */
  pinnedUnavailable: boolean;
}

export async function resolveExpectedChecklist(
  job: ChecklistScopedJob
): Promise<ExpectedChecklist> {
  const candidates = await db.checklistTemplate.findMany({
    where: { isActive: true },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });

  // Stage 10: one shared precedence — job pin → address → client → service
  // default. Before this the filter was the service trigger alone.
  const resolved = resolveChecklistTemplates(candidates, job);

  return {
    items: resolved.templates.flatMap((tpl, tplIdx) =>
      tpl.items.map((item, itemIdx) => ({
        title: item.title,
        description: item.description,
        isRequired: item.isRequired,
        sortOrder: tplIdx * 1000 + (item.sortOrder ?? itemIdx),
      }))
    ),
    templates: resolved.templates.map((t) => ({ id: t.id, name: t.name })),
    tier: resolved.tier,
    pinnedUnavailable: resolved.pinnedUnavailable,
  };
}

/**
 * The item set alone. Kept as the narrow entry point for callers that only ask
 * "what should be on this list" and have no use for the provenance.
 */
export async function expectedChecklistItems(
  job: ChecklistScopedJob
): Promise<ChecklistItemShape[]> {
  return (await resolveExpectedChecklist(job)).items;
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
        // Stage 10 — the customer link and the per-job pin are inputs to the
        // resolution now, so they have to travel with the service trigger.
        clientId: true,
        clientAddressId: true,
        checklistTemplateId: true,
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

    const resolved = await resolveExpectedChecklist({
      jobType: job.jobType,
      addOnNames: job.addOns.map((a) => a.name),
      clientId: job.clientId,
      clientAddressId: job.clientAddressId,
      checklistTemplateId: job.checklistTemplateId,
    });
    const expected = resolved.items;

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
      return {
        checklist: await createChecklist(
          jobId,
          employeeId,
          expected,
          primaryTemplateId(resolved)
        ),
        stale: false,
        reason: null,
      };
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
        // Step 10.3 — the provenance is rewritten with the items. A regenerate
        // is exactly the moment the source template can have changed (a
        // customer link added, a job pinned), so leaving the old id behind
        // would make the column lie in precisely the case it exists for.
        data: { templateId: primaryTemplateId(resolved), items: { create: expected } },
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

/**
 * Which template to record on `JobChecklist.templateId` (step 10.3).
 *
 * The column is a single FK but a checklist can legitimately be the
 * concatenation of several templates — that is the whole DEFAULT tier: a global
 * list plus a jobType list plus an add-on list. So it records the source only
 * when the answer is unambiguous, and NULL otherwise; a "primary" picked out of
 * three equals would be a guess dressed up as provenance.
 *
 * In practice the tiers that matter for PDF #10 — a pinned job, a customer
 * checklist, a location checklist — are single-template by construction, which
 * is exactly where traceability was wanted.
 */
function primaryTemplateId(resolved: ExpectedChecklist): string | null {
  return resolved.templates.length === 1 ? resolved.templates[0].id : null;
}

async function createChecklist(
  jobId: string,
  employeeId: string,
  items: ChecklistItemShape[],
  templateId: string | null
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
        // `templateId` was hard-coded null here until Stage 10, so no checklist
        // ever recorded where it came from.
        data: { jobId, employeeId, templateId, items: { create: items } },
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

// ── The admin's per-job checklist view (Stage 10 / PDF #10, step 10.5) ──────
//
// Until Stage 10 there was NO admin-facing checklist surface at all: templates
// were configured in Settings, checklists were generated on the cleaner's phone,
// and nothing in between ever showed an admin which list a given job would
// produce. That gap is exactly why "why did the Mckiernan crew get the generic
// list" was unanswerable without reading the database.
//
// READ-ONLY, deliberately. It resolves what the cleaner WOULD get and reports
// what has already been generated; it creates nothing. Generating a checklist
// for a cleaner who has not opened the job would put items in their app that
// nobody asked for and would freeze the snapshot early — before the admin has
// finished editing the job.

export interface JobChecklistSummary {
  tier: ChecklistResolutionTier;
  /** Templates that resolution picks for this job right now. */
  templates: { id: string; name: string }[];
  /** How many items those templates would produce. */
  itemCount: number;
  requiredCount: number;
  /** The job pins a template that is deleted or inactive — see the resolver. */
  pinnedUnavailable: boolean;
  /** True when an admin pinned this job rather than letting it auto-resolve. */
  pinned: boolean;
  /** What has actually been generated, per cleaner. */
  generated: {
    employeeId: string;
    employeeName: string;
    total: number;
    completed: number;
    /** Stored items no longer match what the templates now produce. */
    drifted: boolean;
  }[];
}

export async function summarizeJobChecklist(
  jobId: string
): Promise<JobChecklistSummary | null> {
  try {
    const job = await db.job.findUnique({
      where: { id: jobId },
      select: {
        jobType: true,
        clientId: true,
        clientAddressId: true,
        checklistTemplateId: true,
        addOns: { select: { name: true } },
        checklists: {
          orderBy: { createdAt: "asc" },
          select: {
            employeeId: true,
            employee: { select: { name: true } },
            items: {
              select: {
                title: true,
                description: true,
                isRequired: true,
                sortOrder: true,
                status: true,
                notes: true,
              },
            },
          },
        },
      },
    });
    if (!job) return null;

    const resolved = await resolveExpectedChecklist({
      jobType: job.jobType,
      addOnNames: job.addOns.map((a) => a.name),
      clientId: job.clientId,
      clientAddressId: job.clientAddressId,
      checklistTemplateId: job.checklistTemplateId,
    });

    return {
      tier: resolved.tier,
      templates: resolved.templates,
      itemCount: resolved.items.length,
      requiredCount: resolved.items.filter((i) => i.isRequired).length,
      pinnedUnavailable: resolved.pinnedUnavailable,
      pinned: !!job.checklistTemplateId && !resolved.pinnedUnavailable,
      generated: job.checklists.map((c) => ({
        employeeId: c.employeeId,
        employeeName: c.employee?.name ?? "Unknown",
        total: c.items.length,
        completed: c.items.filter((i) => i.status === "COMPLETED").length,
        // Same rule the cleaner's page runs, so the admin's "out of date" badge
        // and the cleaner's stale banner can never disagree (step 10.8).
        drifted: resolveChecklistAction(c.items, resolved.items) !== "KEEP",
      })),
    };
  } catch (error) {
    console.error("summarizeJobChecklist failed", jobId, error);
    return null;
  }
}

/** Required items still outstanding — the clock-out gate's one question. */
export function pendingRequiredCount(
  items: { isRequired: boolean; status: string }[]
): number {
  return items.filter((i) => i.isRequired && i.status !== "COMPLETED").length;
}
