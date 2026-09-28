// The rules for a cleaner's withdrawal request, in one place, in integer cents.
//
// Pure and client-safe on purpose: the web's WithdrawModal shows the fee from
// these numbers, the server charges it from the same numbers
// (server/pay/withdraw.ts), and GET /api/v1/pay hands them to the phone, so the
// fee a person is shown is the fee they are charged.
//
// The server never trusts a fee or a net amount from a client. The client
// sends what the person asked for and the rate it showed them; the server
// computes the fee itself and refuses when the rate it holds is not the one
// the person agreed to.

/** The instant-payout fee, in basis points: 500 is 5%. */
export const WITHDRAWAL_FEE_BASIS_POINTS = 500;

/**
 * The smallest request accepted, before the fee. One cent: the web has always
 * accepted any positive amount, and the net after the fee must still be at
 * least a cent (see withdrawalFeeCents).
 */
export const WITHDRAWAL_MINIMUM_CENTS = 1;

/** How long a payout takes, as the web's modal says it. */
export const WITHDRAWAL_TIMING = "Sent within 0–3 hours, during working hours.";

/**
 * The fee on `amountCents` at `basisPoints`, rounded half up to the cent:
 * round(amountCents × rate ÷ 10000), but never under 1 cent when both the
 * rate and the amount are above zero, so a tiny withdrawal can't be fee-free.
 * Integers in, integer out.
 */
export function withdrawalFeeCents(amountCents: number, basisPoints: number): number {
  if (amountCents <= 0 || basisPoints <= 0) return 0;
  return Math.max(1, Math.round((amountCents * basisPoints) / 10_000));
}

/**
 * What one withdrawal holds off the balance, in cents: the net that is paid
 * out PLUS the fee taken, i.e. the whole amount that was asked for. Rows made
 * before the fee was stored have feeAmount 0 and hold only their net.
 */
export function reservedCentsOf(row: {
  amount: number | null | undefined;
  feeAmount: number | null | undefined;
}): number {
  return toCents(row.amount) + toCents(row.feeAmount);
}

/** Withdrawal states that hold money: everything except REJECTED. */
export const RESERVING_WITHDRAWAL_STATUSES = ["PENDING", "APPROVED", "COMPLETED"] as const;

/** Dollars (as stored) to integer cents, once. */
export function toCents(dollars: number | null | undefined): number {
  const n = Number(dollars ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** "$12.34" from integer cents. */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
