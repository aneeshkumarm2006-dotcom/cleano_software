// POST /api/v1/kit/requests — ask the office to restock. Idempotent on the
// clientEventId; a product already pending from this caller is not asked for
// again (ALREADY_PENDING). A product listed twice is 400.
import { KitRestockRequest, KitRestockResponse } from "@bookmops/api/v1";

import { requestRestock } from "@/server/kit/kit";
import { revalidateAfterRestockRequest } from "@/server/kit/revalidate";
import { ok } from "@/server/result";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const POST = v1Route(
  {
    host: "tenant",
    access: "staff",
    body: KitRestockRequest,
    response: KitRestockResponse,
    idempotent: true,
    limit: { name: "kit-restock", max: 30, windowMs: 60 * 60_000 },
  },
  async (ctx) => {
    const res = await requestRestock(ctx.actor, {
      items: ctx.body.items,
      reason: ctx.body.note?.trim() || "Equipment request",
    });
    if (!res.ok) return res;
    if (res.value.results.some((r) => r.outcome === "CREATED")) revalidateAfterRestockRequest();
    return ok({ results: res.value.results.map((r) => ({ productId: r.productId, outcome: r.outcome })) });
  },
);
