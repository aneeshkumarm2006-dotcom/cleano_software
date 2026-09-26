// GET /api/v1/team/directory — the other active cleaners, to start a direct
// message with. Empty when direct messages are off; contact details only when
// the company shows them; the caller's company only.
import { DirectoryResponse } from "@bookmops/api/v1";

import { teamDirectory } from "@/server/messages/team-chat";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route({ host: "tenant", access: "anyStaff", response: DirectoryResponse }, (ctx) =>
  teamDirectory(ctx.actor),
);
