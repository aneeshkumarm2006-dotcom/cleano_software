// GET /api/v1/jobs/:id/clock — where the caller stands on this job.
import { ClockStateResponse } from "@bookmops/api/v1";

import { clockStateFor } from "@/server/clock/phone";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route({ host: "tenant", access: "staff", response: ClockStateResponse }, (ctx) =>
  clockStateFor(ctx.actor, pathId(ctx.params.jobId)),
);
