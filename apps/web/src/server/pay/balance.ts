// A cleaner's withdrawable balance: THE one definition (packages/api/src/v1/pay.ts).
//
//   PAID payouts, each through computePayoutTotals (clamped, so a legacy
//   negative payout can't shrink it), summed by summarisePayouts
//   minus the stored amount of every PENDING, APPROVED and COMPLETED withdrawal
//
// This is the definition requestWithdrawal has always checked against. The My
// pay page used to compute its own copy (earnings.walletBalance minus a float
// sum it made itself, clamped at zero) while the action used this one, and
// the modal compared the amount ASKED FOR against the page's figure while the
// action compared the NET against its own. Now the page, the web action,
// GET /api/v1/pay and POST /api/v1/pay/withdrawals all read this function, in
// integer cents.
import "server-only";

import { summarisePayouts } from "@bookmops/core/pay";

import type { ScopedTx } from "@/lib/db-scoped";
import { db } from "@/lib/org-db";
import { toCents } from "@/lib/withdrawal-rules";

/** Withdrawal states that hold money: everything except REJECTED. */
export const RESERVING_WITHDRAWAL_STATUSES = ["PENDING", "APPROVED", "COMPLETED"] as const;

export interface Balance {
  /** PAID payouts, clamped per row. */
  paidCents: number;
  /** Every withdrawal that isn't REJECTED, at its stored (net) amount. */
  reservedCents: number;
  /** paid − reserved. Can be negative on legacy data; see `availableCents`. */
  rawCents: number;
  /** What may be withdrawn now: never below zero. */
  availableCents: number;
}

/**
 * The balance of `employeeId`, read through `client` (the scoped db, or a
 * transaction's client so the read sits under the caller's lock).
 * Callers are responsible for authorization: `employeeId` is always the
 * session's own person, never a value from a request.
 */
export async function readBalance(employeeId: string, client: ScopedTx = db): Promise<Balance> {
  const [payouts, withdrawals] = await Promise.all([
    client.payout.findMany({
      where: { employeeId, payPeriod: { status: "PAID" } },
      select: { baseAmount: true, adjustments: true, deductions: true, reimbursements: true },
    }),
    client.withdrawal.findMany({
      where: { employeeId, status: { in: [...RESERVING_WITHDRAWAL_STATUSES] } },
      select: { amount: true },
    }),
  ]);
  const paidCents = toCents(summarisePayouts(payouts).totalFinal);
  // Each stored amount is converted once, then summed as integers: no float
  // drift across many withdrawals.
  const reservedCents = withdrawals.reduce((sum, w) => sum + toCents(w.amount), 0);
  const rawCents = paidCents - reservedCents;
  return { paidCents, reservedCents, rawCents, availableCents: Math.max(0, rawCents) };
}
