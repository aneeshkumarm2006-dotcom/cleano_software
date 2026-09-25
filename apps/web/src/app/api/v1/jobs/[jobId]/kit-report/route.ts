// GET /api/v1/jobs/:id/kit-report — the caller's kit, to report on at clock-out.
import { KitReportResponse } from "@bookmops/api/v1";

import { kitReportFor } from "@/server/clock/phone";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route({ host: "tenant", access: "staff", response: KitReportResponse }, (ctx) =>
  kitReportFor(ctx.actor, pathId(ctx.params.jobId)),
);
