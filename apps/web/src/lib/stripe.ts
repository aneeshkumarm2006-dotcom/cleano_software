import Stripe from "stripe";
import { STANDARD_BOOKING_DEPOSIT_USD } from "@/lib/booking-deposit";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is not set");
    }
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2026-04-22.dahlia",
    });
  }
  return _stripe;
}

/**
 * The platform-wide Stripe client. NOT for taking payments.
 *
 * It has no idea which company it is acting for, which is exactly how a second
 * company's deposit would have been paid into the first company's account. Use
 * `requireStripeForCurrentOrg()` from lib/stripe-org.ts, which resolves the
 * workspace's own credentials and refuses when there are none.
 *
 * Kept exported and throwing rather than deleted so that anything still reaching
 * for it fails immediately and says why, instead of finding a global by accident.
 */
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    throw new Error(
      `stripe.${String(prop)} — the shared Stripe client cannot take payments, because it does not ` +
        "know which company it is acting for. Use requireStripeForCurrentOrg() from @/lib/stripe-org.",
    );
  },
});

/**
 * The STANDARD booking deposit, in cents. Charged by
 * `/api/stripe/charge-deposit` and re-verified by `submitBooking`, which is why
 * it lives here rather than being written out at both ends — the two must never
 * drift apart, or verification would reject legitimate deposits.
 *
 * ⚠️ NO LONGER "the deposit" (PDF #9, Stage 11). Post-construction charges a
 * configurable deposit (default $200), so the amount for a given booking is
 * resolved per service type by `resolveDepositCentsForService()` in
 * `@/lib/booking-deposit.server.ts` and then STORED on `Job.depositAmount`.
 * This constant is now only:
 *   • the amount every non-quoted service charges, and
 *   • the historical value that `resolveDepositCredit()` credits for rows
 *     written before `Job.depositAmount` existed.
 * Sourced from the dollar figure in `@/lib/booking-deposit` so the two can't
 * drift. Do not reintroduce a read of this as "the deposit" for a job.
 */
export const BOOKING_DEPOSIT_CENTS = STANDARD_BOOKING_DEPOSIT_USD * 100;
export const BOOKING_DEPOSIT_CURRENCY = "cad";
