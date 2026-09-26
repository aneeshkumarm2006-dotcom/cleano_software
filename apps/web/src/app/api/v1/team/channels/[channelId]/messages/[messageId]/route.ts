// PATCH  /api/v1/team/channels/:channelId/messages/:messageId — edit the
//        caller's OWN message. Idempotent on the clientEventId. Counts against
//        the team chat send limit.
// DELETE /api/v1/team/channels/:channelId/messages/:messageId — delete the
//        caller's OWN message (soft). A retry answers the same.
//
// Anyone else's message is 404, the same as one that doesn't exist, whatever
// the caller's role; removing someone else's is the manager API's.
import { DeleteTeamMessageResponse, EditTeamMessageRequest, EditTeamMessageResponse } from "@bookmops/api/v1";

import { deleteOwnTeamMessage, editTeamMessage } from "@/server/messages/team-chat";
import { pathId, v1Route } from "@/server/v1/route";

import { TEAM_CHAT_SEND_LIMIT } from "@/server/messages/limits";

export const dynamic = "force-dynamic";

export const PATCH = v1Route(
  {
    host: "tenant",
    access: "anyStaff",
    body: EditTeamMessageRequest,
    response: EditTeamMessageResponse,
    idempotent: true,
    limit: TEAM_CHAT_SEND_LIMIT,
  },
  (ctx) =>
    editTeamMessage(ctx.actor, pathId(ctx.params.channelId), pathId(ctx.params.messageId), {
      body: ctx.body.body,
      now: ctx.receivedAt,
    }),
);

export const DELETE = v1Route({ host: "tenant", access: "anyStaff", response: DeleteTeamMessageResponse }, (ctx) =>
  deleteOwnTeamMessage(ctx.actor, pathId(ctx.params.channelId), pathId(ctx.params.messageId), ctx.receivedAt),
);
