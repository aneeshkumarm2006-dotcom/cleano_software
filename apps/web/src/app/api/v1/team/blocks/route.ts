// GET /api/v1/team/blocks — the people the caller has blocked in team chat.
import { BlocksResponse } from "@bookmops/api/v1";

import { listBlocks } from "@/server/messages/blocks";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route({ host: "tenant", access: "anyStaff", response: BlocksResponse }, (ctx) =>
  listBlocks(ctx.actor),
);
