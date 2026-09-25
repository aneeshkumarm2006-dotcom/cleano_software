// POST /api/v1/jobs/:id/clock-out — a clock-out event, with the closing kit
// report. Idempotent on the event's id (API_V1.md §6).
import { ClockOutRequest, ClockOutResponse } from "@bookmops/api/v1";

import { phoneClockOut } from "@/server/clock/phone";
import { CLOCK_EVENT_LIMIT, pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const POST = v1Route(
  {
    host: "tenant",
    access: "staff",
    body: ClockOutRequest,
    response: ClockOutResponse,
    idempotent: true,
    limit: CLOCK_EVENT_LIMIT,
  },
  (ctx) =>
    phoneClockOut(
      {
        actor: ctx.actor,
        jobId: pathId(ctx.params.jobId),
        receivedAt: ctx.receivedAt,
        lastRequestAt: ctx.session.lastRequestAt,
      },
      ctx.body,
    ),
);
