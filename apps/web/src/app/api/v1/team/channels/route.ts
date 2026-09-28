// GET /api/v1/team/channels — the team channels the caller can access, and
// whether direct messages are on. Every staff role: crew see the default
// channel and their own; OWNER, ADMIN and OPS_MANAGER see every channel.
import { TeamChannelsResponse } from "@bookmops/api/v1";

import { listTeamChannels } from "@/server/messages/team-chat";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route({ host: "tenant", access: "anyStaff", response: TeamChannelsResponse }, (ctx) =>
  listTeamChannels(ctx.actor),
);
