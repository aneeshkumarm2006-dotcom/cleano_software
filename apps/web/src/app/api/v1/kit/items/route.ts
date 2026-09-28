// POST /api/v1/kit/items — an item the caller already has on hand. Creates
// their kit row only; company stock is untouched. Idempotent on the
// clientEventId. Already in the kit → 409 ALREADY_IN_KIT.
import { KitAddRequest, KitItem } from "@bookmops/api/v1";

import { addKitItem, kitItem } from "@/server/kit/kit";
import { revalidateAfterKitChange } from "@/server/kit/revalidate";
import { failure } from "@/server/result";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const POST = v1Route(
  { host: "tenant", access: "staff", body: KitAddRequest, response: KitItem, idempotent: true },
  async (ctx) => {
    const res = await addKitItem(ctx.actor, { productId: ctx.body.productId, quantity: ctx.body.quantity });
    if (!res.ok) {
      return res.code === "ALREADY_IN_KIT"
        ? failure(409, "ALREADY_IN_KIT", "Already in your kit — update the count instead")
        : res;
    }
    revalidateAfterKitChange();
    return kitItem(ctx.actor, res.value.productId);
  },
);
