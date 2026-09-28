// GET /api/v1/manager/late-arrivals?cursor= — the last 30 days' late
// clock-ins, newest first (packages/api/src/v1/manager-inbox.ts).
//
// ALERTS. A FIELD_LEAD sees their group's jobs; the office roles the
// company's. Read from what clockIn writes; the job's area, never its client.
import { LateArrivalsResponse } from "@bookmops/api/v1";
import { z } from "zod";

import { lateArrivalsFor } from "@/server/manager/alerts";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

const Query = z.object({ cursor: z.string().max(512).optional() });

export const GET = v1Route(
  { host: "tenant", access: { capability: "ALERTS" }, query: Query, response: LateArrivalsResponse },
  (ctx) => lateArrivalsFor(ctx.actor, ctx.query.cursor, ctx.receivedAt),
);
