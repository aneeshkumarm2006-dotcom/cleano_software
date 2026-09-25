// Sales tax breakdown.
//
// The constants below are QUEBEC's statutory rates and are the SEED for a new
// workspace, not the rule. Every workspace sets its own in Settings → Taxes,
// and `getTaxRates()` in tax.server.ts reads them per tenant.
//
// Sept 17 list, item 7: "Calgary booking page shows GST 5% and QST 9.975% even
// though QST is set to 0 in Calgary settings." The public booking page and
// `computeBookingPrice` both called `calculateTax()`, which read these
// constants and nothing else, so an Alberta customer was quoted AND CHARGED
// Quebec provincial tax. That is why `calculateTax` now REQUIRES its rates:
// there is no longer a way to call it and silently get Quebec's.

export const GST_RATE = 0.05;
export const QST_RATE = 0.09975;
export const COMBINED_RATE = GST_RATE + QST_RATE;

export interface TaxBreakdown {
  subtotal: number;
  gstAmount: number;
  qstAmount: number;
  total: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** GST/QST as PERCENTAGES (5 / 9.975), matching how `tax.config` stores them. */
export interface TaxRates {
  gstRate: number;
  qstRate: number;
}

// Written out rather than derived. `QST_RATE * 100` is 9.975000000000001 in
// binary floating point, and this value is the fallback that lands in the
// admin's rate FIELD when a workspace has never saved its tax settings — so
// the derived form put a 17-digit number in front of someone to edit.
export const DEFAULT_TAX_RATES: TaxRates = {
  gstRate: 5,
  qstRate: 9.975,
};

/**
 * Is this job exempt from sales tax?
 *
 * Two independent reasons, deliberately kept separate (awer_fixes.pdf item 7):
 *   • `isCashJob`  — a PAYMENT METHOD that happens to be untaxed;
 *   • `taxExempt`  — an explicit per-job tax status set by an admin.
 *
 * A job can be card-paid AND tax-exempt, so this is an OR, not a rename of the
 * cash flag. Lives here (client-safe) rather than in tax.server so display code
 * decides "taxes included or excluded" with exactly the rule the money math uses.
 */
export function isJobTaxExempt(job: {
  isCashJob?: boolean | null;
  taxExempt?: boolean | null;
}): boolean {
  return !!job.isCashJob || !!job.taxExempt;
}

/** Why a job is untaxed — drives the label shown to admins. */
export function taxExemptReason(job: {
  isCashJob?: boolean | null;
  taxExempt?: boolean | null;
}): "CASH" | "EXEMPT" | null {
  if (job.taxExempt) return "EXEMPT";
  if (job.isCashJob) return "CASH";
  return null;
}

/**
 * GST/QST breakdown on a pre-tax subtotal (price − discount). Exempt jobs get
 * zero tax and total = subtotal.
 *
 * NOTE: cleaner pay never comes from here — it is calculated from the pre-tax
 * job price, so exempting a job cannot change what a cleaner earns.
 */
export function computeJobTaxes(
  subtotal: number,
  rates: TaxRates,
  exempt: boolean
): {
  subtotalAmount: number;
  gstAmount: number;
  qstAmount: number;
  totalAmount: number;
} {
  const sub = round2(Math.max(0, subtotal));
  if (exempt) {
    return { subtotalAmount: sub, gstAmount: 0, qstAmount: 0, totalAmount: sub };
  }
  const gstAmount = round2((sub * rates.gstRate) / 100);
  const qstAmount = round2((sub * rates.qstRate) / 100);
  return {
    subtotalAmount: sub,
    gstAmount,
    qstAmount,
    totalAmount: round2(sub + gstAmount + qstAmount),
  };
}

/**
 * GST/QST on a pre-tax subtotal, at THIS workspace's rates.
 *
 * `rates` is required rather than defaulted. A default would have kept the
 * exact bug this was changed for: every call site that forgot to pass one
 * would go on charging Quebec's rates, and it would look correct in Montreal.
 * Making it required turns each of those into a compile error instead.
 *
 * Delegates to `computeJobTaxes` so a booking and the job it becomes round the
 * same way. They used to be two implementations of the same arithmetic.
 */
export function calculateTax(subtotal: number, rates: TaxRates): TaxBreakdown {
  const t = computeJobTaxes(subtotal, rates, false);
  return {
    subtotal: t.subtotalAmount,
    gstAmount: t.gstAmount,
    qstAmount: t.qstAmount,
    total: t.totalAmount,
  };
}

/** One tax row as a customer should see it. */
export interface TaxLine {
  key: "GST" | "QST";
  /** "GST (5%)" — the rate is part of the label because it varies by workspace. */
  label: string;
  amount: number;
}

/** "5" / "9.975" / "0" — no trailing zeros, because a label reads better. */
function formatRate(pct: number): string {
  return String(Math.round(pct * 1000) / 1000);
}

/**
 * The tax rows to SHOW, for this workspace's rates.
 *
 * A rate of zero produces no row at all, which is the PDF's rule outright: "if
 * QST rate is 0, QST should not appear in the customer price breakdown". A
 * "$0.00" line still tells an Alberta customer they are being assessed Quebec
 * provincial tax, which is the complaint.
 *
 * The percentage is read off the rates rather than written into the markup.
 * Every price breakdown in the app had "QST (9.975%)" typed into it as a
 * string, so even once the arithmetic was per-tenant the screen would have
 * gone on naming Quebec's rate.
 */
export function taxLines(
  rates: TaxRates,
  amounts: { gstAmount: number; qstAmount: number },
): TaxLine[] {
  const lines: TaxLine[] = [];
  if (rates.gstRate > 0) {
    lines.push({
      key: "GST",
      label: `GST (${formatRate(rates.gstRate)}%)`,
      amount: amounts.gstAmount,
    });
  }
  if (rates.qstRate > 0) {
    lines.push({
      key: "QST",
      label: `QST (${formatRate(rates.qstRate)}%)`,
      amount: amounts.qstAmount,
    });
  }
  return lines;
}

/**
 * A tax registration number as it should be PRINTED, or null when there isn't
 * one.
 *
 * CleanoCalgary has no QST, and whoever set the workspace up typed `0` into the
 * QST Number field to say so. `"0"` is a non-empty string, so every truthiness
 * check passed it through and their invoice header read `QST: 0`. Alberta has
 * no provincial sales tax at all, so that line should not exist.
 *
 * Treats "0", "n/a", "none" and whitespace as "there isn't one", because those
 * are what people actually type into a field they cannot leave blank.
 */
const NOT_A_NUMBER = new Set(["0", "00", "n/a", "na", "none", "-", "—"]);

export function taxRegistrationNumber(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (NOT_A_NUMBER.has(trimmed.toLowerCase())) return null;
  return trimmed;
}
