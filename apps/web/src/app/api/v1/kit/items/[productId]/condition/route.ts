// PUT /api/v1/kit/items/:productId/condition — how one of the caller's tools
// is. Tools only (409 NOT_EQUIPMENT). Moves no stock. Idempotent.
import { KitConditionRequest, KitItem } from "@bookmops/api/v1";

import { kitItem, setKitCondition } from "@/server/kit/kit";
import { revalidateAfterKitChange } from "@/server/kit/revalidate";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const PUT = v1Route(
  { host: "tenant", access: "staff", body: KitConditionRequest, response: KitItem, idempotent: true },
  async (ctx) => {
    const productId = pathId(ctx.params.productId);
    const res = await setKitCondition(ctx.actor, {
      productId,
      condition: ctx.body.condition,
      note: ctx.body.note ?? null,
      now: ctx.receivedAt,
    });
    if (!res.ok) return res;
    revalidateAfterKitChange();
    return kitItem(ctx.actor, productId);
  },
);
