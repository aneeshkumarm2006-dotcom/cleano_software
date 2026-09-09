// Awer's own billing: charging a cleaning company for using the platform.
//
// Not to be confused with lib/stripe-org.ts, which is how a cleaning company
// charges ITS customers on ITS OWN Stripe account. These two must never meet:
// this module always uses getStripe(), the platform account, and always writes
// through platformDb, because a Subscription is a fact about a workspace
// rather than a row inside one.
//
// Prices come from PLANS via price_data rather than Stripe Price IDs. That is
// deliberate: the pricing page, the enforced cleaner cap and the amount
// actually charged then all read the same constant, and there is no dashboard
// copy of the price that can quietly disagree with the product.
import "server-only";

import type { OrgPlan } from "@prisma/client";

import { getStripe } from "@/lib/stripe";
import { platformDb } from "@/lib/platform-db";
import { currentAppUrl } from "@/lib/org-url";
import { PLANS, priceFor, type BillingIntervalKey } from "@/lib/plans";

export type BillingResult =
  | { ok: true; url: string }
  | { ok: false; message: string };

/**
 * Stripe refuses a trial_end less than 48 hours out. Rather than let it throw
 * mid-checkout, anything inside that window simply starts billing now — which
 * is what a trial with a day left means anyway.
 */
const MIN_TRIAL_LEAD_MS = 48 * 60 * 60 * 1000;

/**
 * One Stripe Product per plan, with a deterministic id.
 *
 * The obvious thing — inline `product_data` on the checkout line — creates a
 * BRAND NEW product every time somebody subscribes, so the Stripe account
 * fills with hundreds of identical "Awer Starter" entries and the reporting
 * built on top of them is meaningless. A fixed id means one product per plan,
 * created on first use, with nothing to configure in the dashboard first.
 */
async function productIdFor(plan: OrgPlan): Promise<string> {
  const id = `awer_${plan.toLowerCase()}`;
  const stripe = getStripe();
  try {
    await stripe.products.retrieve(id);
  } catch {
    try {
      await stripe.products.create({ id, name: `Awer ${PLANS[plan].label}` });
    } catch {
      // Lost a race with a concurrent checkout, which is fine: the product
      // exists either way, and that is all the caller needs.
    }
  }
  return id;
}

/** The workspace's Stripe customer, created on first use and remembered. */
async function customerFor(
  orgId: string,
): Promise<{ id: string } | { error: string }> {
  const org = await platformDb.organization.findUnique({
    where: { id: orgId },
    select: {
      name: true,
      slug: true,
      subscription: { select: { stripeCustomerId: true } },
    },
  });
  if (!org) return { error: "This workspace could not be found." };

  const existing = org.subscription?.stripeCustomerId;
  if (existing) return { id: existing };

  // The first owner is who Stripe emails receipts and dunning notices to.
  // User has no back-relation from Organization (it is scoped by column, not
  // by relation), so it is a separate read.
  const owner = await platformDb.user.findFirst({
    where: { organizationId: orgId, role: "OWNER", deletedAt: null },
    select: { email: true },
    orderBy: { createdAt: "asc" },
  });
  const customer = await getStripe().customers.create({
    name: org.name,
    email: owner?.email ?? undefined,
    // The slug is how a Stripe row is traced back to a workspace by a human
    // reading the dashboard; the id is how code does it.
    metadata: { organizationId: orgId, slug: org.slug },
  });

  await platformDb.subscription.update({
    where: { organizationId: orgId },
    data: { stripeCustomerId: customer.id },
  });
  return { id: customer.id };
}

/**
 * Send an owner to Stripe to put a card on file and start paying.
 *
 * A workspace already paying is sent to the billing portal instead: creating a
 * second subscription for the same company is the expensive mistake here, and
 * it is much easier to prevent than to refund.
 */
