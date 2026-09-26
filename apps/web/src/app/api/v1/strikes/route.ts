// GET /api/v1/strikes — the caller's standing and strike history. Never the
// admin's note, who applied or excused a strike, or anything about a client.
import { StrikesResponse } from "@bookmops/api/v1";

import { myStrikesFor } from "@/server/strikes/strikes";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route({ host: "tenant", access: "staff", response: StrikesResponse }, (ctx) =>
  myStrikesFor(ctx.actor, ctx.receivedAt),
);
