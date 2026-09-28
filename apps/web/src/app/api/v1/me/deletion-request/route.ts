// GET  /api/v1/me/deletion-request — whether the caller's request to delete
//      their account is waiting for the office.
// POST /api/v1/me/deletion-request — ask the company to delete the account
//      (App Store guideline 5.1.1(v)). Records it and tells the office; deletes
//      nothing. Idempotent on the clientEventId, and one open request per
//      person whatever the key.
import { DeletionRequestBody, DeletionRequestResponse, DeletionRequestState } from "@bookmops/api/v1";

import { deletionRequestFor, requestAccountDeletion } from "@/server/account/deletion";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route({ host: "tenant", access: "anyStaff", response: DeletionRequestState }, (ctx) =>
  deletionRequestFor(ctx.actor),
);

export const POST = v1Route(
  {
    host: "tenant",
    access: "anyStaff",
    body: DeletionRequestBody,
    response: DeletionRequestResponse,
    idempotent: true,
    // Each new request emails the owners; asking again while one is open
    // sends nothing, so this only bounds a loop.
    limit: { name: "deletion-request", max: 5, windowMs: 60 * 60_000 },
  },
  (ctx) =>
    requestAccountDeletion(ctx.actor, {
      reason: ctx.body.reason,
      clientEventId: ctx.body.clientEventId,
      now: ctx.receivedAt,
    }),
);
