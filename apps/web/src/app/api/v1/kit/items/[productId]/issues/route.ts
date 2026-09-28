// POST /api/v1/kit/items/:productId/issues — lost, broken, ran out, other.
// Idempotent on the clientEventId, so a retry never writes stock off twice.
// The kit comes down by a conditional decrement (409 NOT_ENOUGH_IN_KIT), and
// a write-off is capped at what the office issued (server/kit/issue.ts).
import { KitIssueRequest, KitItem } from "@bookmops/api/v1";

import { reportKitIssue } from "@/server/kit/issue";
import { kitItem } from "@/server/kit/kit";
import { revalidateAfterKitIssue } from "@/server/kit/revalidate";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

/** API_V1.md §4 names 10 an hour for the job issue report; a kit report is its sibling. */
const KIT_ISSUE_LIMIT = { name: "kit-issue", max: 30, windowMs: 60 * 60_000 };

export const POST = v1Route(
  { host: "tenant", access: "staff", body: KitIssueRequest, response: KitItem, idempotent: true, limit: KIT_ISSUE_LIMIT },
  async (ctx) => {
    const productId = pathId(ctx.params.productId);
    const res = await reportKitIssue(ctx.actor, {
      productId,
      type: ctx.body.type,
      quantity: ctx.body.quantity,
      note: ctx.body.note ?? null,
      now: ctx.receivedAt,
    });
    if (!res.ok) return res;
    revalidateAfterKitIssue();
    return kitItem(ctx.actor, productId);
  },
);
