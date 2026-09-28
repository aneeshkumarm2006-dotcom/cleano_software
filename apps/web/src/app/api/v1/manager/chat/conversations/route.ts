// GET /api/v1/manager/chat/conversations?cursor= — every correspondent's
// conversation with the office (packages/api/src/v1/manager-messages.ts).
//
// OFFICE_INBOX (OWNER, ADMIN). Lists EMPLOYEE, FIELD_LEAD and OPS_MANAGER
// conversations, unread first. Not built on app/admin/chat/actions.ts.
import { OfficeConversationsResponse } from "@bookmops/api/v1";
import { z } from "zod";

import { officeConversationsFor } from "@/server/manager/office-inbox";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

const Query = z.object({ cursor: z.string().max(512).optional() });

export const GET = v1Route(
  { host: "tenant", access: { capability: "OFFICE_INBOX" }, query: Query, response: OfficeConversationsResponse },
  (ctx) => officeConversationsFor(ctx.actor, ctx.query.cursor, ctx.receivedAt),
);
