import { NextRequest } from "next/server";
import type Stripe from "stripe";

import { getStripe } from "@/lib/stripe";
import { platformDb } from "@/lib/platform-db";
import { runAsOrg } from "@/lib/org-context";
import { logActivity } from "@/lib/activity-log";
import { sendBillingPaymentFailed } from "@/lib/email";
import { PLANS } from "@/lib/plans";
import type { BillingInterval, OrgPlan, SubscriptionStatus } from "@prisma/client";

/**
 * Awer's OWN billing webhook: money coming from cleaning companies to us.
 *
 * Deliberately a different route, a different Stripe account and a different
 * signing secret from /api/stripe/webhook, which handles each company charging
 * its own customers. One route serving both would mean one leaked secret, or
 * one confused event, moving money in the wrong direction.
 *
 * Setup: in Awer's Stripe dashboard add an endpoint at
 *   https://<apex>/api/stripe/subscription
 * for checkout.session.completed, customer.subscription.updated,
 * customer.subscription.deleted, invoice.paid and invoice.payment_failed,
 * then set STRIPE_SUBSCRIPTION_WEBHOOK_SECRET to its signing secret.
 *
 * Ships dark: with the secret unset the route acknowledges and ignores, so
 * deploying before Stripe is configured changes nothing.
 */

export const runtime = "nodejs";

const ok = () => Response.json({ received: true });

/** Stripe's statuses, in our words. Unknown ones leave the row alone. */
function mapStatus(s: Stripe.Subscription.Status): SubscriptionStatus | null {
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
    // "incomplete" means checkout was never finished. It is not a paying
    // state and it is not a cancellation, so say nothing rather than guess.
    default:
      return null;
  }
}

/**
 * When the paid-for period runs out.
 *
 * Stripe moved current_period_end from the subscription onto its items, and
 * which one carries it depends on the API version the event was created with.
 * Reading both is how this keeps working across a version bump instead of
 * silently writing null the day Stripe changes.
 */
function periodEnd(sub: Stripe.Subscription): Date | null {
  const item = sub.items?.data?.[0] as { current_period_end?: number } | undefined;
  const raw =
    item?.current_period_end ??
    (sub as unknown as { current_period_end?: number }).current_period_end;
  return typeof raw === "number" ? new Date(raw * 1000) : null;
}

/** Which workspace this subscription belongs to. Metadata first, then the ids. */
async function orgIdFor(sub: Stripe.Subscription): Promise<string | null> {
  const fromMeta = sub.metadata?.organizationId;
  if (fromMeta) return fromMeta;
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  const row = await platformDb.subscription.findFirst({
    where: {
      OR: [
        { stripeSubscriptionId: sub.id },
        ...(customer ? [{ stripeCustomerId: customer }] : []),
      ],
    },
    select: { organizationId: true },
  });
  return row?.organizationId ?? null;
}

function isPlan(v: unknown): v is OrgPlan {
  return v === "STARTER" || v === "PROFESSIONAL" || v === "ORGANIZATION";
}
function isInterval(v: unknown): v is BillingInterval {
  return v === "MONTHLY" || v === "ANNUAL";
}

/** Write what Stripe just told us onto the workspace's subscription row. */
async function applySubscription(sub: Stripe.Subscription): Promise<void> {
  const organizationId = await orgIdFor(sub);
  if (!organizationId) {
    console.error("[billing] no workspace for Stripe subscription", sub.id);
    return;
  }

  const status = mapStatus(sub.status);
  const end = periodEnd(sub);
  const plan = sub.metadata?.plan;
  const interval = sub.metadata?.interval;
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;

  const existing = await platformDb.subscription.findUnique({
    where: { organizationId },
    select: { status: true, plan: true },
  });

  await platformDb.subscription.update({
    where: { organizationId },
    data: {
      stripeSubscriptionId: sub.id,
      ...(customer ? { stripeCustomerId: customer } : {}),
      ...(status ? { status } : {}),
      ...(end ? { currentPeriodEnd: end } : {}),
      ...(isPlan(plan) ? { plan } : {}),
      ...(isInterval(interval) ? { interval } : {}),
      cancelAtPeriodEnd: sub.cancel_at_period_end === true,
      // Once Stripe is the source of truth, our own trial date stops being
      // one. Leaving it set would have the trial cron chasing a paying
      // customer about a trial that already converted.
      ...(status === "ACTIVE" ? { trialEndsAt: null } : {}),
    },
  });

  // The workspace's own log, so an owner can see why access changed without
  // asking us. Never throws — a log must not fail a webhook into a retry.
  if (status && status !== existing?.status) {
    const org = await platformDb.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, slug: true, name: true, timezone: true },
    });
    if (org) {
      // Tell them their payment failed, in their own workspace and inbox.
      // Only on the TRANSITION into PAST_DUE: Stripe retries a failed card
      // several times over a couple of weeks, and a mail per retry turns a
      // fixable problem into something they mute.
      if (status === "PAST_DUE") {
        await runAsOrg(org, () =>
          sendBillingPaymentFailed({
            // Falls back to the row's own plan when Stripe's metadata is thin,
            // so the email never says "your undefined plan".
            planLabel: PLANS[isPlan(plan) ? plan : (existing?.plan ?? "STARTER")].label,
          }),
        ).catch((e) => console.error("[billing] payment-failed notice", e));
      }

      await runAsOrg(org, () =>
        logActivity({
          category: "PAYMENT",
          action: "subscription.status",
          status: status === "PAST_DUE" || status === "CANCELED" ? "FAILED" : "SUCCESS",
          message:
            status === "ACTIVE"
              ? "The Awer subscription is active."
              : status === "TRIALING"
                ? "The Awer subscription is in its trial."
                : status === "PAST_DUE"
                  ? "A payment for the Awer subscription failed. Update the card to avoid interruption."
                  : "The Awer subscription has ended.",
        }),
      ).catch(() => {});
    }
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET;
  if (!secret) return ok(); // not configured yet — acknowledge and ignore

  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("missing signature", { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, secret);
  } catch {
    return new Response("invalid signature", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") break;
        const subId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;
        if (!subId) break;
        // Re-fetch rather than trusting the thin object on the session: the
        // full subscription carries the status, period and metadata we store.
        const sub = await getStripe().subscriptions.retrieve(subId);
        // The session knows the workspace even when the subscription's own
        // metadata has not propagated yet.
        if (!sub.metadata?.organizationId && session.metadata?.organizationId) {
          sub.metadata = { ...sub.metadata, ...session.metadata };
        }
        await applySubscription(sub);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await applySubscription(event.data.object as Stripe.Subscription);
        break;
      }
      case "invoice.paid":
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice & {
          subscription?: string | Stripe.Subscription | null;
        };
        const subId =
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription?.id;
        if (!subId) break;
        await applySubscription(await getStripe().subscriptions.retrieve(subId));
        break;
      }
      default:
        break;
    }
  } catch (e) {
    // A 500 makes Stripe retry, which is right for a transient fault and
    // wrong for a permanent one. Log loudly and accept: the nightly
    // reconciliation is what catches anything genuinely missed.
    console.error(`[billing] webhook ${event.type} failed`, e);
  }

  return ok();
}
