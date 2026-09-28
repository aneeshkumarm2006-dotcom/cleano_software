// GET /api/v1/manager/kit-requests?cursor= — pending restock requests, oldest
// first, never the caller's own. KIT_REQUESTS (OWNER, ADMIN).
import { KitRequestsResponse } from "@bookmops/api/v1";
import { z } from "zod";

import { listKitRequestsFor } from "@/server/manager/kit-requests";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

const Query = z.object({ cursor: z.string().max(512).optional() });

export const GET = v1Route(
  { host: "tenant", access: { capability: "KIT_REQUESTS" }, query: Query, response: KitRequestsResponse },
  (ctx) => listKitRequestsFor(ctx.actor, ctx.query.cursor),
);
