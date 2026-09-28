// DELETE /api/v1/manager/team/channels/:channelId/messages/:messageId —
// remove anyone's team chat message (packages/api/src/v1/manager-messages.ts).
//
// TEAM_MODERATE (OWNER, ADMIN, OPS_MANAGER). The channel and the message must
// be this company's and the message in that channel, else 404. Soft: sets
// deletedAt and deletedById; the original stays on the row, never served.
// Deleting one already deleted answers the same { id }.
import { ModerateTeamMessageResponse } from "@bookmops/api/v1";

import { moderateTeamMessage } from "@/server/messages/team-chat";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const DELETE = v1Route(
  { host: "tenant", access: { capability: "TEAM_MODERATE" }, response: ModerateTeamMessageResponse },
  (ctx) =>
    moderateTeamMessage(ctx.actor, pathId(ctx.params.channelId), pathId(ctx.params.messageId), ctx.receivedAt, "app"),
);
