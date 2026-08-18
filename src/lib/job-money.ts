import {
  computeJobTaxes,
  isJobTaxExempt,
  type TaxRates,
} from "./tax";
import {
  hourlyServiceAmount,
  type HourlyBillingFields,
} from "./hourly-billing";

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
 * ## The rule: the basis comes from `Job.pricingMode`, falling back to provenance
 *
 * Since cleano_new_fixes.pdf fix 2 the basis is an ADMIN CHOICE stored on the
 * job — `ITEMIZED` (the parts are the price) or `FINAL_PRICE` (one typed service
 * total wins and the add-on rows itemise it). `resolvePricingMode()` reads that
 * column and only falls back to the `bookingSource` rule below when it is NULL,
 * which is what lets rows written before the column price exactly as they did.
 *
 * The rest of this section describes that fallback — i.e. how a job with no
 * stamped mode is read, and why the two modes existed implicitly first.
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
 * This module imports ONLY from `./tax` and `./hourly-billing`, both of which
 * are themselves pure. It must never reach for `@/db`, `server-only`,
 * `@/lib/stripe` or `@/lib/job-billing` — that last one is the trap, since it
 * pulls BOOKING_DEPOSIT_CENTS out of lib/stripe.ts, whose first line is
 * `import Stripe from "stripe"`. Three client components render from here
 * (JobModal's live total preview, JobDetailView's Financials tab, and the
 * /book steps), so a server-only import would break the build at the far end of
 * the app from wherever it was added. verify-awer-fixes-3.ts asserts this.
 *
 * ## Hourly billing sits UNDER the mode, not beside it (Stage 8 / PDF #8)
 *
 * `Job.billingType = HOURLY` changes exactly ONE thing here: what the base
 * service line is. Instead of `Job.price` it is
 * `billedHourlyRate × (billedActualHours ?? billedEstimatedHours)`. Everything
 * downstream — add-ons, discount, tax, the pay basis — is untouched, and the
 * FINAL_PRICE override still wins outright, which is the PDF's *"unless admin
 * manually overrides the price"*.
 *
 * The hourly columns are OPTIONAL on the input types below, so a `select` that
 * predates Stage 8 keeps pricing off `Job.price` rather than silently pricing a
 * job at zero. That fallback is safe because BOTH save paths also write the
 * derived hourly amount into `Job.price` — see the `hourlyBase` note in
 * saveJob.ts. This module is the live authority; the column is the mirror.
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

/**
 * The stored, admin-selectable pricing mode (`Job.pricingMode`).
 *
 * Spelled as a string union rather than imported from `@prisma/client` on
 * purpose: this module is client-safe (see the header) and three client
 * components render from it. The values are identical to the Prisma enum, and
 * `isPricingMode()` is the one place that decides whether an arbitrary string
 * from a form or a database row is one of them.
 */
export type JobPricingMode = "ITEMIZED" | "FINAL_PRICE";

export const JOB_PRICING_MODES: readonly JobPricingMode[] = [
  "ITEMIZED",
  "FINAL_PRICE",
] as const;

/** Human labels for the mode. One definition, so no two surfaces word it differently. */
export const PRICING_MODE_LABEL: Record<JobPricingMode, string> = {
  ITEMIZED: "Itemized pricing",
  FINAL_PRICE: "Final price override",
};

/** The one-line explanation each mode carries wherever it is offered as a choice. */
export const PRICING_MODE_HINT: Record<JobPricingMode, string> = {
  ITEMIZED:
    "The parts are the price — add-ons and extra charges are added to the base price.",
  FINAL_PRICE:
    "One agreed service total wins. Add-ons are recorded for scope and the cleaner, and never change the total.",
};

export function isPricingMode(v: unknown): v is JobPricingMode {
  return v === "ITEMIZED" || v === "FINAL_PRICE";
}

export interface MoneyAddOn {
  name?: string | null;
  price?: number | null;
  quantity?: number | null;
}

