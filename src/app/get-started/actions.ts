"use server";

/**
 * Public signup: a cleaning company creating its own workspace.
 *
 * This is the only unauthenticated endpoint in the product that creates an
 * organization and a user, so it is written defensively. Everything the browser
 * sends is re-validated here; the form's checks exist to be helpful, not to be
 * trusted.
 */
import { headers } from "next/headers";

import { platformDb } from "@/lib/platform-db";
import { PLANS } from "@/lib/plans";
import {
  ProvisioningError,
  findFreeSlug,
  provisionOrganization,
  slugify,
} from "@/lib/provisioning";
import { RESERVED_SLUGS, isValidOrgSlug, workspaceOriginFor } from "@/lib/tenant";

import type { OrgPlan } from "@prisma/client";

/** Plans a visitor may pick without talking to anyone. Allowlist, not an `in` check. */
const SELF_SERVE: OrgPlan[] = (["STARTER", "PROFESSIONAL"] as OrgPlan[]).filter(
  (p) => PLANS[p].selfServe,
);

const MIN_PASSWORD = 10;
const MAX_FIELD = 120;

export type SlugState =
  | { ok: true; slug: string }
  | { ok: false; slug: string; reason: string };

export type SignupResult =
  | { ok: true; slug: string; url: string | null; email: string; trialEndsAt: string }
  | { ok: false; field: "company" | "slug" | "name" | "email" | "password" | "plan" | "form"; message: string };

// ---------------------------------------------------------------------------
// Throttling
// ---------------------------------------------------------------------------

/**
 * Two limits, because neither is sufficient alone.
 *
 * The per-address window lives in memory, so it only covers one running
 * instance and resets on deploy — it stops a script hammering one box, not a
 * distributed attempt. The global hourly cap is a database count, so it holds
 * across every instance, and it is set well above any believable real signup
 * rate: at that point something is wrong and a person should look.
 *
 * A durable per-address limit needs somewhere shared to keep counters. Worth
 * doing when signup volume is real; a comment is worth more than a limit that
 * pretends to be something it is not.
 */
const WINDOW_MS = 60 * 60 * 1000;
const PER_ADDRESS_PER_HOUR = 5;
const GLOBAL_PER_HOUR = 40;
/**
 * Address lookups get a far higher ceiling than signups: a real visitor types,
 * pauses, and retypes, and each keystroke burst is one debounced call. It is
 * still bounded, because this is a database query anyone can trigger.
 */
const LOOKUPS_PER_HOUR = 200;

const attempts = new Map<string, number[]>();

function tooMany(key: string, limit: number): boolean {
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  attempts.set(key, recent);

  // Keep the map from growing without bound on a long-lived instance.
  if (attempts.size > 5_000) {
    for (const [k, times] of attempts) {
      if (times.every((t) => now - t >= WINDOW_MS)) attempts.delete(k);
    }
  }
  return recent.length > limit;
}

async function callerAddress(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
}

// ---------------------------------------------------------------------------
// Address availability
// ---------------------------------------------------------------------------

/**
 * Is this address free? Called as the visitor types.
 *
 * Whether a subdomain exists is already public — it resolves in DNS and answers
 * requests — so this reveals nothing that a browser could not find out anyway.
 */
export async function checkSlug(raw: string): Promise<SlugState> {
  const slug = slugify(raw ?? "");

  if (tooMany(`look:${await callerAddress()}`, LOOKUPS_PER_HOUR)) {
    return { ok: false, slug, reason: "Too many checks. Wait a moment and try again." };
  }
  if (slug.length < 3) {
    return { ok: false, slug, reason: "Addresses need at least three characters." };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { ok: false, slug, reason: `"${slug}" is reserved by Awer.` };
  }
  if (!isValidOrgSlug(slug)) {
    return { ok: false, slug, reason: "Letters, numbers and single hyphens only." };
  }

  const taken = await platformDb.organization.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (taken) {
    const free = await findFreeSlug(slug).catch(() => null);
    return {
      ok: false,
      slug,
      reason: free ? `Taken. ${free} is free.` : "That address is taken.",
    };
  }
  return { ok: true, slug };
}

