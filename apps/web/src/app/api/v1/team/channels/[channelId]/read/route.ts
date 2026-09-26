// POST /api/v1/team/channels/:channelId/read — move the caller's own read
// cursor to now. No body; idempotent by nature.
import { MarkChannelReadResponse } from "@bookmops/api/v1";

import { markTeamChannelRead } from "@/server/messages/team-chat";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const POST = v1Route({ host: "tenant", access: "anyStaff", response: MarkChannelReadResponse }, (ctx) =>
  markTeamChannelRead(ctx.actor, pathId(ctx.params.channelId), ctx.receivedAt),
);
