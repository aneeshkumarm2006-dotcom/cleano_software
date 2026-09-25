// GET /api/v1/today — the Today screen, in one request.
import { TodayResponse } from "@bookmops/api/v1";

import { todayFor } from "@/server/jobs/today";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route({ host: "tenant", access: "staff", response: TodayResponse }, (ctx) =>
  todayFor(ctx.actor, ctx.receivedAt),
);
