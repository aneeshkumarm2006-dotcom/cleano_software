// GET /api/v1/pay/periods/:id — one of the caller's pay periods and its jobs.
// `:id` is one of their payout ids, or "current" for the live week. Someone
// else's payout is 404, the same as one that doesn't exist.
import { PayPeriodDetailResponse } from "@bookmops/api/v1";

import { payPeriodFor } from "@/server/pay/summary";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route({ host: "tenant", access: "staff", response: PayPeriodDetailResponse }, (ctx) =>
  payPeriodFor(ctx.actor, ctx.params.id === "current" ? "current" : pathId(ctx.params.id), ctx.receivedAt),
);
