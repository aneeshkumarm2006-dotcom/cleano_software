// POST /api/v1/manager/chat/conversations/:cleanerId/read — the office has
// read this correspondent's messages (readByAdminAt, fixed by this route).
// OFFICE_INBOX. Idempotent by nature. :cleanerId as for GET, else 404.
import { ManagerMarkReadResponse } from "@bookmops/api/v1";

import { markConversationReadFor } from "@/server/manager/office-inbox";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const POST = v1Route(
  { host: "tenant", access: { capability: "OFFICE_INBOX" }, response: ManagerMarkReadResponse },
  (ctx) => markConversationReadFor(ctx.actor, pathId(ctx.params.cleanerId), ctx.receivedAt),
);
