// GET /api/v1/team/channels/:channelId — one channel the caller can access.
// Not accessible, inactive, or not there: the same 404.
import { TeamChannelResponse } from "@bookmops/api/v1";

import { getTeamChannel } from "@/server/messages/team-chat";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route({ host: "tenant", access: "anyStaff", response: TeamChannelResponse }, (ctx) =>
  getTeamChannel(ctx.actor, pathId(ctx.params.channelId)),
);
