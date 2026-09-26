// How much of a LOST/BROKEN report is a write-off, and against which stock.
// Pure, so the verify sweep can check it without a database (see ./issue.ts
// for where the totals come from and why).

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface CustodyTotals {
  /** ASSIGN + ADMIN_SET + IMPORT on the cleaner's rows: issued without moving warehouse stock. */
  issuedInPlace: number;
  /** PICKUP + REQUEST_FULFILLED on the cleaner's rows: already taken off a location when issued. */
  issuedOffStock: number;
  /** The warehouse side of this cleaner's past write-offs, as a positive number. */
  stockWrittenOff: number;
  /** `issuedWriteOff` summed over this cleaner's past ISSUE rows. */
  issuedWrittenOff: number;
}

export interface Custody {
  /** Issued without moving warehouse stock, and not yet written off. */
  inPlace: number;
  /** Issued off warehouse stock, and not yet written off. */
  offStock: number;
}

/** What the office put in this cleaner's hands and hasn't been written off. */
export function custodyLeft(t: CustodyTotals): Custody {
  const inPlace = t.issuedInPlace - t.stockWrittenOff;
  const offStock = t.issuedOffStock - t.issuedWrittenOff;
  // Legacy write-offs took pickup stock off the warehouse too, which can push
  // the first bucket below zero; the shortfall comes out of the second.
  const total = Math.max(0, round2(inPlace + offStock));
  const inPlaceLeft = Math.min(total, Math.max(0, round2(inPlace)));
  return { inPlace: inPlaceLeft, offStock: round2(total - inPlaceLeft) };
}

/**
 * Split a write-off of `qty`: first against stock issued in place (the
 * warehouse moves now), then against stock already off the warehouse (nothing
 * moves), and the rest is excess (the kit only, for the office to review).
 */
export function splitWriteOff(qty: number, custody: Custody): { fromStock: number; fromIssued: number; excess: number } {
  const fromStock = Math.max(0, Math.min(qty, custody.inPlace));
  const fromIssued = Math.max(0, Math.min(qty - fromStock, custody.offStock));
  return { fromStock, fromIssued, excess: round2(qty - fromStock - fromIssued) };
}
