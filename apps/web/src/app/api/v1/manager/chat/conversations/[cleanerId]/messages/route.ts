// GET  /api/v1/manager/chat/conversations/:cleanerId/messages?cursor= — the
//      conversation, newest first, from the office's side. Marks nothing read.
// POST /api/v1/manager/chat/conversations/:cleanerId/messages — reply AS THE
//      OFFICE: senderRole ADMIN and the caller as sender, fixed here, never
//      from the request or the caller's role. Idempotent on clientEventId;
//      10 a minute; the email to an away correspondent is an effect.
//
// OFFICE_INBOX. :cleanerId must be a correspondent of this company, else 404.
import { ManagerMessagesResponse, SendManagerMessageResponse, SendMessageRequest } from "@bookmops/api/v1";
import { z } from "zod";

import { OFFICE_REPLY_LIMIT, officeMessagesFor, replyAsOffice } from "@/server/manager/office-inbox";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

const Query = z.object({ cursor: z.string().max(512).optional() });

export const GET = v1Route(
  { host: "tenant", access: { capability: "OFFICE_INBOX" }, query: Query, response: ManagerMessagesResponse },
  (ctx) => officeMessagesFor(ctx.actor, pathId(ctx.params.cleanerId), ctx.query.cursor),
);

export const POST = v1Route(
  {
    host: "tenant",
    access: { capability: "OFFICE_INBOX" },
    body: SendMessageRequest,
    response: SendManagerMessageResponse,
    idempotent: true,
    limit: OFFICE_REPLY_LIMIT,
  },
  (ctx) =>
    replyAsOffice(ctx.actor, pathId(ctx.params.cleanerId), {
      body: ctx.body.body,
      clientEventId: ctx.body.clientEventId,
      now: ctx.receivedAt,
    }),
);
