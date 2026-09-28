// PUT /api/v1/jobs/:id/checklist/:itemId — tick or untick one item. The item
// must be on a checklist for this job; the rule for who may is the web's
// (server/checklist/checklist.ts). Idempotent on the event's id.
import { ChecklistItem, ChecklistItemUpdate } from "@bookmops/api/v1";

import { updateChecklistItemFor } from "@/server/checklist/checklist";
import { revalidateAfterChecklist } from "@/server/clock/revalidate";
import { failure, ok } from "@/server/result";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const PUT = v1Route(
  {
    host: "tenant",
    access: "staff",
    body: ChecklistItemUpdate,
    response: ChecklistItem,
    idempotent: true,
    limit: { name: "checklist", max: 120, windowMs: 60_000 },
  },
  async (ctx) => {
    const jobId = pathId(ctx.params.jobId);
    const res = await updateChecklistItemFor(ctx.actor, {
      itemId: pathId(ctx.params.itemId),
      jobId,
      status: ctx.body.done ? "COMPLETED" : "PENDING",
      now: ctx.receivedAt,
    });
    if (!res.ok) return failure(404, "NOT_FOUND", "This item isn't available.");
    // The job page and the clock page both show the checklist.
    revalidateAfterChecklist(jobId);
    return ok(res.value.item, res.effects);
  },
);
