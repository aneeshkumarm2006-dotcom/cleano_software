// PUT /api/v1/availability/week — replace the caller's weekly pattern. All
// seven days once; the recurring flag and effective dates on record are kept.
import { AvailabilityResponse, WeekUpdateRequest } from "@bookmops/api/v1";

import { setMyWeek } from "@/server/availability/availability";
import { revalidateAfterAvailability } from "@/server/availability/revalidate";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const PUT = v1Route(
  { host: "tenant", access: "staff", body: WeekUpdateRequest, response: AvailabilityResponse, idempotent: true },
  async (ctx) => {
    const res = await setMyWeek(ctx.actor, ctx.body.days, ctx.receivedAt);
    if (res.ok) revalidateAfterAvailability(ctx.actor.userId);
    return res;
  },
);
