// The cleaner's checklist for a job: reading it, and ticking an item.
//
// Reading follows the web's job page exactly: while the job is still to do
// (CREATED, SCHEDULED, IN_PROGRESS) and not an unsettled quote, the checklist
// is generated on open (ensureJobChecklist, idempotent); a finished job keeps
// the one it ran with. Ticking is the web's updateChecklistItem, moved here so
// the web action and the phone share it (app/admin/actions/updateChecklistItem
// is now a thin adapter).
import "server-only";

import type { ChecklistItemStatus } from "@prisma/client";

import { sendAdminChecklistCompleted } from "@/lib/email";
import { ensureJobChecklist, readJobChecklist, type EnsureChecklistResult } from "@/lib/job-checklist.server";
import { db } from "@/lib/org-db";
import { isAwaitingQuote } from "@/lib/quote-status";

import type { Actor } from "../actor";
import { effect, type Effect } from "../effects";
import { failure, notFound, ok, type Result } from "../result";

const GENERATE_ON_OPEN = new Set(["CREATED", "SCHEDULED", "IN_PROGRESS"]);

/**
 * The checklist a cleaner on this job sees, or null when they aren't on it.
 * Same generate-or-read rule as the web's job page.
 */
export async function checklistForCleaner(
  actor: Actor,
  job: { id: string; status: string; quoteStatus: string | null; employeeId: string | null; cleaners: { id: string }[] },
): Promise<EnsureChecklistResult | null> {
  const onJob = job.employeeId === actor.userId || job.cleaners.some((c) => c.id === actor.userId);
  if (!onJob) return null;
  const quoteSettled = !isAwaitingQuote(job.quoteStatus);
  return quoteSettled && GENERATE_ON_OPEN.has(job.status)
    ? ensureJobChecklist(job.id, actor.userId)
    : readJobChecklist(job.id, actor.userId);
}

export interface ChecklistItemView {
  id: string;
  label: string;
  section: string | null;
  done: boolean;
}

export async function listChecklist(actor: Actor, jobId: string): Promise<Result<{ items: ChecklistItemView[] }>> {
  const job = await db.job.findFirst({
    where: { id: jobId, deletedAt: null },
    select: { id: true, status: true, quoteStatus: true, employeeId: true, cleaners: { select: { id: true } } },
  });
  if (!job) return notFound();
  const state = await checklistForCleaner(actor, job);
  if (!state) return notFound();
  const items = state.checklist?.items ?? [];
  return ok({
    items: items.map((i) => ({
      id: i.id,
      label: i.title,
      section: i.group === "addon" ? i.templateName : null,
      done: i.status === "COMPLETED",
    })),
  });
}

export interface UpdateChecklistItemInput {
  itemId: string;
  status?: ChecklistItemStatus;
  notes?: string | null;
  /** When set, the item must be on a checklist for this job (the phone's path). */
  jobId?: string;
  now: Date;
}

/**
 * Tick, untick or annotate one checklist item. Who may: an owner or admin, the
 * cleaner whose checklist it is, the job's lead, or a cleaner on the job --
 * exactly the web action's rule. Emails the office when the whole list is
 * done, as an effect.
 */
export async function updateChecklistItemFor(
  actor: Actor,
  input: UpdateChecklistItemInput,
): Promise<Result<{ item: ChecklistItemView; jobId: string }>> {
  const item = await db.jobChecklistItem.findUnique({
    where: { id: input.itemId },
    include: {
      checklist: {
        include: {
          job: { include: { cleaners: { select: { id: true } } } },
        },
      },
    },
  });
  if (!item) return failure(404, "NOT_FOUND", "Item not found");
  if (input.jobId !== undefined && item.checklist.jobId !== input.jobId) {
    return failure(404, "NOT_FOUND", "Item not found");
  }

  const isAdmin = actor.role === "OWNER" || actor.role === "ADMIN";
  const isOwnChecklist = item.checklist.employeeId === actor.userId;
  const isJobLead = item.checklist.job.employeeId === actor.userId;
  const isCleaner = item.checklist.job.cleaners.some((c) => c.id === actor.userId);
  if (!isAdmin && !isOwnChecklist && !isJobLead && !isCleaner) {
    // The web says "Not authorized"; the phone gets 404 like any id that isn't
    // its to touch.
    return failure(404, "NOT_AUTHORIZED", "Not authorized");
  }

  const data: { status?: ChecklistItemStatus; notes?: string | null; completedAt?: Date | null } = {};
  if (input.status !== undefined) {
    data.status = input.status;
    data.completedAt = input.status === "COMPLETED" ? input.now : null;
  }
  if (input.notes !== undefined) {
    data.notes = input.notes?.trim() ? input.notes.trim() : null;
  }

  const updated = await db.jobChecklistItem.update({
    where: { id: input.itemId },
    data,
    select: { id: true, title: true, status: true },
  });

  const effects: Effect[] = [];
  // After marking an item COMPLETED, check whether the whole checklist is now
  // done — if so, notify admin (gated by `admin.checklist.completed`).
  if (input.status === "COMPLETED") {
    const itemsAfter = await db.jobChecklistItem.findMany({
      where: { checklistId: item.checklistId },
      select: { status: true },
    });
    const allDone = itemsAfter.length > 0 && itemsAfter.every((i) => i.status === "COMPLETED");
    if (allDone) {
      const jobInfo = await db.job.findUnique({
        where: { id: item.checklist.jobId },
        select: { jobNumber: true, clientName: true },
      });
      if (jobInfo) {
        effects.push(
          effect("admin checklist email", () =>
            sendAdminChecklistCompleted({
              jobId: item.checklist.jobId,
              jobNumber: jobInfo.jobNumber,
              clientName: jobInfo.clientName,
              cleanerName: actor.name ?? "Cleaner",
              itemCount: itemsAfter.length,
            }),
          ),
        );
      }
    }
  }

  return ok(
    {
      jobId: item.checklist.jobId,
      item: {
        id: updated.id,
        label: updated.title,
        // A single item is re-read without its template; the list carries sections.
        section: null,
        done: updated.status === "COMPLETED",
      },
    },
    effects,
  );
}
