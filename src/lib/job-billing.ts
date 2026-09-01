import { BOOKING_DEPOSIT_CENTS } from "@/lib/stripe";
import { resolveDepositCredit } from "@/lib/booking-deposit";
import { passThroughTotal } from "@/lib/job-money";

/**
 * THE amount a job's card gets charged. One function, so the five paths that
 * move or preview money cannot drift apart again.
 *
 * ## Why this exists: `Job.price` means two different things
 *
 * Two writers, two conventions, and `chargeJob` was written for one of them:
 *
 *   saveJob (admin)      price = PRE-tax, PRE-discount   totalAmount = taxed ✓
 *   submitBooking (web)  price = tax-INCLUSIVE, POST-discount   totalAmount = never written
 *
 * The old arithmetic was `price - discountAmount` everywhere, which produced
 * three separate defects:
 *
 *   1. On an admin job it equals `subtotalAmount` — the PRE-TAX figure. GST/QST
 *      (14.975% combined) was never collected on any admin-created or imported
 *      job, even though the business is registered for both and its invoices
 *      show the tax. Measured on live rows: $16.77 short on a $112 job, $44.93
 *      on a $353 one.
 *   2. On a web booking the referral credit came off TWICE — `submitBooking`
 *      stored a `price` already net of the credit AND stored the same credit in
 *      `discountAmount`, which this line then subtracted again. A $25 credit
 *      took ~$54 off (the first application also strips the tax on it). The
 *      same shape on recurring children repeated it on EVERY visit.
 *   3. The $20 deposit was never credited, though the booking email and Step 5
 *      both promise "A $20 deposit was collected at booking. The remaining
 *      balance is charged only after your cleaning is complete."
 *
 * ## The rule
 *
 * Prefer `totalAmount`. On an admin job it is `computeJobTaxes(price -
 * discountAmount)` — already taxed AND already net of the discount, so it fixes
 * (1) and cannot re-subtract the discount. `submitBooking` now writes it too
 * (`pricing.total`, likewise taxed and net of both the referral credit and any
 * promo), which fixes (2).
 *
 * `price - discountAmount` survives only as the fallback for rows written
 * before `totalAmount` was populated — legacy imports and any row where taxes
 * were never computed. Those behave exactly as they do today, so this change
 * cannot move an amount it does not also correct.
 *
 * Then the deposit comes off, once, if one was actually collected — and since
 * Stage 11 it is the amount THAT job collected (`Job.depositAmount`), not a
 * constant. A post-construction booking takes $200; crediting it $20 would
 * overcharge the customer by $180 at completion.
 *
 * ## What deliberately does NOT use this
 *
 * `toggleJobPaymentStatus`'s Transaction row and `metrics-shared`'s
 * `jobRevenue` record PRE-TAX revenue with `taxAmount` held separately — that
 * is the shape of the live Transaction rows. Routing them through here would
 * double-count tax in every report.
 */

/**
 * The STANDARD booking deposit in dollars. Sourced from the cents constant so
 * the two cannot drift.
 *
 * ⚠️ Not "the deposit for a job" since Stage 11 — post-construction charges a
 * configurable amount. Use `resolveDepositCredit(job)` for that. This stays
 * exported because it is the right default in the two places that have no job to
 * read: the booking-confirmation email's fallback, and the historical value for
 * rows written before `Job.depositAmount` existed.
 */
export const BOOKING_DEPOSIT_USD = BOOKING_DEPOSIT_CENTS / 100;

export interface JobBillingFields {
  price: number | null;
  discountAmount: number | null;
  totalAmount: number | null;
  depositPaid: boolean;
  /**
   * What the deposit actually was (Stage 11). OPTIONAL on purpose: a `select`
   * that predates the column omits it and lands on the $20 fallback inside
   * `resolveDepositCredit`, which is the figure every such row really charged —
   * so an un-threaded caller degrades to today's answer, not to a free job.
   *
   * ⚠️ A caller reading a POST-CONSTRUCTION job must include it. Without it a
   * $200 deposit would credit $20 and the customer would be charged $180 too
   * much. Every reader in the repo is threaded; the verify script asserts it.
   */
  depositAmount?: number | null;
  /**
   * The customer-funded pass-throughs (decision D3), for the FALLBACK path
   * below only.
   *
   * OPTIONAL for the same reason `depositAmount` is: a `select` that omits them
   * lands on today's answer rather than on a wrong one. Include them wherever a
   * job might not have `totalAmount` computed — every imported row is such a
   * job.
   */
  totalTip?: number | null;
  parking?: number | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * What this job still owes, before any gift-card balance is drawn down.
 *
 * Callers keep their own gift-card / hold logic; this answers only "how much is
 * the booking worth, net of what has already been collected".
 */
export function resolveAmountDue(job: JobBillingFields): number {
  /**
   * THE FALLBACK HAS TO CARRY THE TIP TOO.
   *
   * `totalAmount` already contains tip and parking — `resolvePassThroughBilling`
   * folds them in on every save (D3), which is why nothing is added on that
   * branch and adding it would charge them twice.
   *
   * The other branch had no such protection. A job whose `totalAmount` was
   * never computed falls back to `price − discount`, and the pass-through
   * simply vanished from what the customer owed. That is not a rare shape: the
   * BookingKoala import writes `price` and leaves `subtotalAmount` and
   * `totalAmount` at 0, so EVERY imported job takes this branch. Production
   * job #2211 carries a $19.25 tip against a $128.34 price and was asking the
   * customer for nothing at all — the tip was recorded, owed to the cleaner,
   * and never billed.
   */
  const usesStoredTotal = job.totalAmount != null && job.totalAmount > 0;
  const gross = usesStoredTotal
    ? job.totalAmount!
    : Math.max(0, (job.price ?? 0) - (job.discountAmount ?? 0)) +
      passThroughTotal(job);

  // Only when a deposit was actually taken, and only ever the amount that was
  // actually taken. `depositPaid` is stamped by submitBooking after
  // `verifyBookingDeposit` confirms the PaymentIntent with Stripe, so it cannot
  // be set by a booking that never paid one; `depositAmount` is written in the
  // same statement from the server-resolved figure, so it cannot claim a credit
  // larger than the charge.
  const deposit = resolveDepositCredit(job);

  return round2(Math.max(0, gross - deposit));
}
