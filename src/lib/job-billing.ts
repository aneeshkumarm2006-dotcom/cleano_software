import { BOOKING_DEPOSIT_CENTS } from "@/lib/stripe";

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
 * Then the deposit comes off, once, if one was actually collected.
 *
 * ## What deliberately does NOT use this
 *
 * `toggleJobPaymentStatus`'s Transaction row and `metrics-shared`'s
 * `jobRevenue` record PRE-TAX revenue with `taxAmount` held separately — that
 * is the shape of the live Transaction rows. Routing them through here would
 * double-count tax in every report.
 */

/** The booking deposit in dollars. Sourced from the cents constant so the two cannot drift. */
export const BOOKING_DEPOSIT_USD = BOOKING_DEPOSIT_CENTS / 100;

export interface JobBillingFields {
  price: number | null;
  discountAmount: number | null;
  totalAmount: number | null;
  depositPaid: boolean;
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
  const gross =
    job.totalAmount != null && job.totalAmount > 0
      ? job.totalAmount
      : Math.max(0, (job.price ?? 0) - (job.discountAmount ?? 0));

  // Only when a deposit was actually taken. `depositPaid` is stamped by
  // submitBooking after `verifyBookingDeposit` confirms the PaymentIntent with
  // Stripe, so it cannot be set by a booking that never paid one.
  const deposit = job.depositPaid ? BOOKING_DEPOSIT_USD : 0;

  return round2(Math.max(0, gross - deposit));
}
