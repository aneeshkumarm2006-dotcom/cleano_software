// GET /api/v1/chat — the caller's conversation with the office: is the office
// online, and how many of its messages are unread. Always the caller's own
// conversation (no id is taken); reading this marks nothing read.
import { OfficeChatResponse } from "@bookmops/api/v1";

import { officeChatSummary } from "@/server/messages/office-chat";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route({ host: "tenant", access: "staff", response: OfficeChatResponse }, (ctx) =>
  officeChatSummary(ctx.actor, ctx.receivedAt),
);
