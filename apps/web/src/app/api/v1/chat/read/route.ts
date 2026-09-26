// POST /api/v1/chat/read — mark the office's messages in the caller's own
// conversation read. No body; idempotent by nature.
import { MarkReadResponse } from "@bookmops/api/v1";

import { markOfficeRead } from "@/server/messages/office-chat";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const POST = v1Route({ host: "tenant", access: "staff", response: MarkReadResponse }, (ctx) =>
  markOfficeRead(ctx.actor, ctx.receivedAt),
);
