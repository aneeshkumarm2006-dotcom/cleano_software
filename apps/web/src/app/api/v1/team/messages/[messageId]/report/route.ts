// POST /api/v1/team/messages/:messageId/report — report someone else's team
// chat message to the company's moderators (App Store guideline 1.2).
// Idempotent on the clientEventId, and one report per person per message
// whatever the key. Not the caller's own (400); not in a channel they can
// see (404).
import { ReportMessageRequest, ReportMessageResponse } from "@bookmops/api/v1";

import { reportTeamMessage } from "@/server/messages/reports";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

/** Each new report alerts the office; this bounds a flood from one person. */
const REPORT_LIMIT = { name: "team-report", max: 10, windowMs: 60 * 60_000, shared: true };

export const POST = v1Route(
  {
    host: "tenant",
    access: "anyStaff",
    body: ReportMessageRequest,
    response: ReportMessageResponse,
    idempotent: true,
    limit: REPORT_LIMIT,
  },
  (ctx) =>
    reportTeamMessage(ctx.actor, pathId(ctx.params.messageId), {
      reason: ctx.body.reason,
      note: ctx.body.note,
      clientEventId: ctx.body.clientEventId,
    }),
);
