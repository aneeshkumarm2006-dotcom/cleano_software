// Bookmops' own billing: charging a cleaning company for using the platform.
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

import type Stripe from "stripe";
import type { BillingInterval, OrgPlan, SubscriptionStatus } from "@prisma/client";

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
 * fills with hundreds of identical "Bookmops Starter" entries and the reporting
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
      await stripe.products.create({ id, name: `Bookmops ${PLANS[plan].label}` });
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
 * Stripe statuses that mean this workspace has ALREADY been sold something.
 *
 * "incomplete" is deliberately absent: that subscription's first payment never
 * went through, so treating it as live would lock a workspace whose card was
 * declined out of buying at all. Stripe expires those on its own within a day.
 */
const LIVE_STRIPE_STATUSES: ReadonlySet<string> = new Set([
  "trialing",
  "active",
  "past_due",
  "unpaid",
]);

/** Which one to believe when a customer somehow carries more than one. */
const STATUS_RANK: Record<string, number> = { active: 4, trialing: 3, past_due: 2, unpaid: 1 };

/** Stripe's statuses in our words. Deliberately the same mapping the
 *  subscription webhook uses; unknown ones leave the row alone. */
function mapStatus(s: string): SubscriptionStatus | null {
  switch (s) {
    case "trialing":
      return "TRIALING";
    case "active":
      return "ACTIVE";
    case "past_due":
    case "unpaid":
      return "PAST_DUE";
    case "canceled":
    case "incomplete_expired":
      return "CANCELED";
    default:
      return null;
  }
}

/** When the paid-for period runs out. Stripe moved this from the subscription
 *  onto its items, so both places are read. */
function periodEndOf(sub: Stripe.Subscription): Date | null {
  const item = sub.items?.data?.[0] as { current_period_end?: number } | undefined;
  const raw =
    item?.current_period_end ??
    (sub as unknown as { current_period_end?: number }).current_period_end;
  return typeof raw === "number" ? new Date(raw * 1000) : null;
}

function isPlanKey(v: unknown): v is OrgPlan {
  return v === "STARTER" || v === "PROFESSIONAL" || v === "ORGANIZATION";
}
function isIntervalKey(v: unknown): v is BillingInterval {
  return v === "MONTHLY" || v === "ANNUAL";
}

/**
 * Write what Stripe says about a subscription onto the workspace's row.
 *
 * The same facts applySubscription() writes in /api/stripe/subscription, on
 * purpose: that webhook is the piece that goes missing — an unset signing
 * secret, a deployment Stripe cannot reach, one failed delivery — and every
 * decision downstream, including whether to sell another subscription, is made
 * from this row. It must be able to catch up without the webhook.
 */
async function writeSubscriptionRow(orgId: string, sub: Stripe.Subscription): Promise<void> {
  const status = mapStatus(sub.status);
  const end = periodEndOf(sub);
  const plan = sub.metadata?.plan;
  const interval = sub.metadata?.interval;
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;

  try {
    await platformDb.subscription.update({
      where: { organizationId: orgId },
      data: {
        stripeSubscriptionId: sub.id,
        ...(customer ? { stripeCustomerId: customer } : {}),
        ...(status ? { status } : {}),
        ...(end ? { currentPeriodEnd: end } : {}),
        ...(isPlanKey(plan) ? { plan } : {}),
        ...(isIntervalKey(interval) ? { interval } : {}),
        cancelAtPeriodEnd: sub.cancel_at_period_end === true,
        // Once Stripe is the source of truth, our own trial date stops being
        // one — otherwise the trial cron chases a paying customer.
        ...(status === "ACTIVE" ? { trialEndsAt: null } : {}),
      },
    });
  } catch (e) {
    // Worth knowing about, never worth failing the click over: the caller's
    // decision not to sell a second subscription stands either way.
    console.error("[billing] could not write the subscription row", e);
  }
}

/**
 * Ask Stripe what this customer is actually subscribed to, and write it down.
 *
 * Returns the subscription the workspace is already being billed for, or null
 * when Stripe says there genuinely is none. `{ ok: false }` means we could not
 * find out — never "there is none", because with money involved those two have
 * to lead to different decisions.
 */
