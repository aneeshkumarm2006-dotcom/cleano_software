// PUT /api/v1/manager/jobs/:jobId/crew — set who is on the job in one call
// (packages/api/src/v1/manager-team.ts SetCrewRequest).
//
// CREW_SET (OWNER, ADMIN). Idempotent on clientEventId. The job row is locked,
// the crew on record must be `expectedCrewIds` (409 CREW_CHANGED) and the
// warnings for the people added must hash to `acknowledgedWarningsHash`
// (409 WARNINGS_CHANGED), all before the first write. 60 an hour.
import { CrewChangeResponse, SetCrewRequest } from "@bookmops/api/v1";

import { CREW_CHANGE_LIMIT, setCrewFor } from "@/server/manager/crew";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const PUT = v1Route(
  {
    host: "tenant",
    access: { capability: "CREW_SET" },
    body: SetCrewRequest,
    response: CrewChangeResponse,
    idempotent: true,
    limit: CREW_CHANGE_LIMIT,
  },
  (ctx) =>
    setCrewFor(
      ctx.actor,
      pathId(ctx.params.jobId),
      {
        cleanerIds: ctx.body.cleanerIds,
        expectedCrewIds: ctx.body.expectedCrewIds,
        acknowledgedWarningsHash: ctx.body.acknowledgedWarningsHash,
      },
      ctx.receivedAt,
    ),
);
