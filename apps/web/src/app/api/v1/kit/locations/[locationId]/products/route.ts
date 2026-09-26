// GET /api/v1/kit/locations/:locationId/products — every active product,
// with what this location has on record. An inactive location is 404.
import { KitLocationProductsResponse } from "@bookmops/api/v1";

import { locationProducts } from "@/server/kit/kit";
import { ok } from "@/server/result";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route({ host: "tenant", access: "staff", response: KitLocationProductsResponse }, async (ctx) => {
  const res = await locationProducts(pathId(ctx.params.locationId));
  if (!res.ok) return res;
  return ok({
    location: res.value.location,
    items: res.value.items.map((p) => ({
      productId: p.productId,
      name: p.name,
      description: p.description,
      unit: p.unit,
      available: p.available,
    })),
  });
});
