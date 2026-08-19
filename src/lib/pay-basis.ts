// WHICH RULE paid this cleaner (AWER round 4, fix 5).
//
// The PDF's last bullet on fix 5 asks the UI to "state which basis is in use
// (hourly / percentage / manual)". Before this, the admin job page and the pay
// modal each inferred it from `employeePayIsManual` — a flag that can only say
// manual-or-not — so an HOURLY job settled from the clock and a tier-rate job
// both read "automatic (tier rates)". The first of those is the one the client
// could not get to stick, and the label was covering for it.
//
// `computeJobPayShares` now decides the basis while it decides the amount and
// returns both on the share, so every surface prints the same reason next to
// the same figure. This module holds the VOCABULARY.
//
// PURE — no DB, no framework, no imports. `cleaner-earnings.ts` reaches
// `@/db`, so a client component cannot import the labels from there; three of
// them need to (the Financials tab, the pay modal, the cleaner's job list).

/** The rules `computeJobPayShares` can settle a cleaner's `base` by. */
export type PayBasisKind =
  /** JobAssignment.payAmount — an amount promised to THIS cleaner. */
  | "MANUAL_CLEANER"
  /** employeePayIsManual — a team total the admin (or the CSV) stated. */
  | "MANUAL_TEAM"
  /** HOURLY, settled from the clock: this cleaner's own sessions × the rate. */
  | "HOURLY_CLOCK"
  /** HOURLY, not clocked yet: the save-time estimate, split evenly. */
  | "HOURLY_ESTIMATE"
  /** FLAT: the agreed team total, split evenly. */
  | "FLAT"
  /** PERCENTAGE: the cleaner's tier rate on the job's pay basis. */
  | "PERCENTAGE"
  /** PERCENTAGE with no basis at all — a recorded amount, split evenly. */
  | "LEGACY";

/** Two or three words, for a pill or a chip. */
export const PAY_BASIS_SHORT_LABEL: Record<PayBasisKind, string> = {
  MANUAL_CLEANER: "Manual (this cleaner)",
  MANUAL_TEAM: "Manual amount",
  HOURLY_CLOCK: "Hourly — clocked",
  HOURLY_ESTIMATE: "Hourly — estimate",
  FLAT: "Flat rate",
  PERCENTAGE: "Automatic (tier rates)",
  LEGACY: "Recorded amount",
};

/**
 * The full sentence, with the arithmetic in it where there is any:
 * "Hourly — 3.5h clocked × $25.00/h".
 *
 * One function, so no two screens word the same rule differently.
 */
export function payBasisLabel(
  basis: PayBasisKind,
  detail: { hours?: number; rate?: number } = {}
): string {
  switch (basis) {
    case "MANUAL_CLEANER":
      return "Manual — amount set for this cleaner";
    case "MANUAL_TEAM":
      return "Manual — team total, split evenly";
    case "HOURLY_CLOCK":
      return `Hourly — ${formatPayHours(detail.hours ?? 0)} clocked × $${(
        detail.rate ?? 0
      ).toFixed(2)}/h`;
    case "HOURLY_ESTIMATE":
      return "Hourly — estimated from the scheduled hours, not clocked yet";
    case "FLAT":
      return "Flat — team total, split evenly";
    case "PERCENTAGE":
      return "Percentage — tier rate on the job's value";
    case "LEGACY":
      return "Recorded amount — split evenly";
  }
}

/** "3.5h" / "6h" — trailing zeros trimmed, so 6.00 never prints as "6.00h". */
function formatPayHours(hours: number): string {
  const n = Number(hours);
  if (!Number.isFinite(n)) return "0h";
  return `${String(Math.round(n * 100) / 100)}h`;
}
