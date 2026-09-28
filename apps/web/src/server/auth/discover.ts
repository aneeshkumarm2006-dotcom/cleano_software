// "Which workspace do I belong to?", answered without telling strangers.
//
// Moved here from app/(auth)/sign-in/discover.ts so the web's front door and
// the phone's sign-in (POST /api/v1/auth/workspaces) share one implementation
// and one set of counters. The web action is now a thin adapter over this and
// behaves exactly as before; see that file for the reasoning behind the
// password-first design.
//
// This is the only place in the product that reads across organizations to
// authenticate, so it is deliberately narrow: it returns names and slugs and
// nothing else, and never says WHY it refused.
import "server-only";

import { hashPassword, verifyPassword } from "better-auth/crypto";

import { platformDb } from "@/lib/platform-db";
import { sharedLimitHit } from "@/lib/shared-rate-limit";
import { originForSlug, PLATFORM_ORG_SLUG } from "@/lib/tenant";

export interface DiscoveredWorkspace {
  orgId: string;
  slug: string;
  name: string;
  origin: string;
}

export type DiscoveryOutcome =
  | { kind: "ok"; workspaces: DiscoveredWorkspace[] }
  | { kind: "refused" }
  | { kind: "limited" };

/**
 * Attempts per address, and per email, per window.
 *
 * Two layers. In memory first, per instance: free, and stops a burst before
 * it costs a query. Then the same limits counted in Postgres across every
 * instance (lib/shared-rate-limit.ts; emails and addresses are stored only as
 * keyed digests), plus a slower per-email hourly cap, so spreading guesses
 * over Vercel's instances or over time doesn't multiply them. A Vercel WAF
 * rule in front of /api/v1/auth/* is still recommended (owner action).
 */
const ATTEMPTS = new Map<string, { n: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 8;
/** Per email per hour, shared: a slow, patient guesser. */
const EMAIL_HOURLY = { max: 40, windowMs: 60 * 60_000 };

function rateLimited(key: string): boolean {
  const now = Date.now();
  // Keys include emails, which a caller chooses, so expired windows are
  // dropped rather than left to grow the map without bound.
  if (ATTEMPTS.size > 5_000) {
    for (const [k, v] of ATTEMPTS) if (v.resetAt < now) ATTEMPTS.delete(k);
  }
  const hit = ATTEMPTS.get(key);
  if (!hit || hit.resetAt < now) {
    ATTEMPTS.set(key, { n: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  hit.n += 1;
  return hit.n > MAX_ATTEMPTS;
}

/**
 * The shared layer. Fails closed: if the counters can't be reached, the
 * attempt is refused as limited rather than let through unmetered.
 */
async function sharedLimited(ip: string, email: string): Promise<boolean> {
  try {
    const window = { max: MAX_ATTEMPTS, windowMs: WINDOW_MS };
    const [byIp, byEmail, byEmailHour] = await Promise.all([
      sharedLimitHit("discover:ip", ip, window),
      sharedLimitHit("discover:email", email, window),
      sharedLimitHit("discover:email:hour", email, EMAIL_HOURLY),
    ]);
    return byIp || byEmail || byEmailHour;
  } catch (e) {
    console.error(JSON.stringify({ at: "discover.shared-limit", error: String(e).slice(0, 200) }));
    return true;
  }
}

/**
 * A hash nobody's password matches, checked when an email has no account, so
 * "no such account" and "wrong password" take the same time.
 */
let dummyHash: Promise<string> | undefined;
function hashNobodyHas(): Promise<string> {
  dummyHash ??= hashPassword(crypto.randomUUID());
  return dummyHash;
}

export interface DiscoverOptions {
  /** Leave Bookmops' own workspace out. The web's staff door needs it; the apps never do. */
  excludePlatform?: boolean;
  /**
   * Run at least this many password checks, real or dummy, so the answer's
   * timing doesn't say how many companies the email belongs to (up to this
   * many). The web's form keeps its original single padding check.
   */
  minChecks?: number;
}

export async function discoverWorkspacesFor(
  emailRaw: string,
  password: string,
  ip: string,
  opts: DiscoverOptions = {},
): Promise<DiscoveryOutcome> {
  const email = emailRaw.trim().toLowerCase();
  if (!email || !password) return { kind: "refused" };

  // Per address AND per email. Per address alone let one attacker spread
  // guesses for a single person's password across many addresses.
  if (rateLimited(`ip:${ip}`) || rateLimited(`email:${email}`)) {
    return { kind: "limited" };
  }
  if (await sharedLimited(ip, email)) return { kind: "limited" };

  // A suspended or cancelled workspace is left out here rather than refused
  // later, so "your company stopped paying" is not distinguishable from "wrong
  // password" to someone who is only guessing.
  const orgs = await platformDb.organization.findMany({
    where: {
      status: "ACTIVE",
      ...(opts.excludePlatform ? { slug: { not: PLATFORM_ORG_SLUG } } : {}),
    },
    select: { id: true, slug: true, name: true },
  });
  const byId = new Map(orgs.map((o) => [o.id, o]));

  const candidates = await platformDb.user.findMany({
    where: {
      email,
      isActive: true,
      // Archived people are refused at sign-in, so listing their workspace
      // would only lead them to a door that will not open.
      deletedAt: null,
      organizationId: { in: orgs.map((o) => o.id) },
    },
    select: {
      organizationId: true,
      accounts: {
        where: { providerId: "credential" },
        select: { password: true },
      },
    },
  });

  const matched: DiscoveredWorkspace[] = [];
  let checked = 0;
  for (const user of candidates) {
    const org = byId.get(user.organizationId);
    if (!org) continue;
    // Each membership is a separate account row with its own hash, so someone
    // in two workspaces may well have two different passwords. Check each; a
    // match in one says nothing about the other.
    for (const account of user.accounts) {
      if (!account.password) continue;
      checked++;
      if (await verifyPassword({ hash: account.password, password })) {
        matched.push({ orgId: org.id, slug: org.slug, name: org.name, origin: originForSlug(org.slug) });
        break;
      }
    }
  }

  const padTo = Math.max(1, opts.minChecks ?? 1);
  for (let i = checked; i < padTo; i++) {
    await verifyPassword({ hash: await hashNobodyHas(), password });
  }

  if (matched.length === 0) return { kind: "refused" };
  return { kind: "ok", workspaces: matched };
}
