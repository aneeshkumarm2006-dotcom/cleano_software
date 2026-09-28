/*
 * Not marked "server-only", matching org.ts and org-url.ts beside it.
 *
 * That marker is aliased away by Next at build time and does not exist as a
 * real package, so importing it makes this module unreachable from the
 * verification scripts — and this is precisely the module whose behaviour most
 * needs verifying. The protection is not lost: this reaches the database through platform-db, which a client bundle cannot
 * resolve, so a client component importing this still fails to build.
 */
import { cache } from "react";
import Stripe from "stripe";

import { getCurrentOrg } from "@/lib/org";
import { orgFromContext } from "@/lib/org-context";
import { platformDb } from "@/lib/platform-db";
import { open as openSecret } from "@/lib/secret-box";

/**
 * Whose Stripe account is this payment going into?
 *
 * There used to be one STRIPE_SECRET_KEY for the whole platform. Every call
 * site imported one shared client and none of them knew which company they were
 * acting for — so the moment a second cleaning company took a booking, their
 * customer's deposit would have been charged into the FIRST company's Stripe
 * account. Nothing would have failed. The money would simply have been in
 * somebody else's bank.
 *
 * So resolution is explicit, and there is no fallback:
 *
 *   1. The company's own key, pasted into their settings and stored encrypted.
 *   2. The environment's key — but ONLY for the single workspace named by
 *      STRIPE_ENV_ORG_SLUG, which is the company that key was created for.
 *   3. Otherwise: not configured. No client, no charge, and a caller that has
 *      to say so out loud.
 *
 * Step 3 is the important one. Falling back to the environment would have made
 * every new workspace "work" on day one and quietly misdirect its takings.
 */

export type StripeSource = "workspace" | "environment";

export type OrgStripe =
  | { ok: true; stripe: Stripe; source: StripeSource; publishableKey: string | null }
  | { ok: false; reason: "not-configured" | "unreadable" };

export class StripeNotConfigured extends Error {
  constructor(readonly reason: "not-configured" | "unreadable" = "not-configured") {
    super(
      reason === "unreadable"
        ? "This workspace's saved Stripe key could not be read. Re-enter it in Settings → Payments."
        : "This workspace has no Stripe account connected. Add one in Settings → Payments.",
    );
    this.name = "StripeNotConfigured";
  }
}

const API_VERSION = "2026-04-22.dahlia" as const;

/**
 * One Stripe client per secret, not per call.
 *
 * The SDK holds an HTTP agent and a connection pool, so building a fresh one for
 * every charge leaks sockets under load. Keyed by the secret itself, so rotating
 * a key in settings produces a different client rather than reusing the old one.
 */
const clients = new Map<string, Stripe>();

function clientFor(secret: string): Stripe {
  let c = clients.get(secret);
  if (!c) {
    c = new Stripe(secret, { apiVersion: API_VERSION });
    clients.set(secret, c);
  }
  return c;
}

/** The one workspace the environment's key belongs to, if any. */
function envOrgSlug(): string | null {
  return process.env.STRIPE_ENV_ORG_SLUG?.trim().toLowerCase() || null;
}

type OrgRow = {
  slug: string;
  stripeSecretKeyEnc: string | null;
  stripePublishableKey: string | null;
  stripeWebhookSecretEnc: string | null;
};

function resolve(org: OrgRow | null): OrgStripe {
  if (!org) return { ok: false, reason: "not-configured" };

  if (org.stripeSecretKeyEnc) {
    const secret = openSecret(org.stripeSecretKeyEnc);
    // A key that will not decrypt -- rotated SECRETS_KEY, a row copied between
    // environments -- must not silently fall through to somebody else's account.
    if (!secret) return { ok: false, reason: "unreadable" };
    return {
      ok: true,
      stripe: clientFor(secret),
      source: "workspace",
      publishableKey: org.stripePublishableKey ?? null,
    };
  }

  const envSlug = envOrgSlug();
  if (envSlug && org.slug === envSlug && process.env.STRIPE_SECRET_KEY) {
    return {
      ok: true,
      stripe: clientFor(process.env.STRIPE_SECRET_KEY),
      source: "environment",
      publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null,
    };
  }

  return { ok: false, reason: "not-configured" };
}