export async function startSubscriptionCheckout(input: {
  orgId: string;
  plan: OrgPlan;
  interval: BillingIntervalKey;
}): Promise<BillingResult> {
  const def = PLANS[input.plan];
  if (!def) return { ok: false, message: "That plan does not exist." };
  if (!def.selfServe) {
    return { ok: false, message: `${def.label} is arranged with us rather than bought online.` };
  }
  const amount = priceFor(input.plan, input.interval);
  if (amount == null) {
    return { ok: false, message: `${def.label} is quoted rather than listed.` };
  }

  const sub = await platformDb.subscription.findUnique({
    where: { organizationId: input.orgId },
    select: { stripeSubscriptionId: true, status: true, trialEndsAt: true },
  });
  if (!sub) return { ok: false, message: "This workspace has no subscription record." };
  // Already paying: change the plan directly rather than bouncing them to the
  // billing portal. The portal can only switch plans when products have been
  // configured in the Stripe dashboard, so sending them there meant "Switch to
  // this plan" could land on a page that cannot switch plans.
  if (sub.stripeSubscriptionId && sub.status !== "CANCELED") {
    return changePlan({
      subscriptionId: sub.stripeSubscriptionId,
      orgId: input.orgId,
      plan: input.plan,
      interval: input.interval,
      amount,
    });
  }

  const customer = await customerFor(input.orgId);
  if ("error" in customer) return { ok: false, message: customer.error };

  const base = await currentAppUrl();
  const trialEndsAt = sub.trialEndsAt;
  const keepTrial =
    trialEndsAt != null && trialEndsAt.getTime() - Date.now() > MIN_TRIAL_LEAD_MS;

  try {
    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      customer: customer.id,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: amount * 100,
            recurring: { interval: input.interval === "ANNUAL" ? "year" : "month" },
            product: await productIdFor(input.plan),
          },
        },
      ],
      subscription_data: {
        ...(keepTrial ? { trial_end: Math.floor(trialEndsAt!.getTime() / 1000) } : {}),
        // Read back by the webhook. The session's own metadata does not reach
        // later subscription events, so it has to live on the subscription too.
        metadata: {
          organizationId: input.orgId,
          plan: input.plan,
          interval: input.interval,
        },
      },
      metadata: { organizationId: input.orgId, plan: input.plan, interval: input.interval },
      allow_promotion_codes: true,
      success_url: `${base}/admin/settings?tab=plan&checkout=done`,
      cancel_url: `${base}/admin/settings?tab=plan&checkout=cancelled`,
    });
    if (!session.url) return { ok: false, message: "Stripe did not return a checkout page." };
    return { ok: true, url: session.url };
  } catch (e) {
    console.error("[billing] checkout failed", e);
    return { ok: false, message: "Could not open the payment page. Nothing was charged." };
  }
}

/**
 * Move an existing subscription onto a different plan or billing cycle.
 *
 * Stripe prorates: moving up mid-month bills the difference now, moving down
 * leaves a credit against the next invoice. That is the behaviour a customer
 * expects, and doing it any other way means answering billing questions by
 * hand forever.
 *
 * No checkout page and no redirect — the card is already on file, so the
 * change simply happens and the caller is sent back to the settings page.
 */
async function changePlan(input: {
  subscriptionId: string;
  orgId: string;
  plan: OrgPlan;
  interval: BillingIntervalKey;
  amount: number;
}): Promise<BillingResult> {
  const stripe = getStripe();
  try {
    const current = await stripe.subscriptions.retrieve(input.subscriptionId);
    const item = current.items?.data?.[0];
    if (!item) return { ok: false, message: "That subscription has nothing to change." };

    await stripe.subscriptions.update(input.subscriptionId, {
      items: [
        {
          id: item.id,
          price_data: {
            currency: "usd",
            product: await productIdFor(input.plan),
            recurring: { interval: input.interval === "ANNUAL" ? "year" : "month" },
            unit_amount: input.amount * 100,
          },
        },
      ],
      proration_behavior: "create_prorations",
      // The webhook reads these back to update our own row.
      metadata: {
        organizationId: input.orgId,
        plan: input.plan,
        interval: input.interval,
      },
    });

    const base = await currentAppUrl();
    return { ok: true, url: `${base}/admin/settings?tab=plan&plan=changed` };
  } catch (e) {
    console.error("[billing] plan change failed", e);
    return {
      ok: false,
      message: "Could not change the plan just now. Nothing was charged or changed.",
    };
  }
}

/** Stripe's own page for changing the card, seeing invoices, or cancelling. */
export async function openBillingPortal(orgId: string): Promise<BillingResult> {
  const sub = await platformDb.subscription.findUnique({
    where: { organizationId: orgId },
    select: { stripeCustomerId: true },
  });
  if (!sub?.stripeCustomerId) {
    return { ok: false, message: "There is no billing account yet. Choose a plan first." };
  }
  const base = await currentAppUrl();
  try {
    const portal = await getStripe().billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${base}/admin/settings?tab=plan`,
    });
    return { ok: true, url: portal.url };
  } catch (e) {
    console.error("[billing] portal failed", e);
    return { ok: false, message: "Could not open the billing page just now." };
  }
}
