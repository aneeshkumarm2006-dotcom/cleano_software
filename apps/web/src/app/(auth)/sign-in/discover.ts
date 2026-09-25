"use server";

import { headers } from "next/headers";

import { discoverWorkspacesFor } from "@/server/auth/discover";

/**
 * "Which workspace do I belong to?", answered without telling strangers.
 *
 * Bookmops' front door has no idea which company a visitor works for, and the
 * obvious design -- type your email, get sent to your workspace -- is a
 * cross-tenant enumeration oracle: anyone could probe addresses to learn which
 * cleaning companies use Bookmops and who works there. That is the exact class of
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

export async function discoverWorkspaces(
  emailRaw: string,
  password: string,
): Promise<DiscoverResult> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  // The rules, the counters and the cross-organization read now live in one
  // service shared with the phone's sign-in (server/auth/discover.ts). This
  // adapter keeps the web's answers word for word.
  const outcome = await discoverWorkspacesFor(emailRaw, password, ip);
  if (outcome.kind === "limited") {
    return { ok: false, error: "Too many attempts. Wait a minute and try again." };
  }
  if (outcome.kind === "refused") return REFUSED;
  return {
    ok: true,
    workspaces: outcome.workspaces.map((w) => ({ slug: w.slug, name: w.name, origin: w.origin })),
  };
}
