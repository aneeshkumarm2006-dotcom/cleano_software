// POST   /api/v1/team/blocks/:userId — block a person in team chat.
// DELETE /api/v1/team/blocks/:userId — unblock them.
// No body; both idempotent by nature. Staff of the caller's company only
// (else 404); never the caller (400). While blocked, their messages are left
// out of the caller's team chat and no direct message goes either way.
import { BlockResponse } from "@bookmops/api/v1";

import { blockPerson, unblockPerson } from "@/server/messages/blocks";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

const BLOCK_LIMIT = { name: "team-block", max: 30, windowMs: 60_000 };

export const POST = v1Route(
  { host: "tenant", access: "anyStaff", response: BlockResponse, limit: BLOCK_LIMIT },
  (ctx) => blockPerson(ctx.actor, pathId(ctx.params.userId)),
);

export const DELETE = v1Route(
  { host: "tenant", access: "anyStaff", response: BlockResponse, limit: BLOCK_LIMIT },
  (ctx) => unblockPerson(ctx.actor, pathId(ctx.params.userId)),
);
