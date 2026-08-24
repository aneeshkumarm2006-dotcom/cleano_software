/**
 * The organization serving the current request.
 *
 * proxy.ts derives the slug from the host and stamps it on the request; this
 * turns that into a record. Both lookups are wrapped in React's cache(), so a
 * page that asks for the organization in a dozen places issues one query.
 *
 * Nothing reads these yet. Step 4 threads the id through the query layer, and
 * Step 5 uses it to set the row-level-security context.
 */
import { cache } from "react";
import { headers } from "next/headers";

import { db } from "@/db";
import { DEFAULT_ORG_SLUG, ORG_SLUG_HEADER, orgSlugFromHost } from "@/lib/tenant";

/**
 * Slug for this request. Falls back to the default outside a request context
 * (scripts, build-time prerendering) rather than throwing, since those have no
 * host to read and are not tenant-specific.
 */
export const getOrgSlug = cache(async (): Promise<string> => {
  try {
    const h = await headers();

    // Normally set by proxy.ts. But the proxy matcher deliberately skips
    // /api/*, so route handlers -- Stripe webhooks, cron, better-auth -- never
    // see it. Falling back to the host means tenant resolution is a property of
    // the request itself rather than of the matcher, and stays correct if the
    // matcher is ever narrowed again.
    return h.get(ORG_SLUG_HEADER) ?? orgSlugFromHost(h.get("host"));
  } catch {
    // No request context at all: scripts and build-time prerendering.
    return DEFAULT_ORG_SLUG;
  }
});

/** The organization record, or null if the slug matches nothing. */
export const getCurrentOrg = cache(async () => {
  const slug = await getOrgSlug();
  return db.organization.findUnique({ where: { slug } });
});

/**
 * The organization id, or throw.
 *
 * This is what query scoping will call in Step 4. It throws rather than
 * returning null on purpose: a query that cannot name its tenant must fail
 * loudly and stop the request, never quietly run unscoped and return another
 * company's rows.
 */
export async function requireOrgId(): Promise<string> {
  const org = await getCurrentOrg();
  if (!org) {
    throw new Error(
      `No organization for slug "${await getOrgSlug()}". Refusing to run an unscoped query.`,
    );
  }
  return org.id;
}

/**
 * True when the organization exists and may currently be used. SUSPENDED orgs
 * (non-payment, or an admin action) keep their data but are locked out.
 */
export async function isOrgUsable(): Promise<boolean> {
  const org = await getCurrentOrg();
  return org?.status === "ACTIVE";
}
