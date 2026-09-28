// GET /api/v1/manager/approvals/time/:id — one time item.
//
// TIME_APPROVE. Another group's item (FIELD_LEAD) or another company's is
// 404; the caller's own is 403 SELF_APPROVAL.
import { TimeItemResponse } from "@bookmops/api/v1";

import { timeItemFor } from "@/server/manager/time";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route(
  { host: "tenant", access: { capability: "TIME_APPROVE" }, response: TimeItemResponse },
  (ctx) => timeItemFor(ctx.actor, pathId(ctx.params.id)),
);