const SELECT = {
  slug: true,
  stripeSecretKeyEnc: true,
  stripePublishableKey: true,
  stripeWebhookSecretEnc: true,
} as const;

/** Stripe for a named organization. For cron, webhooks and scripts. */
const orgRow = cache(async (organizationId: string) =>
  platformDb.organization.findUnique({ where: { id: organizationId }, select: SELECT }),
);

export async function stripeForOrgId(organizationId: string): Promise<OrgStripe> {
  // Cached per request: a file that takes a payment and then reads the card
  // back asks for this several times, and it is the same answer every time.
  return resolve(await orgRow(organizationId));
}

/** Stripe for whichever company this request or job is acting for. */
export async function stripeForCurrentOrg(): Promise<OrgStripe> {
  const ctx = orgFromContext();
  if (ctx?.id) return stripeForOrgId(ctx.id);

  const org = await getCurrentOrg();
  return resolve(org);
}

/**
 * Stripe for the current company, or throw.
 *
 * For call sites that cannot meaningfully continue — taking a payment, issuing
 * a refund. The message names the settings page, because the person who can fix
 * it is usually the one reading it.
 */
export async function requireStripeForCurrentOrg(): Promise<Stripe> {
  const s = await stripeForCurrentOrg();
  if (!s.ok) throw new StripeNotConfigured(s.reason);
  return s.stripe;
}

/** The signing secret for THIS company's webhook endpoint. */
export async function webhookSecretForOrgId(organizationId: string): Promise<string | null> {
  const org = await platformDb.organization.findUnique({
    where: { id: organizationId },
    select: { slug: true, stripeWebhookSecretEnc: true },
  });
  if (!org) return null;
  if (org.stripeWebhookSecretEnc) return openSecret(org.stripeWebhookSecretEnc);

  const envSlug = envOrgSlug();
  if (envSlug && org.slug === envSlug) return process.env.STRIPE_WEBHOOK_SECRET ?? null;
  return null;
}

/** What to show on the settings page, and what the booking page needs to know. */
export async function orgStripeStatus(): Promise<{
  connected: boolean;
  source: StripeSource | null;
  reason: "not-configured" | "unreadable" | null;
  publishableKey: string | null;
  webhookConfigured: boolean;
}> {
  const org = await getCurrentOrg();
  const s = resolve(org);
  const webhookConfigured = org
    ? Boolean(org.stripeWebhookSecretEnc) ||
      (envOrgSlug() === org.slug && Boolean(process.env.STRIPE_WEBHOOK_SECRET))
    : false;

  return s.ok
    ? { connected: true, source: s.source, reason: null, publishableKey: s.publishableKey, webhookConfigured }
    : { connected: false, source: null, reason: s.reason, publishableKey: null, webhookConfigured };
}

/**
 * This company's Stripe customer for one of their clients, creating it if new.
 *
 * Two things were wrong with the version this replaces, and both were in the
 * money path. It reached for the UNSCOPED Prisma client, so a clientId from one
 * company would happily read and write another company's row; and it used the
 * one global Stripe key, so the customer was created in whichever account that
 * key belonged to. The scoped client fixes the first — a foreign id now finds
 * nothing — and the resolver above fixes the second.
 *
 * A Stripe customer id belongs to ONE Stripe account. When a workspace changes
 * its keys, previously saved ids stop resolving in the new account; that is a
 * property of Stripe, not something this can paper over, and settings warns
 * about it when a key is replaced.
 */
export async function getOrCreateStripeCustomer(
  clientId: string,
  email: string,
  name: string,
): Promise<string> {
  const { db } = await import("@/lib/org-db");
  const stripe = await requireStripeForCurrentOrg();

  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { stripeCustomerId: true },
  });
  if (!client) throw new Error("No such client in this workspace.");
  if (client.stripeCustomerId) return client.stripeCustomerId;

  const customer = await stripe.customers.create({ email, name, metadata: { clientId } });
  await db.client.update({ where: { id: clientId }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}