async function adoptLiveStripeSubscription(
  orgId: string,
  customerId: string,
): Promise<{ ok: true; subscriptionId: string | null } | { ok: false }> {
  let live: Stripe.Subscription[];
  try {
    const list = await getStripe().subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
    });
    live = list.data.filter((s) => LIVE_STRIPE_STATUSES.has(s.status));
  } catch (e) {
    console.error("[billing] could not read subscriptions from Stripe", e);
    return { ok: false };
  }
  if (live.length === 0) return { ok: true, subscriptionId: null };

  live.sort(
    (a, b) => (STATUS_RANK[b.status] ?? 0) - (STATUS_RANK[a.status] ?? 0) || b.created - a.created,
  );
  const [chosen, ...extra] = live;

  if (extra.length > 0) {
    // Duplicates sold before this guard existed. Said loudly and then left
    // alone: which of a customer's subscriptions to cancel and refund is a
    // decision for a human with the invoices in front of them, not something
    // a page load should do to somebody's billing.
    console.error(
      `[billing] workspace ${orgId} has ${live.length} live Stripe subscriptions; adopting ` +
        `${chosen.id} and leaving ${extra.map((s) => s.id).join(", ")} for a human to sort out`,
    );
  }

  await writeSubscriptionRow(orgId, chosen);
  return { ok: true, subscriptionId: chosen.id };
}

/**
 * Can this row be trusted to name the subscription Stripe is billing?
 *
 * Only when it carries an id AND does not claim the subscription is over. A
 * CANCELED row holding a stale id is the other way our own record ends up
 * describing a workspace that is in fact paying right now.
 */
function rowNamesLiveSubscription(row: {
  stripeSubscriptionId: string | null;
  status: SubscriptionStatus;
}): boolean {
  return Boolean(row.stripeSubscriptionId) && row.status !== "CANCELED";
}

/**
 * Bring a workspace's row back in line with Stripe when it may be behind.
 *
 * Called on the way into the plan page, so what an owner reads is what Stripe
 * holds. Without it the page said "29 days left on your free trial" and "No
 * card on file" to a workspace that had already paid — and that sentence is
 * what invited the next click, and the next duplicate subscription.
 *
 * Free on the happy path: a row that already names a live subscription, or a
 * workspace that has never had a Stripe customer, makes no Stripe call at all.
 */
export async function reconcileSubscriptionFromStripe(orgId: string): Promise<void> {
  const row = await platformDb.subscription.findUnique({
    where: { organizationId: orgId },
    select: { stripeSubscriptionId: true, stripeCustomerId: true, status: true },
  });
  if (!row?.stripeCustomerId || rowNamesLiveSubscription(row)) return;
  await adoptLiveStripeSubscription(orgId, row.stripeCustomerId);
}

/**
 * Send an owner to Stripe to put a card on file and start paying.
 *
 * A workspace already paying has its plan changed instead: creating a second
 * subscription for the same company is the expensive mistake here, and it is
 * much easier to prevent than to refund.
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
    select: {
      stripeSubscriptionId: true,
      stripeCustomerId: true,
      status: true,
      trialEndsAt: true,
    },
  });
  if (!sub) return { ok: false, message: "This workspace has no subscription record." };

  // Whether this workspace is already paying is decided by STRIPE, not by our
  // row.
  //
  // Our row only learns stripeSubscriptionId from the subscription webhook,
  // and that webhook is the part most likely to be missing. When it never
  // fires the id stays NULL for a workspace that is already being billed, this
  // read used to fall straight through, and every plan click opened another
  // checkout and sold ANOTHER concurrent subscription on the same customer —
  // three of them, in a few clicks, in testing. So whenever the row cannot be
  // trusted, ask the account that actually took the money before selling.
  let subscriptionId: string | null = rowNamesLiveSubscription(sub)
    ? sub.stripeSubscriptionId
    : null;

  if (!subscriptionId && sub.stripeCustomerId) {
    const found = await adoptLiveStripeSubscription(input.orgId, sub.stripeCustomerId);
    if (!found.ok) {
      // Could not find out. Refuse rather than guess: a checkout we should not
      // have opened costs a customer a duplicate subscription, and a checkout
      // opened a minute later costs them a minute.
      return {
        ok: false,
        message:
          "Could not check your billing status with Stripe just now. Nothing was charged — please try again in a moment.",
      };
    }
    subscriptionId = found.subscriptionId;
  }

  // Already paying: change the plan directly rather than bouncing them to the
  // billing portal. The portal can only switch plans when products have been
  // configured in the Stripe dashboard, so sending them there meant "Switch to
  // this plan" could land on a page that cannot switch plans.
  if (subscriptionId) {
    return changePlan({
      subscriptionId,
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

    const updated = await stripe.subscriptions.update(input.subscriptionId, {
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

    // Record the change ourselves instead of waiting to be told about it. The
    // webhook writes the same thing, but when it is not wired up the settings
    // page would otherwise still show the old plan — and a plan that looks
    // unchanged is what gets clicked again.
    await writeSubscriptionRow(input.orgId, updated);

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