/** A starting suggestion from the company's name, so nobody has to invent one. */
export async function suggestSlug(companyName: string): Promise<string> {
  const base = slugify(companyName ?? "");
  if (base.length < 3) return "";
  if (tooMany(`look:${await callerAddress()}`, LOOKUPS_PER_HOUR)) return base;
  return findFreeSlug(base).catch(() => base);
}

// ---------------------------------------------------------------------------
// Signup
// ---------------------------------------------------------------------------

export async function createWorkspace(input: {
  companyName: string;
  slug: string;
  ownerName: string;
  ownerEmail: string;
  password: string;
  plan: string;
}): Promise<SignupResult> {
  const companyName = String(input.companyName ?? "").trim().slice(0, MAX_FIELD);
  const ownerName = String(input.ownerName ?? "").trim().slice(0, MAX_FIELD);
  const ownerEmail = String(input.ownerEmail ?? "").trim().toLowerCase().slice(0, MAX_FIELD);
  const password = String(input.password ?? "");
  const plan = String(input.plan ?? "") as OrgPlan;

  if (companyName.length < 2) {
    return { ok: false, field: "company", message: "Tell us the company's name." };
  }
  if (ownerName.length < 2) {
    return { ok: false, field: "name", message: "Tell us your name." };
  }
  // Deliberately loose. Address syntax is a poor test of whether an address
  // works, and rejecting a real one at signup costs a customer.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
    return { ok: false, field: "email", message: "That email address does not look right." };
  }
  if (password.length < MIN_PASSWORD) {
    return {
      ok: false,
      field: "password",
      message: `Use at least ${MIN_PASSWORD} characters. This account owns the whole workspace.`,
    };
  }
  if (!SELF_SERVE.includes(plan)) {
    return {
      ok: false,
      field: "plan",
      message: "That plan is arranged with us rather than signed up for.",
    };
  }

  const state = await checkSlug(input.slug);
  if (!state.ok) return { ok: false, field: "slug", message: state.reason };

  if (tooMany(`new:${await callerAddress()}`, PER_ADDRESS_PER_HOUR)) {
    return {
      ok: false,
      field: "form",
      message: "Too many workspaces created from here. Try again in an hour, or get in touch.",
    };
  }

  const hourAgo = new Date(Date.now() - WINDOW_MS);
  const recent = await platformDb.organization.count({
    where: { createdAt: { gte: hourAgo } },
  });
  if (recent >= GLOBAL_PER_HOUR) {
    return {
      ok: false,
      field: "form",
      message: "Signups are paused for a moment. Please try again shortly.",
    };
  }

  try {
    const result = await provisionOrganization({
      slug: state.slug,
      companyName,
      ownerName,
      ownerEmail,
      password,
      plan,
    });

    // The workspace lives on a different host than the one serving this form, so
    // the session cookie set here could never apply there. Rather than pretend
    // otherwise, hand back the address and let them sign in at their own door.
    const h = await headers();
    const proto = h.get("x-forwarded-proto") ?? "https";
    const url = workspaceOriginFor(result.slug, h.get("host"), proto);

    return {
      ok: true,
      slug: result.slug,
      url,
      email: ownerEmail,
      trialEndsAt: result.trialEndsAt.toISOString(),
    };
  } catch (e) {
    if (e instanceof ProvisioningError) {
      return {
        ok: false,
        field: e.code === "email-taken" ? "email" : e.code === "slug-invalid" || e.code === "slug-taken" ? "slug" : "form",
        message: e.message,
      };
    }
    // Never surface a database error to a stranger. Log it for us instead.
    console.error("signup failed", e);
    return {
      ok: false,
      field: "form",
      message: "Something went wrong creating the workspace. Nothing was charged — please try again.",
    };
  }
}
