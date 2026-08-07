import {
  computeJobTaxes,
  isJobTaxExempt,
  type TaxRates,
} from "./tax";

/**
 * THE money math for a job's add-ons. One helper, so the surfaces that print a
 * job's value cannot drift apart again.
 *
 * ## Why this exists: four consumers, four different beliefs
 *
 * Before this module, every surface that touched add-ons assumed something
 * different about where they lived:
 *
 *   saveJob.ts (writer)            add-ons are NOWHERE — taxed `price - discount`
 *   receipt-pdf.ts                 add-ons are INSIDE `subtotalAmount`
 *   getPayBreakdown.ts             add-ons are INSIDE `job.price`
 *   generateInvoiceFromJob.ts      add-ons are ON TOP OF `job.price`
 *
 * So an admin's $25 custom charge billed $0 (saveJob never added it) while the
 * invoice for the same job line-itemed it — invoice != job total, which is the
 * defect awerfixes.pdf item 10 names.
 *
 * ## The rule: the basis comes from `bookingSource`
 *
 * `Job.price` genuinely means two different things (see lib/job-billing.ts for
 * the full account), and `Job.subtotalAmount` follows it:
 *
 *   submitBooking (web)   subtotalAmount = basePrice + addOns + travel - discount
 *                         ...so add-ons AND the discount are already inside it.
 *   BookingKoala import   subtotalAmount = the CSV "Service total", which is
 *                         what BookingKoala actually billed — extras included.
 *   saveJob (admin)       subtotalAmount = price - discount, add-ons excluded.
 *
 * Hence two bases. INCLUSIVE sources have their add-ons already priced in, so
 * the stored subtotal is READ BACK UNCHANGED and the add-on rows are an
 * itemisation of it. ADDITIVE sources (every admin job) get
 * `base + sum(unit x qty) - discount` and tax on the result — which is what
 * finally makes a custom extra charge count.
 *
 * ## Two things this module must never do
 *
 * 1. **Never reconstruct an INCLUSIVE subtotal.** `base + addOnTotal` is
 *    algebraically `subtotalAmount`, but `computeBookingPrice` clamps its
 *    pre-tax figure at zero (booking-pricing.ts), so a large referral credit
 *    can make the identity false while add-ons are non-zero. Reading the stored
 *    column makes "no web booking changes value" true by construction rather
 *    than by argument.
 * 2. **Never subtract an INCLUSIVE discount.** It is already inside the stored
 *    subtotal; `Job.discountAmount` survives only for reporting. Subtracting it
 *    again is the exact defect job-billing.ts records as having taken ~$54 off
 *    a $25 credit, on every visit of a recurring series.
 *
 * ## Client-safe, deliberately
 *
 * This module imports ONLY from `./tax`. It must never reach for `@/db`,
 * `server-only`, `@/lib/stripe` or `@/lib/job-billing` — that last one is the
 * trap, since it pulls BOOKING_DEPOSIT_CENTS out of lib/stripe.ts, whose first
 * line is `import Stripe from "stripe"`. Three client components render from
 * here (JobModal's live total preview, JobDetailView's Financials tab, and the
 * /book steps), so a server-only import would break the build at the far end of
 * the app from wherever it was added. verify-awer-fixes-3.ts asserts this.
 */

/**
 * Ceiling on a single add-on's quantity. One constant for the /book stepper's
 * `max`, the admin modal's stepper, and the server-side clamps in both
 * submitBooking and saveJob — so the UI bound and the trust boundary can never
 * disagree.
 */
export const MAX_ADDON_QUANTITY = 20;

/** `tax.ts` keeps its own round2 private; job-billing.ts sets the precedent for copying it. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Where a job's add-ons sit relative to its stored subtotal.
 *
 * `LEGACY_PRICE` is not a source — it is the fallback an INCLUSIVE job takes
 * when it predates the tax columns being populated, and it deliberately mirrors
 * `resolveAmountDue`'s own `price - discountAmount` fallback so the receipt can
 * never show $0 while the card is charged the real amount.
 */
export type JobMoneyBasis = "ADDITIVE" | "INCLUSIVE" | "LEGACY_PRICE";

export interface MoneyAddOn {
  name?: string | null;
  price?: number | null;
  quantity?: number | null;
}

export interface JobMoneyJob {
  bookingSource?: string | null;
  price?: number | null;
  discountAmount?: number | null;
  subtotalAmount?: number | null;
  gstAmount?: number | null;
  qstAmount?: number | null;
  totalAmount?: number | null;
  isCashJob?: boolean | null;
  taxExempt?: boolean | null;
  addOns?: readonly MoneyAddOn[] | null;
}

export interface AddOnLine {
  name: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface JobMoney {
  basis: JobMoneyBasis;
  /**
   * Drives LABELS, not arithmetic. When true the add-on row is an itemisation
   * of a subtotal that already contains it, so it must not be rendered with a
   * leading "+" as though it were about to be added.
   */
  addOnsIncludedInSubtotal: boolean;
  /** The service line, add-ons excluded. On INCLUSIVE jobs this is a display residual. */
  basePrice: number;
  addOnLines: AddOnLine[];
  addOnTotal: number;
  /** What this computation actually subtracted — always 0 on INCLUSIVE. */
  discountApplied: number;
  /** `Job.discountAmount` as stored, for display. May be non-zero while discountApplied is 0. */
  discountRecorded: number;
  subtotalAmount: number;
  gstAmount: number;
  qstAmount: number;
  totalAmount: number;
  exempt: boolean;
  /** True when the stored gst/qst/total were preferred over recomputing them. */
  taxesFromStore: boolean;
}

/**
 * A row's quantity, normalised. Anything absent, non-finite, fractional-below-1
 * or negative reads as 1 — which is exactly what every pre-migration row and
 * every legacy payload means.
 */
export function addOnQuantity(a: { quantity?: number | null } | null | undefined): number {
  const n = Math.floor(Number(a?.quantity));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_ADDON_QUANTITY);
}

