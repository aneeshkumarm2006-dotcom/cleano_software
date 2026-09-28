// GET /api/v1/manager/issues/:id — one reported problem. ISSUES; another
// company's is 404.
import { IssueResponse } from "@bookmops/api/v1";

import { issueFor } from "@/server/manager/issues";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route({ host: "tenant", access: { capability: "ISSUES" }, response: IssueResponse }, (ctx) =>
  issueFor(ctx.actor, pathId(ctx.params.id)),
);
