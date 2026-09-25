// Canonical payout total math (fix list item 1).
//
// A payroll period must never show a negative payout. Payroll pays money out;
// it is not a collection mechanism. When deductions exceed what a cleaner
// earned in the week (e.g. a $20 damage deduction landing on a week with $0 of
// completed jobs), the old formula
//
//     finalAmount = base + adjustments - deductions + reimbursements
//
// produced a negative row — two of them, at -$20 each, are what the client saw
// as the "-$40.00" Mar 31 - Apr 14 draft period.
//
// The rule now: the PAYOUT is floored at $0, and the un-recovered remainder is
// surfaced to the admin as a `shortfall` rather than silently swallowed. The
// admin can then carry it to the next period, write it off, or fix the
// deduction — all decisions payroll shouldn't be making on its own.
//
// This module is PURE (no DB / server imports) so the server action that writes
// the value and the editor that previews it can never drift.

export interface PayoutParts {
  baseAmount: number;
  adjustments: number;
  deductions: number;
  reimbursements: number;
}

export interface PayoutTotals {
  /** The raw arithmetic result. May be negative — kept for admin review. */
  raw: number;
  /** What is actually paid. Never below zero. */
  final: number;
  /**
   * How much of the deductions could NOT be recovered from this period,
   * i.e. `-raw` when raw is negative. Zero on a normal payout.
   */
  shortfall: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function num(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

/** THE payout total calculation. Every caller must use this. */
export function computePayoutTotals(parts: PayoutParts): PayoutTotals {
  const raw = round2(
    num(parts.baseAmount) +
      num(parts.adjustments) -
      num(parts.deductions) +
      num(parts.reimbursements)
  );
  return {
    raw,
    final: round2(Math.max(0, raw)),
    shortfall: raw < 0 ? round2(-raw) : 0,
  };
}

/**
 * Period-level rollup. Sums the CLAMPED payouts (so a period total can never be
 * dragged negative by one row) and reports how many rows were floored, so the
 * period can warn before it is approved or paid.
 */
export function summarisePayouts(rows: PayoutParts[]): {
  totalFinal: number;
  totalShortfall: number;
  shortfallCount: number;
} {
  let totalFinal = 0;
  let totalShortfall = 0;
  let shortfallCount = 0;
  for (const row of rows) {
    const t = computePayoutTotals(row);
    totalFinal += t.final;
    if (t.shortfall > 0) {
      totalShortfall += t.shortfall;
      shortfallCount += 1;
    }
  }
  return {
    totalFinal: round2(totalFinal),
    totalShortfall: round2(totalShortfall),
    shortfallCount,
  };
}