/** One add-on row's money: unit price x quantity. The only place this multiply is written. */
export function addOnLineTotal(a: MoneyAddOn | null | undefined): number {
  const unit = Number(a?.price);
  if (!Number.isFinite(unit)) return 0;
  return round2(unit * addOnQuantity(a));
}

/** Sum of every row's line total. */
export function sumAddOns(addOns: readonly MoneyAddOn[] | null | undefined): number {
  if (!addOns || addOns.length === 0) return 0;
  return round2(addOns.reduce((s, a) => s + addOnLineTotal(a), 0));
}

/**
 * Does this source already have its add-ons priced into its stored subtotal?
 *
 * `null` MUST resolve to ADDITIVE: saveJob's create path never writes
 * `bookingSource`, so every admin-created job carries null, as do
 * convertLeadToJob and the generic CSV importer. Defaulting the other way would
 * silently reinterpret the entire admin population.
 */
export function addOnMoneyBasis(
  bookingSource: string | null | undefined
): "ADDITIVE" | "INCLUSIVE" {
  const key = (bookingSource ?? "").trim().toLowerCase();
  if (key === "web" || key.startsWith("web ")) return "INCLUSIVE";
  if (key === "bookingkoala_import") return "INCLUSIVE";
  return "ADDITIVE";
}

/** Human label for the add-on row, so the two renderers can't word it differently. */
export function addOnLineLabel(line: AddOnLine): string {
  return line.quantity > 1 ? `${line.name} ×${line.quantity}` : line.name;
}

export function computeJobMoney(job: JobMoneyJob, rates: TaxRates): JobMoney {
  const addOnLines: AddOnLine[] = (job.addOns ?? []).map((a) => {
    const unitPrice = Number.isFinite(Number(a?.price)) ? round2(Number(a.price)) : 0;
    const quantity = addOnQuantity(a);
    return {
      name: (a?.name ?? "").trim(),
      unitPrice,
      quantity,
      lineTotal: round2(unitPrice * quantity),
    };
  });
  const addOnTotal = round2(addOnLines.reduce((s, l) => s + l.lineTotal, 0));

  const exempt = isJobTaxExempt(job);
  const discountRecorded = Number(job.discountAmount) || 0;
  const storedSubtotal = Number(job.subtotalAmount) || 0;
  const storedTotal = Number(job.totalAmount) || 0;
  const price = Number(job.price) || 0;

  const source = addOnMoneyBasis(job.bookingSource);

  // --- INCLUSIVE: read the stored subtotal back, unchanged. -----------------
  if (source === "INCLUSIVE" && storedSubtotal > 0) {
    const subtotalAmount = round2(storedSubtotal);
    // Prefer the stored tax figures. On a web booking they are what the
    // customer was quoted and what their card was authorised for; recomputing
    // could move them by a cent if the configured rates were edited since.
    const taxesFromStore = storedTotal > 0;
    const taxes = taxesFromStore
      ? {
          gstAmount: Number(job.gstAmount) || 0,
          qstAmount: Number(job.qstAmount) || 0,
          totalAmount: round2(storedTotal),
        }
      : computeJobTaxes(subtotalAmount, rates, exempt);
    return {
      basis: "INCLUSIVE",
      addOnsIncludedInSubtotal: true,
      basePrice: round2(Math.max(0, subtotalAmount - addOnTotal)),
      addOnLines,
      addOnTotal,
      discountApplied: 0,
      discountRecorded,
      subtotalAmount,
      gstAmount: taxes.gstAmount,
      qstAmount: taxes.qstAmount,
      totalAmount: taxes.totalAmount,
      exempt,
      taxesFromStore,
    };
  }

  // --- LEGACY_PRICE: an inclusive source written before the tax columns. ----
  // Mirrors resolveAmountDue's fallback so display and billing agree.
  if (source === "INCLUSIVE" && price > 0) {
    const subtotalAmount = round2(Math.max(0, price - discountRecorded));
    const taxes = computeJobTaxes(subtotalAmount, rates, exempt);
    return {
      basis: "LEGACY_PRICE",
      addOnsIncludedInSubtotal: true,
      basePrice: round2(Math.max(0, subtotalAmount - addOnTotal)),
      addOnLines,
      addOnTotal,
      discountApplied: discountRecorded,
      discountRecorded,
      subtotalAmount,
      gstAmount: taxes.gstAmount,
      qstAmount: taxes.qstAmount,
      totalAmount: taxes.totalAmount,
      exempt,
      taxesFromStore: false,
    };
  }

  // --- ADDITIVE: every admin job. Add-ons finally count. --------------------
  const basePrice = round2(price);
  const subtotalAmount = round2(
    Math.max(0, basePrice + addOnTotal - discountRecorded)
  );
  const taxes = computeJobTaxes(subtotalAmount, rates, exempt);
  return {
    basis: "ADDITIVE",
    addOnsIncludedInSubtotal: false,
    basePrice,
    addOnLines,
    addOnTotal,
    discountApplied: discountRecorded,
    discountRecorded,
    subtotalAmount: taxes.subtotalAmount,
    gstAmount: taxes.gstAmount,
    qstAmount: taxes.qstAmount,
    totalAmount: taxes.totalAmount,
    exempt,
    taxesFromStore: false,
  };
}
