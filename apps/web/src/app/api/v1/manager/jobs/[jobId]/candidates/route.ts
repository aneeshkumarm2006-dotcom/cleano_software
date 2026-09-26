// GET /api/v1/manager/jobs/:jobId/candidates — who could be put on this job,
// with the web's availability and service-category warnings
// (packages/api/src/v1/manager-team.ts CandidatesResponse).
//
// CREW_SET or CREW_ADD (the route admits CREW_ADD, whose roles include every
// CREW_SET role; the service checks either), and the job in view, else 404.
import { CandidatesResponse } from "@bookmops/api/v1";

import { candidatesFor } from "@/server/manager/crew";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route(
  { host: "tenant", access: { capability: "CREW_ADD" }, response: CandidatesResponse },
  (ctx) => candidatesFor(ctx.actor, pathId(ctx.params.jobId), ctx.receivedAt),
);
