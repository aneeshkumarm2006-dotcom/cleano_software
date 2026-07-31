import Stripe from "stripe";

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
 * The booking deposit, in cents. Charged by `/api/stripe/charge-deposit` and
 * re-verified by `submitBooking`, which is why it lives here rather than being
 * written out at both ends — the two must never drift apart, or verification
 * would reject legitimate deposits.
 */
export const BOOKING_DEPOSIT_CENTS = 2000;
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
