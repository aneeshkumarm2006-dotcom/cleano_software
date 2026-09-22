/**
 * Every card surface must mount Stripe.js with THIS workspace's publishable
 * key, never a build-time platform-wide one.
 *
 * The bug this guards against, observed live on cleanocalgary.useawer.com:
 *
 *   api.stripe.com/v1/elements/sessions
 *     ?client_secret=pi_3UIUTwQXM2s1e0uI...   <- intent in Calgary's account
 *     &key=pk_live_51QKVohHGyi92zqFx...       <- Montreal's publishable key
 *   -> 400
 *
 * The deposit PaymentIntent was created server-side against the correct
 * workspace account by `stripeForCurrentOrg`, while the browser loaded
 * `process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — one value baked in at
 * build time for every tenant. Stripe cannot find an intent that does not
 * exist in the key's account, so the card field never rendered: the customer
 * saw a heading, "Secured by Stripe", blank space, and a dead Confirm button.
 *
 * Database-free on purpose. It reads source, so it runs in CI.
 */
import { readFileSync } from "node:fs";

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean) {
  if (ok) passed++;
  else failures.push(name);
}

const read = (p: string) => readFileSync(p, "utf8");

/** Every file that mounts Stripe Elements, and where its key comes from. */
const SURFACES: { file: string; source: string }[] = [
  {
    file: "src/app/(book)/book/steps/Step5Review.tsx",
    source: "src/app/(book)/actions/getBookingConfig.ts",
  },
  {
    file: "src/app/admin/jobs/SaveCardOnFile.tsx",
    source: "src/app/api/stripe/setup-intent/route.ts",
  },
  {
    file: "src/app/(customer)/(secured)/account/PaymentMethods.tsx",
    source: "src/app/(customer)/actions/paymentMethods.ts",
  },
  {
    file: "src/app/(public)/add-card/[token]/AddCardForm.tsx",
    source: "src/app/(public)/add-card/[token]/actions/createSetupIntent.ts",
  },
  {
    file: "src/app/(public)/gift-card/GiftCardPurchaseClient.tsx",
    source: "src/app/(public)/gift-card/actions/createGiftCardIntent.ts",
  },
];

// 1. The shared loader exists and refuses a missing key rather than calling
//    loadStripe(undefined), which is what rendered an empty <Elements>.
const loader = read("src/lib/stripe-browser.ts");
check("stripe-browser exports stripeFor", /export function stripeFor\(/.test(loader));
check("stripe-browser returns null for a missing key", /if \(!key\) return null;/.test(loader));
check("stripe-browser caches one loader per key", /loaders\.(get|set)\(/.test(loader));

// 2. No card surface reads the build-time platform key any more. Comments are
//    allowed to name it; code is not.
for (const { file, source } of SURFACES) {
  const code = read(file)
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");

  check(
    `${file} does not read NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`,
    !code.includes("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"),
  );
  check(`${file} uses the shared stripeFor loader`, code.includes("stripeFor("));
  check(
    `${file} does not call loadStripe directly`,
    !/\bloadStripe\s*\(/.test(code),
  );
  // A null key must not reach <Elements>: that is the blank-card-field state.
  // Two shapes are fine — a conditional around the element, or an early return
  // above it (AddCardForm folds the case into its existing error branch).
  check(
    `${file} guards <Elements> on a resolved loader`,
    /stripePromise &&/.test(code) ||
      /&& stripePromise/.test(code) ||
      /!stripePromise\)/.test(code),
  );

  // 3. The key travels with the intent, from the same org-scoped resolver that
  //    created it. If these ever diverge, Stripe 400s again.
  const src = read(source);
  check(`${source} returns publishableKey`, /publishableKey/.test(src));
  check(
    `${source} takes it from orgStripeStatus, not the environment`,
    /orgStripeStatus/.test(src),
  );
}

// 4. The server resolver still prefers the workspace's own key over the
//    environment's. This is the invariant everything above rests on.
const orgStripe = read("src/lib/stripe-org.ts");
check(
  "stripe-org prefers the workspace key",
  orgStripe.indexOf("source: \"workspace\"") <
    orgStripe.indexOf("source: \"environment\""),
);

if (failures.length) {
  console.error(`✘ ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}
console.log(`✔ ${passed} passed, 0 failed`);
