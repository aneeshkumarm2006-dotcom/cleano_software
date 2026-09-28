// PUT /api/v1/kit/items/:productId/count — a recount of the caller's own item.
// Idempotent on the clientEventId; the number already on record is a no-op.
import { KitCountRequest, KitItem } from "@bookmops/api/v1";

import { kitItem, setKitCount } from "@/server/kit/kit";
import { revalidateAfterKitChange } from "@/server/kit/revalidate";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const PUT = v1Route(
  { host: "tenant", access: "staff", body: KitCountRequest, response: KitItem, idempotent: true },
  async (ctx) => {
    const productId = pathId(ctx.params.productId);
    const res = await setKitCount(ctx.actor, { productId, quantity: ctx.body.quantity, reason: ctx.body.reason });
    if (!res.ok) return res;
    if (res.value.changed) revalidateAfterKitChange();
    return kitItem(ctx.actor, productId);
  },
);
