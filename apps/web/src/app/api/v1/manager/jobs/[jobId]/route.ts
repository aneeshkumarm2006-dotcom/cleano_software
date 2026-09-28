// GET /api/v1/manager/jobs/:jobId — one job for the office
// (packages/api/src/v1/manager-team.ts ManagerJobResponse).
//
// TEAM_VIEW, and the job in the caller's view (rule 3), else 404. Contact
// details only for JOB_CONTACT; clock events, photos, checklist and issues
// only for JOB_RECORDS; a section the role can't see is null, not empty.
import { ManagerJobResponse } from "@bookmops/api/v1";

import { managerJobFor } from "@/server/manager/team";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route(
  { host: "tenant", access: { capability: "TEAM_VIEW" }, response: ManagerJobResponse },
  (ctx) => managerJobFor(ctx.actor, pathId(ctx.params.jobId), ctx.receivedAt),
);
