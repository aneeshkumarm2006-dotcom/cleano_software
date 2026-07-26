// Quebec sales tax breakdown. GST is federal (5%), QST is provincial (9.975%).
// Combined effective rate on a pre-tax subtotal is 14.975%.

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

export const DEFAULT_TAX_RATES: TaxRates = {
  gstRate: GST_RATE * 100,
  qstRate: QST_RATE * 100,
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

export function calculateTax(subtotal: number): TaxBreakdown {
  const sub = Math.max(0, subtotal);
  const gstAmount = round2(sub * GST_RATE);
  const qstAmount = round2(sub * QST_RATE);
  const total = round2(sub + gstAmount + qstAmount);
  return {
    subtotal: round2(sub),
    gstAmount,
    qstAmount,
    total,
  };
}
