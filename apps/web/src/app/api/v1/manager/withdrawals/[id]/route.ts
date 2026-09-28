// GET /api/v1/manager/withdrawals/:id — one withdrawal. WITHDRAWALS; the
// caller's own is 403 SELF_APPROVAL, another company's 404.
import { ManagedWithdrawalResponse } from "@bookmops/api/v1";

import { withdrawalFor } from "@/server/manager/withdrawals";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route(
  { host: "tenant", access: { capability: "WITHDRAWALS" }, response: ManagedWithdrawalResponse },
  (ctx) => withdrawalFor(ctx.actor, pathId(ctx.params.id)),
);
