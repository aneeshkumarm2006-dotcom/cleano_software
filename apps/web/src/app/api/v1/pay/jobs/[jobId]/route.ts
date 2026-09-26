// GET /api/v1/pay/jobs/:jobId — what one job paid the caller, and why. Only a
// job they lead or are on (else 404), and only their own share: never the
// price, the charges, the tier or the pool.
import { JobPayResponse } from "@bookmops/api/v1";

import { jobPayFor } from "@/server/pay/job-pay";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route({ host: "tenant", access: "staff", response: JobPayResponse }, (ctx) =>
  jobPayFor(ctx.actor, pathId(ctx.params.jobId)),
);
