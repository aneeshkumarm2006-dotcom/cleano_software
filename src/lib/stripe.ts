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

export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    return (getStripe() as any)[prop];
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

export async function getOrCreateStripeCustomer(clientId: string, email: string, name: string) {
  const { db } = await import("@/db");
  const client = await db.client.findUnique({ where: { id: clientId }, select: { stripeCustomerId: true } });

  if (client?.stripeCustomerId) return client.stripeCustomerId;

  const customer = await stripe.customers.create({ email, name, metadata: { clientId } });

  await db.client.update({
    where: { id: clientId },
    data: { stripeCustomerId: customer.id },
  });

  return customer.id;
}
