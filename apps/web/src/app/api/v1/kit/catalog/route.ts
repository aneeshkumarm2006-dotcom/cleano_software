// GET /api/v1/kit/catalog — active products not already in the caller's kit.
import { KitCatalogResponse } from "@bookmops/api/v1";

import { kitCatalog } from "@/server/kit/kit";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route({ host: "tenant", access: "staff", response: KitCatalogResponse }, (ctx) =>
  kitCatalog(ctx.actor),
);
