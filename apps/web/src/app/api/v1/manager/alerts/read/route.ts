// POST /api/v1/manager/alerts/read — mark feed rows read for the caller only.
//
// ALERTS. Idempotent by nature (the unique notification/person read row);
// other companies' ids, unknown ids and, for a FIELD_LEAD, anything outside
// their feed are ignored. At most 200.
import { MarkAlertsReadRequest, MarkAlertsReadResponse } from "@bookmops/api/v1";

import { markAlertsReadFor } from "@/server/manager/alerts";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const POST = v1Route(
  { host: "tenant", access: { capability: "ALERTS" }, body: MarkAlertsReadRequest, response: MarkAlertsReadResponse },
  (ctx) => markAlertsReadFor(ctx.actor, ctx.body.ids, ctx.receivedAt),
);
