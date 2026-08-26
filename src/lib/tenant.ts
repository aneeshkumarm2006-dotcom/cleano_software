/**
 * Resolving which organization a request belongs to, from its host.
 *
 *   teamcleano.useawer.com  -> "teamcleano"
 *   www.useawer.com         -> the default org
 *   useawer.com             -> the default org
 *
 * Pure functions only — no database, no request objects — so proxy.ts can use
 * this on every request without a query, and so the edge cases are testable.
 *
 * Everything that is NOT a tenant subdomain resolves to DEFAULT_ORG_SLUG. That
 * is deliberate: it is what keeps www.useawer.com behaving exactly as it does
 * today while the migration is in progress.
 */

/** Header that proxy.ts stamps on the request for server code to read. */
export const ORG_SLUG_HEADER = "x-awer-org";

/**
 * Org serving requests with no tenant subdomain. Production is TeamCleano, who
 * predate multi-tenancy; staging overrides this to its seeded demo org.
 */
export const DEFAULT_ORG_SLUG =
  process.env.DEFAULT_ORG_SLUG?.trim().toLowerCase() || "teamcleano";

/**
 * Labels that are infrastructure and can never be a workspace.
 *
 * Kept deliberately small and separate from RESERVED_SLUGS below. These two
 * lists answer different questions: this one decides how a HOST resolves, the
 * other decides what a company may CLAIM at signup. Conflating them meant
 * `platform.useawer.com` silently resolved to the default workspace, which
 * would have left Awer's own staff with nowhere to sign in.
 */
const INFRA_LABELS = new Set([
  "www", "api", "static", "assets", "cdn", "img", "mail", "smtp", "ftp",
]);

/**
 * Slugs a company may not claim at signup.
 *
 * Wider than INFRA_LABELS: it also covers names we want to keep for ourselves
 * (platform, billing, status) and names that would be confusing or misleading
 * in a customer's hands.
 */
export const RESERVED_SLUGS = new Set([
  ...INFRA_LABELS,
  "app", "admin", "auth", "blog", "docs", "help", "support", "status",
  "staging", "preview", "dev", "test", "demo", "internal", "dashboard",
  "billing", "account", "accounts", "login", "signup", "book", "booking",
  "awer", "useawer", "platform", "console", "operator",
]);

/** The workspace Awer's own staff belong to. Not a customer. */
export const PLATFORM_ORG_SLUG = "platform";

/** A DNS label: lowercase alphanumeric and hyphens, not leading/trailing. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Hosts whose first label is never a tenant. */
const NON_TENANT_SUFFIXES = [".vercel.app", ".now.sh"];

/** May a host label address a workspace at all? */
function isRoutableLabel(slug: string): boolean {
  return LABEL.test(slug) && !INFRA_LABELS.has(slug) && !slug.includes("--");
}

/** May a company claim this slug when signing up? */
export function isValidOrgSlug(slug: string): boolean {
  return LABEL.test(slug) && !RESERVED_SLUGS.has(slug) && !slug.includes("--");
}

/**
 * The organization slug a host maps to. Never throws and never returns empty —
 * an unrecognised host falls back to the default rather than failing the
 * request, because a hostname is not something the user controls.
 */
export function orgSlugFromHost(host: string | null | undefined): string {
  if (!host) return DEFAULT_ORG_SLUG;

  // strip port, normalise, drop any fully-qualified trailing dot
  const hostname = host.split(":")[0].trim().toLowerCase().replace(/\.$/, "");
  if (!hostname) return DEFAULT_ORG_SLUG;

  // bare IPs carry no tenant label
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes("[")) {
    return DEFAULT_ORG_SLUG;
  }

  // Vercel-generated deployment URLs: the first label is a build hash.
  if (NON_TENANT_SUFFIXES.some((s) => hostname.endsWith(s))) {
    return DEFAULT_ORG_SLUG;
  }

  const parts = hostname.split(".");

  // *.localhost — how subdomains are exercised in local development. Chrome and
  // Firefox resolve these to 127.0.0.1 with no DNS or hosts file involved.
  if (parts[parts.length - 1] === "localhost") {
    if (parts.length < 2) return DEFAULT_ORG_SLUG;
    const label = parts[0];
    return isRoutableLabel(label) ? label : DEFAULT_ORG_SLUG;
  }

  // A tenant needs a label in front of the registrable domain, so at minimum
  // three parts. "useawer.com" is the platform itself.
  if (parts.length < 3) return DEFAULT_ORG_SLUG;

  const label = parts[0];
  return isRoutableLabel(label) ? label : DEFAULT_ORG_SLUG;
}
