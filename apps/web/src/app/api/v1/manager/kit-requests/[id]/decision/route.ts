// POST /api/v1/manager/kit-requests/:id/decision — APPROVE or REJECT a
// restock request (packages/api/src/v1/manager-approvals.ts).
//
// KIT_REQUESTS. Idempotent on clientEventId: stock moves once. The claim, the
// warehouse check and the movement share one transaction
// (server/manager/kit-requests.ts): 409 ALREADY_RESOLVED for a second
// decider, 409 WAREHOUSE_SHORT with the request still pending. The caller's
// own is 403 SELF_APPROVAL.
import { KitDecisionRequest, KitRequestItem } from "@bookmops/api/v1";

import { resolveKitRequest } from "@/server/manager/kit-requests";
import { revalidateAfterKitDecision } from "@/server/manager/revalidate";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const POST = v1Route(
  {
    host: "tenant",
    access: { capability: "KIT_REQUESTS" },
    body: KitDecisionRequest,
    response: KitRequestItem,
    idempotent: true,
  },
  async (ctx) => {
    const res = await resolveKitRequest(ctx.actor, pathId(ctx.params.id), ctx.body.decision, "app");
    if (res.ok) revalidateAfterKitDecision(res.value.employee.id);
    return res;
  },
);
