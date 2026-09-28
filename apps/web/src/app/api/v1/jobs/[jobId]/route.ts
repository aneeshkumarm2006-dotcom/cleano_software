// GET /api/v1/jobs/:id — one of the caller's jobs. Not theirs is 404.
import { JobDetailResponse } from "@bookmops/api/v1";

import { jobDetailFor } from "@/server/jobs/detail";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route({ host: "tenant", access: "staff", response: JobDetailResponse }, (ctx) =>
  jobDetailFor(ctx.actor, pathId(ctx.params.jobId)),
);
