// GET /api/v1/manager/withdrawals?status=open|handled&cursor= — the payouts
// queue (packages/api/src/v1/manager-approvals.ts WithdrawalsQueueResponse).
//
// WITHDRAWALS (OWNER, ADMIN). Never the caller's own withdrawals, in the rows
// or in openTotalCents.
import { WithdrawalsQueueResponse } from "@bookmops/api/v1";
import { z } from "zod";

import { listWithdrawalsFor } from "@/server/manager/withdrawals";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

const Query = z.object({
  status: z.enum(["open", "handled"]).default("open"),
  cursor: z.string().max(512).optional(),
});

export const GET = v1Route(
  { host: "tenant", access: { capability: "WITHDRAWALS" }, query: Query, response: WithdrawalsQueueResponse },
  (ctx) => listWithdrawalsFor(ctx.actor, ctx.query.status, ctx.query.cursor),
);