export interface JobMoneyJob extends HourlyBillingFields {
  bookingSource?: string | null;
  /**
   * The stamped mode. Typed loosely because it arrives from three places with
   * three shapes — the Prisma enum, a form string, and a serialized DTO — and
   * `resolvePricingMode` validates rather than trusts. NULL/absent/garbage all
   * fall back to the `bookingSource` rule.
   */
  pricingMode?: JobPricingMode | string | null;
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
   * The hourly service line (`rate × hours`) when this job is billed HOURLY and
   * the figure is usable, else null. Drives LABELS — "4h × $60.00/hr" — and is
   * how a surface tells "this base price was derived" from "an admin typed it".
   * Non-null even under FINAL_PRICE, where it is the counterfactual the
   * override is replacing; `basePrice` is still the active number in that case.
   */
  hourlyServiceAmount: number | null;
  /**
   * The mode this computation actually ran under, after the fallback. What the
   * UIs label the job with — never re-derive it beside a `computeJobMoney` call.
   */
  pricingMode: JobPricingMode;
  /**
   * True when `pricingMode` was READ off the job rather than inferred from
   * `bookingSource`. Drives nothing in the arithmetic; it exists so a surface
   * can tell "the admin chose this" from "we guessed, as we always did".
   */
  pricingModeIsExplicit: boolean;
  /**
   * What the parts add up to: `base + sum(add-on line totals) − discount`,
   * floored at zero. In ITEMIZED mode this IS `subtotalAmount`. In FINAL_PRICE
   * mode it is the counterfactual the job detail page prints beside the active
   * override ("Calculated from items: $X" vs "Active override total: $Y") and
   * the figure "Recalculate from items" would switch the job to.
   */
  itemizedSubtotal: number;
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

/**
 * THE mode question, answered in one place: is this job priced from its parts,
 * or from one typed service total?
 *
 * Order matters and is the whole point of fix 2:
 *
 *   1. `Job.pricingMode`, when it is stamped. An admin's explicit choice beats
 *      any inference, and — critically — it SURVIVES the admin retyping the
 *      price. The bug this replaces was `priceUnchanged` in saveJob: editing the
 *      price of a web/imported booking flipped it to itemized behind the admin's
 *      back, and its add-ons started adding on top of a subtotal that already
 *      contained them.
 *   2. Otherwise the historical provenance rule, so every row written before the
 *      column prices exactly as it did before.
 *
 * Callers that also need to know WHICH of the two answered should read
 * `computeJobMoney(...).pricingModeIsExplicit` rather than re-deriving it.
 */
export function resolvePricingMode(job: {
  pricingMode?: JobPricingMode | string | null;
  bookingSource?: string | null;
}): JobPricingMode {
  if (isPricingMode(job?.pricingMode)) return job.pricingMode;
  return addOnMoneyBasis(job?.bookingSource) === "INCLUSIVE"
    ? "FINAL_PRICE"
    : "ITEMIZED";
}

/** Human label for the add-on row, so the two renderers can't word it differently. */
export function addOnLineLabel(line: AddOnLine): string {
  return line.quantity > 1 ? `${line.name} ×${line.quantity}` : line.name;
}

/**
 * What an add-on row prints where its amount would go, when it has no amount
 * of its own. One string, so no two surfaces word it differently.
 */
export const ADDON_INCLUDED_LABEL = "included in service total";

/**
 * Does this add-on row have no separate money to show?
 *
 * True only when BOTH hold:
 *
 *   * the job's add-ons are already inside its stored subtotal (a web booking
 *     or a BookingKoala import), and
 *   * this row's line total is zero.
 *
 * That pair is exactly the BookingKoala case. `resolveBkAddOns` writes
 * `price: 0` on every imported row on purpose — the CSV's "Service total"
 * already billed the extras, so giving them a price would charge for them
 * twice — and the consequence was a chip reading `Inside Fridge · $0.00`. A
 * customer's own words for that are "the add-ons didn't import", which is the
 * complaint behind item 22 even though the rows were there and correct.
 *
 * Deliberately NOT "line total is zero", full stop: on an ADDITIVE (admin) job
 * a $0.00 add-on is a real decision — an extra thrown in at no charge — and
 * `$0.00` is the honest way to print it. Nothing is "included in the service
 * total" there, because that job's total does not contain it.
 */
export function addOnAmountIsIncluded(
  lineTotal: number,
  addOnsIncludedInSubtotal: boolean
): boolean {
  return addOnsIncludedInSubtotal && round2(Number(lineTotal) || 0) === 0;
}

/**
 * The columns the ACTIVE value of a job is computed from.
 *
 * Every field is REQUIRED here (nullable, but present) on purpose. This is the
 * shape the reporting helpers take, and a Prisma `select` that forgets one of
 * them would otherwise compile and silently fall back to the bare-price number
 * fix 3 exists to remove — the failure would be a wrong dollar figure on a
 * dashboard, which nobody notices. Making it a type error moves the failure to
 * the build.
 */
export interface ActiveValueJob extends HourlyBillingFields {
  price: number | null;
  discountAmount: number | null;
  subtotalAmount: number | null;
  bookingSource: string | null;
  pricingMode: JobPricingMode | string | null;
  addOns: readonly MoneyAddOn[];
  // The four Stage 8 hourly columns arrive OPTIONAL (from HourlyBillingFields)
  // rather than required like the six above, and the difference is deliberate.
  // The six are required because forgetting one changes the answer with no
  // fallback. Forgetting the hourly four falls back to `Job.price`, which both
  // save paths keep equal to the derived hourly amount — so an un-threaded
  // reporting query prints the right dollar figure, it just won't recompute
  // live. Making them required would mean editing ~15 selects to no gain.
}

/**
 * Rates that cannot move the figure `activeSubtotal` reads.
 *
 * The pre-tax subtotal is rate-INDEPENDENT in all three branches of
 * `computeJobMoney`: FINAL_PRICE reads the stored column back, and the other
 * two take `computeJobTaxes(...).subtotalAmount`, which is
 * `round2(max(0, subtotal))` — the rates only ever touch gst/qst/total. So a
 * caller that has no tax rates in hand (a client component, a metrics reducer,
 * a CSV export) can still ask for the active value without inventing rates or
 * awaiting `getTaxRates()`.
 */
const SUBTOTAL_ONLY_RATES: TaxRates = { gstRate: 0, qstRate: 0 };

/**
 * THE active value of a job, pre-tax: what the parts come to under ITEMIZED, or
 * the stored override total under FINAL_PRICE.
 *
 * This is the one number cleano_new_fixes.pdf fix 3 is about — "base price,
 * add-ons, extra charges, and the active manual price override". Every surface
 * that prints or aggregates "the price" reads it; none of them read `Job.price`,
 * which is only ever the BASE service line (and, on a web booking, a tax-
 * inclusive one — see lib/job-billing.ts).
 *
 * Deliberately NOT `price - discount + addOns` written out again: it delegates
 * to `computeJobMoney` so the price card, the receipt, the invoice and the
 * dashboard cannot drift from each other the way they did before this stage.
 *
 * On the discount: the returned figure is discount-NET (the ITEMIZED branch
 * subtracts it; under FINAL_PRICE it is already inside the stored subtotal).
 * That is right for revenue. It is deliberately NOT the cleaner pay basis —
 * decision D5 keeps discounts out of that, so Stage 4 builds its basis from
 * this module separately rather than reusing this function.
 */
export function activeSubtotal(job: JobMoneyJob): number {
  return computeJobMoney(job, SUBTOTAL_ONLY_RATES).subtotalAmount;
}

/**
 * THE basis every cleaner's PERCENTAGE pay is a fraction of (fix 5, Stage 4a.1).
 *
 * The PDF: "Active subtotal includes base price, add-ons, extra charges, and the
 * active manual price override." Before this, `computeJobPayShares` paid a
 * percentage of `Job.price` — the BASE service line — so the $100 + $71 job on
 * page 5 paid its cleaner off $100 and every add-on and custom extra charge was
 * work the crew did for free.
 *
 * Same two modes as everything else in this module:
 *
 *   FINAL_PRICE  the stored override total (what the job is agreed to be worth)
 *   ITEMIZED     base + Σ add-on line totals
 *
 * ## The discount is deliberately NOT subtracted — decision D5
 *
 * This is the ONE place the pay basis and `jobRevenue` part company, and the
 * asymmetry is intentional:
 *
 *   revenue    = activeSubtotal  →  discount-NET   (a discount is money the
 *                                   company chose not to collect)
 *   pay basis  = this function   →  discount-GROSS (a discount is marketing
 *                                   spend, not a smaller job)
 *
 * Two reasons. First, today's basis (`job.price`) already ignores the discount,
 * so honouring it here would land a cleaner pay CUT in the same release as the
 * add-on increase — a change nobody asked for, arriving disguised as one they
 * did. Second, the PDF's own definition of the basis lists "base price, add-ons,
 * extra charges, and the active manual price override" and conspicuously omits
 * discounts. See `jobRevenue` in metrics-shared.ts for the other half of this.
 *
 * ## Hourly jobs need no branch here (Stage 8)
 *
 * Because this delegates to `computeJobMoney`, an HOURLY-billed job's basis IS
 * `rate × hours (+ add-ons)` automatically — which is what PDF #8 asks for when
 * it says cleaner pay must calculate correctly for hourly jobs. A PERCENTAGE
 * crew on a 5-hour $60/hr job takes their tier cut of $300, and when the actual
 * hours are snapshotted at clock-out the basis moves with them. Nothing in
 * `computeJobPayShares` changed; it reads this.
 *
 * Implemented by re-running `computeJobMoney` with the discount zeroed rather
 * than by writing `price + addOns` out again, so the basis can never drift from
 * the breakdown the admin is looking at. Under FINAL_PRICE the zeroing is a
 * no-op: that branch reads the stored subtotal, which has the discount inside it
 * already and IS the agreed total.
 */
export function jobPayBasis(job: JobMoneyJob): number {
  return computeJobMoney(
    { ...job, discountAmount: 0 },
    SUBTOTAL_ONLY_RATES
  ).subtotalAmount;
}

// ── Customer-funded pass-throughs: tips and parking (decision D3) ────────────

/**
 * The two columns that hold money the CUSTOMER funds and the CLEANER receives.
 *
 * `Job.parking` is labelled "Transportation" in the admin UI. It was booked as a
 * company EXPENSE (it reduced net profit) while never being paid to anyone, and
 * `Job.totalTip` was booked as company INCOME. The PDF's invariant is that
 * neither "must be treated as company revenue or incorrectly reduce company
 * profit" — they are collected on the customer's behalf and handed to the crew.
 */
export interface PassThroughFields {
  totalTip?: number | null;
  parking?: number | null;
}

/** Tip + parking, floored at zero. The one place this addition is written. */
export function passThroughTotal(job: PassThroughFields): number {
  const tip = Math.max(0, Number(job?.totalTip) || 0);
  const parking = Math.max(0, Number(job?.parking) || 0);
  return round2(tip + parking);
}

export interface PassThroughBilling {
  /** What `Job.totalAmount` should be: taxed service total + `collected`. */
  totalAmount: number;
  /** The pass-through the customer's card is (or was) charged for. */
  collected: number;
  /**
   * Pass-through the cleaners are owed that the card never took — money the
   * admin has to collect separately. Non-zero only on an already-settled job.
   */
  uncollected: number;
}

/**
 * D3, in one function: how much of a job's tip + parking rides along on the card.
 *
 * Tips and parking are customer-funded, which is the whole reason they can be
 * paid out to cleaners without denting profit — if the company paid a tip it
 * never collected, profit WOULD drop, contradicting the PDF's requirement. So
 * they have to actually be billed:
 *
 *   NOT SETTLED  fold the whole pass-through into `totalAmount`. `resolveAmountDue`
 *                already prefers that column, so the card takes it with the job.
 *   SETTLED      fold in only what the stored total ALREADY contains. A tip typed
 *                after the card was charged must not reappear as a new balance
 *                owed — D3 is explicit: "no automatic second charge, and no
 *                retroactive recharge of historical rows". It is flagged
 *                `uncollected` instead, for the admin to take in cash.
 *
 * ## Why `collected` is derived rather than stored
 *
 * On a settled job the already-collected pass-through is recoverable without a
 * new column, because saveJob is the only writer of `totalAmount` and what it
 * wrote was `taxedTotal_then + passThrough_then`. If the service total has not
 * moved since, `storedTotal − taxedTotal` IS `passThrough_then`. It is clamped
 * to `[0, passThrough]` so the arithmetic can only ever be conservative when the
 * service total HAS moved: it can under-credit (the surplus shows up as
 * `uncollected`, which an admin can see and act on), never over-credit, and
 * never invent a charge.
 */
export function resolvePassThroughBilling(args: {
  taxedTotal: number;
  passThrough: number;
  settled: boolean;
  storedTotal?: number | null;
}): PassThroughBilling {
  const taxedTotal = round2(Math.max(0, Number(args.taxedTotal) || 0));
  const passThrough = round2(Math.max(0, Number(args.passThrough) || 0));

  const collected = args.settled
    ? round2(
        Math.min(
          passThrough,
          Math.max(0, (Number(args.storedTotal) || 0) - taxedTotal)
        )
      )
    : passThrough;

  return {
    totalAmount: round2(taxedTotal + collected),
    collected,
    uncollected: round2(Math.max(0, passThrough - collected)),
  };
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
  const storedPrice = Number(job.price) || 0;

  // ── Hourly billing (Stage 8) ──────────────────────────────────────────────
  // The ONE thing `billingType = HOURLY` changes: the base service line is
  // `rate × hours` instead of the stored `price`. Null for every FLAT job and
  // for an hourly job with no rate or no hours yet, in which case `price` is
  // used exactly as before — so this is inert on every row written before the
  // column existed.
  //
  // Deliberately NOT applied inside the FINAL_PRICE branches below: an override
  // is the admin saying "this job is worth $X regardless", and rate × hours
  // must not quietly outrank it. It stays computed here so the UI can still
  // print the hourly line beside the override it is being overridden by.
  const hourly = hourlyServiceAmount(job);
  const price = hourly ?? storedPrice;

  // What the PARTS come to, in every mode. Under FINAL_PRICE this is not what
  // the customer pays — it is the counterfactual the UI prints beside the
  // override and the number "Recalculate from items" would adopt. On an hourly
  // job that counterfactual is the hourly line plus add-ons, which is what
  // makes "Recalculate from items" mean "go back to billing rate × hours".
  const itemizedSubtotal = round2(
    Math.max(0, round2(price) + addOnTotal - discountRecorded)
  );

  const pricingMode = resolvePricingMode(job);
  const pricingModeIsExplicit = isPricingMode(job.pricingMode);

  // --- FINAL_PRICE: read the stored service total back, unchanged. ----------
  if (pricingMode === "FINAL_PRICE" && storedSubtotal > 0) {
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
      hourlyServiceAmount: hourly,
      pricingMode,
      pricingModeIsExplicit,
      itemizedSubtotal,
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

  // --- LEGACY_PRICE: a FINAL_PRICE job with no stored subtotal to read. -----
  // Two populations land here, and they want the same answer: an inclusive
  // source written before the tax columns existed, and a job the admin has just
  // switched INTO override mode in a live form preview, where `price` is the
  // override they are typing and nothing is stored yet. Mirrors
  // resolveAmountDue's own `price − discountAmount` fallback so display and
  // billing agree.
  // `storedPrice`, NOT the hourly-derived figure: in this branch `price` IS the
  // override the admin typed, so deriving it from rate × hours would make the
  // override unreachable on an hourly job.
  if (pricingMode === "FINAL_PRICE" && storedPrice > 0) {
    const subtotalAmount = round2(Math.max(0, storedPrice - discountRecorded));
    const taxes = computeJobTaxes(subtotalAmount, rates, exempt);
    return {
      basis: "LEGACY_PRICE",
      hourlyServiceAmount: hourly,
      pricingMode,
      pricingModeIsExplicit,
      itemizedSubtotal,
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

  // --- ADDITIVE: the itemized mode. Add-ons count. --------------------------
  // Also the floor for a FINAL_PRICE job with neither a stored subtotal nor a
  // price: there is no override to honour, so the parts are all there is, and
  // with no parts either every figure is zero — which is what an empty new-job
  // form should preview.
  const basePrice = round2(price);
  const subtotalAmount = round2(
    Math.max(0, basePrice + addOnTotal - discountRecorded)
  );
  const taxes = computeJobTaxes(subtotalAmount, rates, exempt);
  return {
    basis: "ADDITIVE",
    hourlyServiceAmount: hourly,
    pricingMode,
    pricingModeIsExplicit,
    itemizedSubtotal,
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
