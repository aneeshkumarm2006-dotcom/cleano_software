// GET  /api/v1/team/channels/:channelId/messages?cursor= — newest first,
//      deleted messages included as placeholders. Moves no read cursor.
// POST /api/v1/team/channels/:channelId/messages — send. Idempotent on the
//      clientEventId. The sender is the session's, never the request's.
import { SendMessageRequest, SendTeamMessageResponse, TeamMessagesResponse } from "@bookmops/api/v1";
import { z } from "zod";

import { listTeamMessages, sendTeamMessage } from "@/server/messages/team-chat";
import { ok } from "@/server/result";
import { pathId, v1Route } from "@/server/v1/route";

import { TEAM_CHAT_SEND_LIMIT } from "@/server/messages/limits";

export const dynamic = "force-dynamic";

const CursorQuery = z.object({ cursor: z.string().max(512).optional() });

export const GET = v1Route(
  { host: "tenant", access: "anyStaff", query: CursorQuery, response: TeamMessagesResponse },
  (ctx) => listTeamMessages(ctx.actor, pathId(ctx.params.channelId), ctx.query.cursor),
);

export const POST = v1Route(
  {
    host: "tenant",
    access: "anyStaff",
    body: SendMessageRequest,
    response: SendTeamMessageResponse,
    idempotent: true,
    limit: TEAM_CHAT_SEND_LIMIT,
  },
  async (ctx) => {
    const res = await sendTeamMessage(ctx.actor, pathId(ctx.params.channelId), {
      body: ctx.body.body,
      clientEventId: ctx.body.clientEventId,
      now: ctx.receivedAt,
    });
    if (!res.ok) return res;
    return ok(res.value.message, res.effects);
  },
);
