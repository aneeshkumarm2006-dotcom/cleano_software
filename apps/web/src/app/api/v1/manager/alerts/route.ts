// GET /api/v1/manager/alerts?cursor= — the office's notification feed
// (packages/api/src/v1/manager-inbox.ts AlertsResponse).
//
// ALERTS. OWNER, ADMIN and OPS_MANAGER read the company's feed, as on the
// web. A FIELD_LEAD reads only FIELD_LEAD_ALERT_KINDS about a job in their
// group, with a title built from the kind and job number and no body.
import { AlertsResponse } from "@bookmops/api/v1";
import { z } from "zod";

import { alertsFor } from "@/server/manager/alerts";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

const Query = z.object({ cursor: z.string().max(512).optional() });

export const GET = v1Route(
  { host: "tenant", access: { capability: "ALERTS" }, query: Query, response: AlertsResponse },
  (ctx) => alertsFor(ctx.actor, ctx.query.cursor, ctx.receivedAt),
);
