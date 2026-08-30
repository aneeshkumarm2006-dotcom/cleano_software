import { headers } from "next/headers";

import { orgFromContext } from "@/lib/org-context";
import {
  DEFAULT_ORG_SLUG,
  orgSlugFromHost,
  originForSlug,
} from "@/lib/tenant";

/**
 * The web address to put in a link that leaves the product.
 *
 * Every "View this booking", "Rate your cleaning" and password reset is an
 * absolute URL, and until now all of them were built from one environment
 * variable. One variable can only ever name one company's address, so a second
 * tenant's customers would have received links into the first tenant's
 * workspace: clicked, they would land on a login screen for a company they have
 * never heard of, and the booking they were trying to see would not be there.
 *
 * The derivation itself lives in tenant.ts beside the rest of the host handling.
 * This module is only about working out *which* organization is being served.
 *
 * Not marked "server-only", matching org.ts and tenant.ts beside it: the
 * next/headers import already makes Next reject this in a client component, and
 * the marker additionally breaks the verification scripts, which need to reach
 * it through the same import chain the application uses.
 */

export { originForSlug };

/**
 * The origin the browser actually asked for.
 *
 * For redirects back into the app, this is the only correct answer, and
 * `new URL(request.url).origin` is not it: Next does not guarantee that the URL
 * a route handler sees carries the public host, and in practice it can report
 * the server's own origin instead. On a single-domain app the difference is
 * invisible. On this one it is a broken sign-in — a redirect built that way sent
 * someone who signed in at `<company>.useawer.com` to the bare domain, where
 * their session cookie does not exist, so they arrived back at a login screen
 * having just logged in successfully.
 *
 * The Host header is what the browser asked for, so that is what is used.
 */
export async function requestOrigin(fallback = ""): Promise<string> {
  try {
    const h = await headers();
    const host = h.get("host");
    if (!host) return fallback;
    const proto =
      h.get("x-forwarded-proto") ??
      (host.startsWith("localhost") || host.includes(".localhost") ? "http" : "https");
    return `${proto}://${host}`;
  } catch {
    return fallback;
  }
}

/**
 * The address for whatever organization this code is running on behalf of.
 *
 * Three sources, in order of how specific they are:
 *
 *   1. An explicit organization context — set by cron jobs and scripts, which
 *      have no request and are usually part-way through a loop over every
 *      tenant. This has to win, or a nightly reminder for company B goes out
 *      carrying links to company A.
 *   2. The request's own host, which is where a normal page or action gets it.
 *   3. The configured default, for anything with neither.
 *
 * Never throws. A link that is slightly wrong is a bad day; an exception thrown
 * while building an email loses the email.
 */
export async function currentAppUrl(): Promise<string> {
  const ctx = orgFromContext();
  if (ctx?.slug) return originForSlug(ctx.slug);

  try {
    const h = await headers();
    // Host only — never the inbound x-awer-org header. See the note in
    // src/lib/org.ts: the proxy does not cover /api/* or dotted paths, so a
    // caller can supply that header itself. Here it would aim the links inside
    // an email at a workspace of the sender's choosing.
    const slug = orgSlugFromHost(h.get("host"));
    if (slug) return originForSlug(slug);
  } catch {
    // No request context at all — a script, or build-time prerendering.
  }

  return originForSlug(DEFAULT_ORG_SLUG);
}
