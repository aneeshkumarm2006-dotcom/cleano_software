// POST /api/v1/team/direct — open (or create) the direct conversation with
// another active staff member of the caller's company. One per pair, so a
// double tap or a retry opens the same one; that is what makes it safe
// without an idempotency key. Off → 403; yourself → 400; anyone not found
// here (another company included) → 404.
import { OpenDirectRequest, OpenDirectResponse } from "@bookmops/api/v1";

import { openDirectChannel } from "@/server/messages/team-chat";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const POST = v1Route(
  {
    host: "tenant",
    access: "anyStaff",
    body: OpenDirectRequest,
    response: OpenDirectResponse,
    limit: { name: "team-direct-open", max: 30, windowMs: 60_000 },
  },
  (ctx) => openDirectChannel(ctx.actor, ctx.body.userId),
);
