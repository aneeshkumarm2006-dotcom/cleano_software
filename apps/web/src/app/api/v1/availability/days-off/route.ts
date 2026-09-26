// POST   /api/v1/availability/days-off — take `from` to `to` off (≤ 31 days,
//        inside the web's window). A date already off just gets the new reason.
// DELETE /api/v1/availability/days-off?from=&to= — back on the weekly pattern
//        for those dates; only the caller's rows; an empty range is no error.
import { AvailabilityResponse, DaysOffRequest, LocalDate } from "@bookmops/api/v1";
import { z } from "zod";

import { addMyDaysOff, removeMyDaysOff } from "@/server/availability/availability";
import { revalidateAfterAvailability } from "@/server/availability/revalidate";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const POST = v1Route(
  { host: "tenant", access: "staff", body: DaysOffRequest, response: AvailabilityResponse, idempotent: true },
  async (ctx) => {
    const res = await addMyDaysOff(
      ctx.actor,
      { from: ctx.body.from, to: ctx.body.to, reason: ctx.body.reason ?? null },
      ctx.receivedAt,
    );
    if (res.ok) revalidateAfterAvailability(ctx.actor.userId);
    return res;
  },
);

const RangeQuery = z.object({ from: LocalDate, to: LocalDate });

export const DELETE = v1Route(
  { host: "tenant", access: "staff", query: RangeQuery, response: AvailabilityResponse },
  async (ctx) => {
    const res = await removeMyDaysOff(ctx.actor, { from: ctx.query.from, to: ctx.query.to }, ctx.receivedAt);
    if (res.ok) revalidateAfterAvailability(ctx.actor.userId);
    return res;
  },
);
