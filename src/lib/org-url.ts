import { headers } from "next/headers";

import { orgFromContext } from "@/lib/org-context";
import {
  DEFAULT_ORG_SLUG,
  ORG_SLUG_HEADER,
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
    const slug = h.get(ORG_SLUG_HEADER) ?? orgSlugFromHost(h.get("host"));
    if (slug) return originForSlug(slug);
  } catch {
    // No request context at all — a script, or build-time prerendering.
  }

  return originForSlug(DEFAULT_ORG_SLUG);
}
