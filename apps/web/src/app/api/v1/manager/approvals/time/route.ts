// GET /api/v1/manager/approvals/time?status=pending|decided&cursor= — the
// clock-time queue (packages/api/src/v1/manager-approvals.ts).
//
// TIME_APPROVE. OWNER, ADMIN and OPS_MANAGER company-wide; a FIELD_LEAD their
// group only; never the caller's own. Pending oldest first, decided newest.
import { TimeItemsResponse } from "@bookmops/api/v1";
import { z } from "zod";

import { listTimeItems } from "@/server/manager/time";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

const Query = z.object({
  status: z.enum(["pending", "decided"]).default("pending"),
  cursor: z.string().max(512).optional(),
});

export const GET = v1Route(
  { host: "tenant", access: { capability: "TIME_APPROVE" }, query: Query, response: TimeItemsResponse },
  (ctx) => listTimeItems(ctx.actor, ctx.query.status, ctx.query.cursor),
);
