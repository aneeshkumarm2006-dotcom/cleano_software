// POST /api/v1/manager/withdrawals/:id/decision — APPROVE, COMPLETE ("Mark
// paid") or REJECT (packages/api/src/v1/manager-approvals.ts).
//
// WITHDRAWALS. Idempotent on clientEventId; 60 an hour. One conditional
// update on the from-states under the person's withdrawal lock
// (server/manager/withdrawals.ts); zero rows is 409 WITHDRAWAL_STATE and no
// email. The caller's own is 403 SELF_APPROVAL.
import { ManagedWithdrawal, WithdrawalDecisionRequest } from "@bookmops/api/v1";

import { revalidateAfterWithdrawalDecision } from "@/server/manager/revalidate";
import { decideWithdrawalFor, WITHDRAWAL_DECISION_LIMIT } from "@/server/manager/withdrawals";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const POST = v1Route(
  {
    host: "tenant",
    access: { capability: "WITHDRAWALS" },
    body: WithdrawalDecisionRequest,
    response: ManagedWithdrawal,
    idempotent: true,
    limit: WITHDRAWAL_DECISION_LIMIT,
  },
  async (ctx) => {
    const res = await decideWithdrawalFor(
      ctx.actor,
      pathId(ctx.params.id),
      { action: ctx.body.action, paymentMethod: ctx.body.paymentMethod },
      ctx.receivedAt,
    );
    if (res.ok) revalidateAfterWithdrawalDecision();
    return res;
  },
);
