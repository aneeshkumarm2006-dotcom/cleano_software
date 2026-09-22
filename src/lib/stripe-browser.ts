// Mounting Stripe.js in a multi-tenant app.
//
// Every card surface used to do this at module scope:
//
//     const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)
//
// `NEXT_PUBLIC_` values are baked in at BUILD time and are the same for every
// workspace, which breaks in both directions once more than one company uses
// the app:
//
//   - Unset: `loadStripe(undefined)` never initialises. `<Elements>` mounts and
//     `<PaymentElement>` renders nothing, so the customer sees a heading, a
//     "Secured by Stripe" line, blank space where the card field should be, and
//     a Confirm button that never enables. Nothing on screen says why.
//   - Set: every workspace mounts against ONE Stripe account, while each
//     workspace's PaymentIntent is created against its OWN account by
//     `stripeForCurrentOrg`. Stripe then cannot find the intent the browser is
//     trying to confirm, because it does not exist in that account.
//
// So the publishable key has to travel from the server with the intent, and
// the two must come from the same account. Publishable keys are public by
// design; this is exactly what they are for.

import { loadStripe } from "@stripe/stripe-js";

/**
 * One loader per key.
 *
 * Keyed by the key itself so switching workspaces produces a new loader rather
 * than reusing the old one, and so a re-render does not re-download Stripe.js.
 */
const loaders = new Map<string, ReturnType<typeof loadStripe>>();

/**
 * The Stripe.js loader for this workspace, or `null` when the workspace has no
 * publishable key.
 *
 * Null is a real, reachable state — a company that has not connected Stripe
 * yet — and callers must render something that says so rather than an empty
 * `<Elements>`.
 */
export function stripeFor(
  key: string | null | undefined,
): ReturnType<typeof loadStripe> | null {
  if (!key) return null;
  let loader = loaders.get(key);
  if (!loader) {
    loader = loadStripe(key);
    loaders.set(key, loader);
  }
  return loader;
}
