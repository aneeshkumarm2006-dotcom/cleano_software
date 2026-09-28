// POST /api/v1/manager/jobs/:jobId/cleaners — add one cleaner to the job, as
// the web's bulk "Assign cleaner" does for one job
// (packages/api/src/v1/manager-team.ts AddCleanerRequest).
//
// CREW_ADD (OWNER, ADMIN, OPS_MANAGER), and the job in view: an OPS_MANAGER
// adds to today's jobs, or to their own on another day. Idempotent on
// clientEventId; no emails, as the web's bulk path. 60 an hour.
import { AddCleanerRequest, CrewChangeResponse } from "@bookmops/api/v1";

import { addCleanerFor, CREW_CHANGE_LIMIT } from "@/server/manager/crew";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const POST = v1Route(
  {
    host: "tenant",
    access: { capability: "CREW_ADD" },
    body: AddCleanerRequest,
    response: CrewChangeResponse,
    idempotent: true,
    limit: CREW_CHANGE_LIMIT,
  },
  (ctx) =>
    addCleanerFor(
      ctx.actor,
      pathId(ctx.params.jobId),
      { cleanerId: ctx.body.cleanerId, acknowledgedWarningsHash: ctx.body.acknowledgedWarningsHash },
      ctx.receivedAt,
    ),
);
