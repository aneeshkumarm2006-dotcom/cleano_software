// POST /api/v1/jobs/:id/clock-in — a clock-in event from the phone.
// Idempotent on the event's id; which time counts is decided in
// server/clock/phone.ts (API_V1.md §6).
import { ClockEvent, ClockStateResponse } from "@bookmops/api/v1";

import { phoneClockIn, phoneEventContext } from "@/server/clock/phone";
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
    phoneClockIn(
      await phoneEventContext(ctx, pathId(ctx.params.jobId)),
      ctx.body,
    ),
);
