// POST /api/v1/jobs/:id/breaks/:breakId/end — a break-end event. `:breakId`
// is "current" (what the app sends: it may have started the break offline and
// never learned its id) or the running break's own id. Idempotent on the
// event's id.
import { ClockEvent, ClockStateResponse } from "@bookmops/api/v1";

import { phoneBreak } from "@/server/clock/phone";
import { CLOCK_EVENT_LIMIT, pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const POST = v1Route(
  {
    host: "tenant",
    access: "staff",
    body: ClockEvent,
    response: ClockStateResponse,
    idempotent: true,
    limit: CLOCK_EVENT_LIMIT,
  },
  (ctx) =>
    phoneBreak(
      {
        actor: ctx.actor,
        jobId: pathId(ctx.params.jobId),
        receivedAt: ctx.receivedAt,
        lastRequestAt: ctx.session.lastRequestAt,
      },
      ctx.body,
      "BREAK_END",
      pathId(ctx.params.breakId),
    ),
);
