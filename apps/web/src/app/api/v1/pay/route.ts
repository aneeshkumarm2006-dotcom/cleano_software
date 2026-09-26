// GET /api/v1/pay — the My pay screen in one request: balance, the live week,
// the year so far, the rating, and the withdrawal rules. The caller's own
// money only; the figures are the web page's own (server/pay/summary.ts).
import { PayResponse } from "@bookmops/api/v1";

import { payOverviewFor } from "@/server/pay/summary";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route({ host: "tenant", access: "staff", response: PayResponse }, (ctx) =>
  payOverviewFor(ctx.actor, ctx.receivedAt),
);
