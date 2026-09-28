// GET  /api/v1/pay/withdrawals?cursor=… — the caller's requests, newest first.
// POST /api/v1/pay/withdrawals          — ask for a withdrawal.
//
// The POST moves money, so: idempotent on the body's clientEventId, 5 an hour
// per person, and every rule in server/pay/withdraw.ts — the balance re-read
// under a per-person lock in the same transaction as the insert, the check on
// the amount asked for, the fee from the server's rate (409 FEE_CHANGED when
// it isn't the one the person agreed to), the net recorded. The emails are
// effects, sent after the commit and never for a replay.
import { WithdrawalRequest, WithdrawalResponse, WithdrawalsResponse } from "@bookmops/api/v1";
import { z } from "zod";

import { revalidateAfterWithdrawal } from "@/server/pay/revalidate";
import { withdrawalsFor } from "@/server/pay/summary";
import { requestWithdrawalService } from "@/server/pay/withdraw";
import { ok } from "@/server/result";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

const PageQuery = z.object({ cursor: z.string().max(512).optional() });

/** Each request emails the cleaner and the office (API_V1.md §4). */
const WITHDRAWAL_LIMIT = { name: "withdrawal", max: 5, windowMs: 60 * 60_000, shared: true };

export const GET = v1Route(
  { host: "tenant", access: "staff", query: PageQuery, response: WithdrawalsResponse },
  (ctx) => withdrawalsFor(ctx.actor, ctx.query.cursor),
);

export const POST = v1Route(
  {
    host: "tenant",
    access: "staff",
    body: WithdrawalRequest,
    response: WithdrawalResponse,
    idempotent: true,
    limit: WITHDRAWAL_LIMIT,
  },
  async (ctx) => {
    const result = await requestWithdrawalService(ctx.actor, {
      amountCents: ctx.body.amountCents,
      expectedFeeBasisPoints: ctx.body.expectedFeeBasisPoints,
      note: ctx.body.note ?? null,
      now: ctx.receivedAt,
    });
    if (!result.ok) return result;
    revalidateAfterWithdrawal();
    const w = result.value;
    return ok(
      {
        withdrawal: {
          id: w.id,
          amountCents: w.amountCents,
          feeCents: w.feeCents,
          netCents: w.netCents,
          status: w.status,
          requestedAt: w.requestedAt.toISOString(),
          processedAt: null,
          note: w.note,
        },
        availableCents: w.availableCents,
      },
      result.effects,
    );
  },
);
