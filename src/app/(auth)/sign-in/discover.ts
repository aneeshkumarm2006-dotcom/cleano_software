"use server";

import { headers } from "next/headers";
import { verifyPassword } from "better-auth/crypto";

import { platformDb } from "@/lib/platform-db";
import { originForSlug } from "@/lib/tenant";

/**
 * "Which workspace do I belong to?", answered without telling strangers.
 *
 * Awer's front door has no idea which company a visitor works for, and the
 * obvious design -- type your email, get sent to your workspace -- is a
 * cross-tenant enumeration oracle: anyone could probe addresses to learn which
 * cleaning companies use Awer and who works there. That is the exact class of
 * leak the whole tenancy model exists to prevent.
 *
 * So the password is asked for FIRST, on this page, and nothing is revealed
 * until it checks out. A stranger probing addresses gets the same refusal
 * whether or not the email exists, and learns nothing. Someone who can prove
 * who they are gets an answer immediately, with no email round-trip.
 *
 * This is the only place in the product that reads across organizations to
 * authenticate, so it is deliberately narrow: it returns names and slugs and
 * nothing else, never says WHY it refused, and takes the elevated connection
 * only to run one query.
 */

export type DiscoveredWorkspace = {
  slug: string;
  name: string;
  origin: string;
};

export type DiscoverResult =
  | { ok: true; workspaces: DiscoveredWorkspace[] }
  | { ok: false; error: string };

/**
 * One refusal for every failure: no such email, wrong password, deactivated
 * account, suspended workspace. The caller must never be able to tell these
 * apart, because the difference between them is exactly the information an
 * attacker is fishing for.
 */
const REFUSED = { ok: false as const, error: "Email or password is incorrect." };

/**
 * Attempts per address per window.
 *
 * KNOWN LIMIT, stated rather than implied: this is in memory, so it is per
 * instance, and Vercel runs several. It raises the cost of guessing without
 * ending it. The same caveat applies to better-auth's own limiter (see the note
 * in src/lib/auth.ts) and the real answer for a determined attacker is a WAF
 * rule, not this. It is here because this endpoint checks a password against
 * EVERY organization at once, which makes it a more attractive target than any
 * single workspace's login.
 */
const ATTEMPTS = new Map<string, { n: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 8;

function rateLimited(key: string): boolean {
  const now = Date.now();
  const hit = ATTEMPTS.get(key);
  if (!hit || hit.resetAt < now) {
    ATTEMPTS.set(key, { n: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  hit.n += 1;
  return hit.n > MAX_ATTEMPTS;
}

export async function discoverWorkspaces(
  emailRaw: string,
  password: string,
): Promise<DiscoverResult> {
  const email = emailRaw.trim().toLowerCase();
  if (!email || !password) return REFUSED;

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) {
    return { ok: false, error: "Too many attempts. Wait a minute and try again." };
  }

  // Reading across organizations. `platformDb` is the elevated connection, and
  // needing it is the reason this lives in its own file -- everything else in
  // the product goes through the org-scoped client on purpose.
  //
  // A suspended or cancelled workspace is left out here rather than refused
  // later, so "your company stopped paying" is not distinguishable from "wrong
  // password" to someone who is only guessing.
  const orgs = await platformDb.organization.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, slug: true, name: true },
  });
  const byId = new Map(orgs.map((o) => [o.id, o]));

  const candidates = await platformDb.user.findMany({
    where: {
      email,
      isActive: true,
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
  for (const user of candidates) {
    const org = byId.get(user.organizationId);
    if (!org) continue;
    // Each membership is a separate account row with its own hash, so someone
    // in two workspaces may well have two different passwords. Check each; a
    // match in one says nothing about the other.
    for (const account of user.accounts) {
      if (!account.password) continue;
      if (await verifyPassword({ hash: account.password, password })) {
        matched.push({
          slug: org.slug,
          name: org.name,
          origin: originForSlug(org.slug),
        });
        break;
      }
    }
  }

  if (matched.length === 0) return REFUSED;
  return { ok: true, workspaces: matched };
}
