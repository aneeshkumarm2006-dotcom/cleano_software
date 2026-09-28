// POST /api/v1/manager/issues/:id/status — acknowledge, resolve or reopen
// (packages/api/src/v1/manager-inbox.ts IssueStatusRequest).
//
// ISSUES. Idempotent on clientEventId. Resolving needs a note (400
// NOTE_REQUIRED). The same service as the web's setJobIssueStatus.
import { IssueResponse, IssueStatusRequest } from "@bookmops/api/v1";

import { setIssueStatusFor } from "@/server/manager/issues";
import { revalidateAfterIssueChange } from "@/server/manager/revalidate";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const POST = v1Route(
  {
    host: "tenant",
    access: { capability: "ISSUES" },
    body: IssueStatusRequest,
    response: IssueResponse,
    idempotent: true,
  },
  async (ctx) => {
    const res = await setIssueStatusFor(
      ctx.actor,
      pathId(ctx.params.id),
      { status: ctx.body.status, resolutionNote: ctx.body.resolutionNote },
      ctx.receivedAt,
    );
    if (res.ok) revalidateAfterIssueChange(res.value.job.id);
    return res;
  },
);
