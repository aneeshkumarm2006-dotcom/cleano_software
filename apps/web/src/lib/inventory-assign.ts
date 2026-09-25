// Quantity semantics for admin inventory assignment (awer_fixes.pdf items 6 + 13).
//
// PURE (no DB imports) so the rule can be unit-tested and so the server action
// and any future UI preview can never disagree about what a typed number means.
//
// The whole point of having two modes is that the SAME number means different
// things, and conflating them is how stock records start lying:
//
//   FROM_LOCKER    the number is an AMOUNT TO HAND OVER.
//                  cleaner: before + entered.  company stock: -entered.
//
//   MANUAL_ADJUST  the number is the cleaner's NEW ABSOLUTE COUNT.
//                  cleaner: entered.           company stock: unchanged.

export type AssignMode = "FROM_LOCKER" | "MANUAL_ADJUST";

export interface AssignResolution {
  /** The cleaner's kit quantity after the save. */
  after: number;
  /** Signed change to the cleaner's kit — always derived, never typed in. */
  delta: number;
  /** Signed change to company stock. Zero in MANUAL_ADJUST. */
  companyDelta: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function resolveAssignedQuantity(
  mode: AssignMode,
  before: number,
  entered: number
): AssignResolution {
  const b = Number.isFinite(before) ? before : 0;
  const e = Number.isFinite(entered) ? entered : 0;

  if (mode === "FROM_LOCKER") {
    const after = round2(b + e);
    return { after, delta: round2(after - b), companyDelta: round2(-e) };
  }

  const after = round2(e);
  return { after, delta: round2(after - b), companyDelta: 0 };
}
