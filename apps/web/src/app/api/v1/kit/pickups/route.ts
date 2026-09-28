// POST /api/v1/kit/pickups — "I took these from storage". Idempotent on the
// clientEventId, so a retry never adds the items twice. Short stock at the
// location warns, never refuses.
import { KitPickupRequest, KitPickupResponse } from "@bookmops/api/v1";

import { pickUp } from "@/server/kit/kit";
import { revalidateAfterPickup } from "@/server/kit/revalidate";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const POST = v1Route(
  { host: "tenant", access: "staff", body: KitPickupRequest, response: KitPickupResponse, idempotent: true },
  async (ctx) => {
    const res = await pickUp(ctx.actor, {
      locationId: ctx.body.locationId,
      items: ctx.body.items,
      note: ctx.body.note ?? null,
    });
    if (res.ok) revalidateAfterPickup();
    return res;
  },
);
