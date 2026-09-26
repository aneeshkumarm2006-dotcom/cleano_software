// GET /api/v1/kit — the caller's own kit, by name, with each item's attention
// state computed by the web's rule.
import { KitResponse } from "@bookmops/api/v1";

import { listKit } from "@/server/kit/kit";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route({ host: "tenant", access: "staff", response: KitResponse }, (ctx) => listKit(ctx.actor));
