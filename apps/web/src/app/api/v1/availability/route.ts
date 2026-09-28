// GET /api/v1/availability — the caller's weekly pattern and days off.
import { AvailabilityResponse } from "@bookmops/api/v1";

import { getMyAvailability } from "@/server/availability/availability";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route({ host: "tenant", access: "staff", response: AvailabilityResponse }, (ctx) =>
  getMyAvailability(ctx.actor, ctx.receivedAt),
);
