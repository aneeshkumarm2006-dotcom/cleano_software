// GET  /api/v1/chat/messages?cursor= — the caller's own conversation with the
//      office, newest first, keyset-paged.
// POST /api/v1/chat/messages — send to the office. Idempotent on the
//      clientEventId. Posted as EMPLOYEE whatever the caller's role (a
//      FIELD_LEAD included; security batch 2). The email to the office when
//      nobody is online is an effect: after the response, never on a replay.
import { OfficeMessagesResponse, SendMessageRequest, SendOfficeMessageResponse } from "@bookmops/api/v1";
import { z } from "zod";

import { OFFICE_CHAT_SEND_LIMIT } from "@/server/messages/limits";
import { listOfficeMessages, sendOfficeMessage } from "@/server/messages/office-chat";
import { ok } from "@/server/result";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

const CursorQuery = z.object({ cursor: z.string().max(512).optional() });

export const GET = v1Route(
  { host: "tenant", access: "staff", query: CursorQuery, response: OfficeMessagesResponse },
  (ctx) => listOfficeMessages(ctx.actor, ctx.query.cursor),
);

export const POST = v1Route(
  {
    host: "tenant",
    access: "staff",
    body: SendMessageRequest,
    response: SendOfficeMessageResponse,
    idempotent: true,
    limit: OFFICE_CHAT_SEND_LIMIT,
  },
  async (ctx) => {
    const res = await sendOfficeMessage(ctx.actor, {
      body: ctx.body.body,
      clientEventId: ctx.body.clientEventId,
      now: ctx.receivedAt,
    });
    if (!res.ok) return res;
    return ok(res.value.message, res.effects);
  },
);
