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
import { scopedTo, type ScopedDb } from "@/lib/db-scoped";
import { orgFromContext, type OrgContext } from "@/lib/org-context";
import { DEFAULT_ORG_SLUG, orgSlugFromHost } from "@/lib/tenant";

/**
 * Slug for this request. Falls back to the default outside a request context
 * (scripts, build-time prerendering) rather than throwing, since those have no
 * host to read and are not tenant-specific.
 */
export const getOrgSlug = cache(async (): Promise<string> => {
  // Cron jobs and scripts announce their organization explicitly, because they
  // have no host to read one from. That announcement wins: it is the whole
  // reason it exists.
  const ctx = orgFromContext();
  if (ctx?.slug) return ctx.slug;

  try {
    const h = await headers();

    // The host is the ONLY authority, and the inbound x-awer-org header is
    // deliberately not consulted.
    //
    // proxy.ts stamps that header, but its matcher skips /api/* and every path
    // containing a dot, so on exactly those requests nothing overwrites what
    // the caller sent. Preferring the header there let an unauthenticated
    // client pick its own tenant with one line of curl -- and since this
    // function feeds requireOrgId(), the scoped client AND the row-level
    // security announcement, both isolation layers moved to the attacker's
    // choice together.
    //
    // Nothing is lost by ignoring it: proxy.ts derives the value it stamps
    // from this same host (proxy.ts:98), so on proxied paths the two always
    // agreed anyway.
    return orgSlugFromHost(h.get("host"));
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
export class OrgUnavailableError extends Error {
  constructor(
    readonly reason: "not-found" | "suspended" | "cancelled" | "pending",
    slug: string,
  ) {
    super(`Workspace "${slug}" is unavailable (${reason}).`);
    this.name = "OrgUnavailableError";
  }
}

export async function requireOrgId(): Promise<string> {
  // An explicit context already carries the id, and forEachOrganization only
  // ever selects ACTIVE workspaces — so this needs no lookup and no status
  // check. It also avoids depending on React's per-request cache in code that
  // runs outside a request entirely.
  const ctx = orgFromContext();
  if (ctx?.id) return ctx.id;

  const slug = await getOrgSlug();
  const org = await getCurrentOrg();
  if (!org) throw new OrgUnavailableError("not-found", slug);

  // A workspace that is not ACTIVE cannot be queried at all.
  //
  // Refusing here rather than only in the layout is deliberate. Next renders a
  // page in parallel with its layout, so a layout that redirects still lets the
  // page run and stream its data -- a suspended workspace was serving its whole
  // client list inside the body of a 307. Stopping at the data layer means
  // there is nothing to serve in the first place.
  if (org.status !== "ACTIVE") {
    throw new OrgUnavailableError(
      org.status === "SUSPENDED"
        ? "suspended"
        : org.status === "CANCELLED"
          ? "cancelled"
          : "pending",
      slug,
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

/**
 * A Prisma client confined to this request's organization.
 *
 * This is what application code should use instead of the raw `db` import. It
 * carries the organization implicitly, so a query cannot forget to name its
 * tenant -- the mistake that hand-editing ~1,400 `where` clauses would invite.
 *
 * Throws when the host resolves to no organization, which stops the request
 * rather than letting it run unscoped.
 */
export const getScopedDb = cache(async () => scopedTo(db, await requireOrgId()));

/**
 * The scoped client for whatever this code is running as — request or context.
 *
 * The request path goes through React's cache above, which dedupes it across a
 * render. Code running under an explicit context is outside a request entirely,
 * where that cache does not apply, so those are memoised against the context
 * object instead: one scoped client per organization per cron iteration, rather
 * than one per query.
 */
const scopedByContext = new WeakMap<OrgContext, ScopedDb>();

export async function getScopedDbForCurrent(): Promise<ScopedDb> {
  const ctx = orgFromContext();
  if (!ctx) return getScopedDb();

  const existing = scopedByContext.get(ctx);
  if (existing) return existing;

  const made = scopedTo(db, ctx.id);
  scopedByContext.set(ctx, made);
  return made;
}
