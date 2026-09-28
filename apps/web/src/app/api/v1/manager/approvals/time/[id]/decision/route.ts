// POST /api/v1/manager/approvals/time/:id/decision — APPROVE, ADJUST or
// REJECT one time item (packages/api/src/v1/manager-approvals.ts).
//
// TIME_APPROVE; ADJUST also needs TIME_ADJUST (a FIELD_LEAD may only approve
// or reject). Idempotent on clientEventId. The claim, the times it applies and
// the decision commit together (server/manager/time.ts); a second decider
// gets 409 ALREADY_DECIDED, a locked pay period 409 PAY_PERIOD_LOCKED with
// the item still pending. The caller's own item is 403 SELF_APPROVAL.
import { TimeDecisionRequest, TimeItemResponse } from "@bookmops/api/v1";

import { decideTimeItemFor } from "@/server/manager/time";
import { revalidateAfterTimeDecision } from "@/server/manager/revalidate";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const POST = v1Route(
  {
    host: "tenant",
    access: { capability: "TIME_APPROVE" },
    body: TimeDecisionRequest,
    response: TimeItemResponse,
    idempotent: true,
  },
  async (ctx) => {
    const res = await decideTimeItemFor(
      ctx.actor,
      pathId(ctx.params.id),
      { decision: ctx.body.decision, start: ctx.body.start, end: ctx.body.end, note: ctx.body.note },
      ctx.receivedAt,
    );
    if (res.ok) revalidateAfterTimeDecision(res.value.job.id);
    return res;
  },
);
