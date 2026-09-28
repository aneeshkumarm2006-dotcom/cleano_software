// GET /api/v1/manager/issues?status=open|resolved&cursor= — problems cleaners
// reported (packages/api/src/v1/manager-inbox.ts IssuesResponse).
//
// ISSUES (OWNER, ADMIN). Open is URGENT first, then newest.
import { IssuesResponse } from "@bookmops/api/v1";
import { z } from "zod";

import { listIssuesFor } from "@/server/manager/issues";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

const Query = z.object({
  status: z.enum(["open", "resolved"]).default("open"),
  cursor: z.string().max(512).optional(),
});

export const GET = v1Route(
  { host: "tenant", access: { capability: "ISSUES" }, query: Query, response: IssuesResponse },
  (ctx) => listIssuesFor(ctx.actor, ctx.query.status, ctx.query.cursor),
);
