// GET /api/v1/manager/approvals/summary — how many wait in each queue
// (packages/api/src/v1/manager-approvals.ts ApprovalsSummaryResponse).
//
// TIME_APPROVE, WITHDRAWALS or KIT_REQUESTS, any one: the gate admits every
// staff role and the service answers 403 for a role with none of the three.
// A queue the role can't act on is null. The caller's own items are never
// counted.
import { ApprovalsSummaryResponse } from "@bookmops/api/v1";

import { approvalsSummaryFor } from "@/server/manager/approvals";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route({ host: "tenant", access: "anyStaff", response: ApprovalsSummaryResponse }, (ctx) =>
  approvalsSummaryFor(ctx.actor),
);
