// GET /manager/approvals/summary: how many wait in each queue the caller can
// act on (packages/api/src/v1/manager-approvals.ts). A queue the role can't
// act on is null, not 0. Each count leaves out the caller's own items, as the
// lists do (manager-access.ts rule 9).
import "server-only";

import { can, type ApprovalsSummaryResponse } from "@bookmops/api/v1";

import type { Actor } from "../actor";
import { failure, ok, type Result } from "../result";
import { pendingKitCount } from "./kit-requests";
import { pendingTimeCount } from "./time";
import { openWithdrawalCount } from "./withdrawals";

export async function approvalsSummaryFor(actor: Actor): Promise<Result<ApprovalsSummaryResponse>> {
  const time = can(actor.role, "TIME_APPROVE");
  const withdrawals = can(actor.role, "WITHDRAWALS");
  const kit = can(actor.role, "KIT_REQUESTS");
  if (!time && !withdrawals && !kit) return failure(403, "FORBIDDEN", "Your role can't do this.");
  const [t, w, k] = await Promise.all([
    time ? pendingTimeCount(actor) : null,
    withdrawals ? openWithdrawalCount(actor) : null,
    kit ? pendingKitCount(actor) : null,
  ]);
  return ok({ time: t, withdrawals: w, kit: k });
}
