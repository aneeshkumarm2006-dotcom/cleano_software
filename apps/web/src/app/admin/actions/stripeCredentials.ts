"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import Stripe from "stripe";

import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { requireOrgId } from "@/lib/org";
import { platformDb } from "@/lib/platform-db";
import { canStoreSecrets, hint, seal } from "@/lib/secret-box";
import { orgStripeStatus } from "@/lib/stripe-org";

/**
 * Connecting a cleaning company's own Stripe account.
 *
 * Until now one key served the whole platform, which meant a second company's
 * customers would have paid into the first company's account. Each workspace
 * now brings its own, and a workspace with none simply cannot take cards.
 *
 * The secret and the webhook signing secret are encrypted before they are
 * stored; the publishable key is public by design and is not.
 */

type Result = { ok: true; hint: string | null } | { ok: false; error: string };

type AdminOrg = { organizationId: string; userId: string } | { error: string };

async function requireAdminOrg(): Promise<AdminOrg> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") return { error: "Not authorized" };
  return { organizationId: await requireOrgId(), userId: session.user.id };
}

/** Shape checks only — Stripe itself is the authority, and it is asked below. */
function looksLikeSecretKey(v: string): boolean {
  return /^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(v);
}
function looksLikePublishableKey(v: string): boolean {
  return /^pk_(test|live)_[A-Za-z0-9]+$/.test(v);
}

export async function saveStripeCredentials(input: {
  secretKey: string;
  publishableKey: string;
  webhookSecret?: string;
}): Promise<Result> {
  const a = await requireAdminOrg();
  if ("error" in a) return { ok: false, error: a.error };

  if (!canStoreSecrets()) {
    return {
      ok: false,
      error:
        "This deployment cannot store credentials yet: SECRETS_KEY is not set. Ask your administrator to add one.",
    };
  }

  const secretKey = input.secretKey.trim();
  const publishableKey = input.publishableKey.trim();
  const webhookSecret = input.webhookSecret?.trim() ?? "";

  if (!looksLikeSecretKey(secretKey)) {
    return { ok: false, error: "That does not look like a Stripe secret key. It starts with sk_ or rk_." };
  }
  if (!looksLikePublishableKey(publishableKey)) {
    return { ok: false, error: "That does not look like a Stripe publishable key. It starts with pk_." };
  }
  // Live and test keys are not interchangeable, and mixing them fails at the
  // worst moment — the card form loads and the charge is refused.
  const mode = (k: string) => (k.includes("_live_") ? "live" : "test");
  if (mode(secretKey) !== mode(publishableKey)) {
    return {
      ok: false,
      error: `Those keys are from different Stripe modes — the secret key is ${mode(secretKey)} and the publishable key is ${mode(publishableKey)}. Use a matching pair.`,
    };
  }
  if (webhookSecret && !webhookSecret.startsWith("whsec_")) {
    return { ok: false, error: "A webhook signing secret starts with whsec_." };
  }

  // Ask Stripe whether the key actually works, rather than saving something
  // that only fails later, in front of a customer, mid-payment.
  try {
    const probe = new Stripe(secretKey, { apiVersion: "2026-04-22.dahlia" });
    await probe.balance.retrieve();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Stripe rejected that key: ${msg}` };
  }

  await platformDb.organization.update({
    where: { id: a.organizationId },
    data: {
      stripeSecretKeyEnc: seal(secretKey),
      stripePublishableKey: publishableKey,
      stripeKeyHint: hint(secretKey),
      stripeConnectedAt: new Date(),
      // Only overwrite the webhook secret when one was supplied, so re-saving
      // the keys does not silently unhook a working endpoint.
      ...(webhookSecret ? { stripeWebhookSecretEnc: seal(webhookSecret) } : {}),
    },
  });

  // The key itself is never logged — only that it changed, and its last four.
  await logActivity({
    category: "ADMIN",
    action: "settings.stripe.connected",
    actorId: a.userId,
    message: `Stripe account connected (${mode(secretKey)} mode, key ending ${hint(secretKey)})`,
  }).catch(() => {});

  revalidatePath("/admin/settings");
  return { ok: true, hint: hint(secretKey) };
}

export async function disconnectStripe(): Promise<Result> {
  const a = await requireAdminOrg();
  if ("error" in a) return { ok: false, error: a.error };

  await platformDb.organization.update({
    where: { id: a.organizationId },
    data: {
      stripeSecretKeyEnc: null,
      stripePublishableKey: null,
      stripeWebhookSecretEnc: null,
      stripeKeyHint: null,
      stripeConnectedAt: null,
    },
  });

  await logActivity({
    category: "ADMIN",
    action: "settings.stripe.disconnected",
    actorId: a.userId,
    message: "Stripe account disconnected — this workspace can no longer take card payments",
  }).catch(() => {});

  revalidatePath("/admin/settings");
  return { ok: true, hint: null };
}

/** What the settings page shows. Never returns a secret. */
export async function readStripeStatus() {
  const a = await requireAdminOrg();
  if ("error" in a) return null;

  const [status, org] = await Promise.all([
    orgStripeStatus(),
    platformDb.organization.findUnique({
      where: { id: a.organizationId },
      select: { stripeKeyHint: true, stripeConnectedAt: true },
    }),
  ]);

  return {
    ...status,
    keyHint: org?.stripeKeyHint ?? null,
    connectedAt: org?.stripeConnectedAt ?? null,
    canStoreSecrets: canStoreSecrets(),
  };
}
