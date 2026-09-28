// GET /api/v1/pay/payouts?cursor=… — the caller's pay periods, newest first.
import { PayoutsResponse } from "@bookmops/api/v1";
import { z } from "zod";

import { payoutsFor } from "@/server/pay/summary";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

const PageQuery = z.object({ cursor: z.string().max(512).optional() });

export const GET = v1Route(
  { host: "tenant", access: "staff", query: PageQuery, response: PayoutsResponse },
  (ctx) => payoutsFor(ctx.actor, ctx.query.cursor),
);
