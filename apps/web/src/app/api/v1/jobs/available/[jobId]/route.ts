// GET /api/v1/jobs/available/:id — one open job, before claiming. Read-only.
// Anything the caller couldn't claim (including a job they're already on) is
// 404, so a job that can't be claimed can't be previewed or probed.
import { AvailableJobDetailResponse } from "@bookmops/api/v1";

import { availableJobDetailFor } from "@/server/available/board";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route({ host: "tenant", access: "staff", response: AvailableJobDetailResponse }, (ctx) =>
  availableJobDetailFor(ctx.actor, pathId(ctx.params.jobId), ctx.receivedAt),
);
