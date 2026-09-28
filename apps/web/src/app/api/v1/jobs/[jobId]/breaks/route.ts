// POST /api/v1/jobs/:id/breaks — a break-start event. Idempotent on its id.
import { ClockEvent, ClockStateResponse } from "@bookmops/api/v1";

import { phoneBreak, phoneEventContext } from "@/server/clock/phone";
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
  async (ctx) =>
    phoneBreak(
      await phoneEventContext(ctx, pathId(ctx.params.jobId)),
      ctx.body,
      "BREAK_START",
      null,
    ),
);
