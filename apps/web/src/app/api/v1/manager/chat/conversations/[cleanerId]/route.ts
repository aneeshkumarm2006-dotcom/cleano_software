// GET /api/v1/manager/chat/conversations/:cleanerId — one conversation.
// OFFICE_INBOX. :cleanerId must be a correspondent of this company, else 404.
import { OfficeConversationResponse } from "@bookmops/api/v1";

import { officeConversationFor } from "@/server/manager/office-inbox";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route(
  { host: "tenant", access: { capability: "OFFICE_INBOX" }, response: OfficeConversationResponse },
  (ctx) => officeConversationFor(ctx.actor, pathId(ctx.params.cleanerId), ctx.receivedAt),
);
