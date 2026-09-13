/**
 * Resolving which organization a request belongs to, from its host.
 *
 *   teamcleano.useawer.com  -> "teamcleano"
 *   acme.useawer.com        -> "acme"
 *   www.useawer.com         -> Awer itself
 *   useawer.com             -> Awer itself
 *
 * Pure functions only — no database, no request objects — so proxy.ts can use
 * this on every request without a query, and so the edge cases are testable.
 *
 * Every cleaning company, TeamCleano included, is addressed by its own label.
 * A host with no label is not a company at all: it is Awer's front door, where
 * a cleaning company finds the product and signs up. It resolves to Awer's own
 * workspace, and proxy.ts keeps the tenant application off it.
 */

/** Header that proxy.ts stamps on the request for server code to read. */
export const ORG_SLUG_HEADER = "x-awer-org";

/** The workspace Awer's own staff belong to. Not a cleaning company. */
export const PLATFORM_ORG_SLUG = "platform";

/**
 * Org serving requests whose host carries no tenant label: `useawer.com`, its
 * `www`, a preview build URL, a bare IP.
 *
 * This is Awer's own workspace. It used to be TeamCleano — they predated
 * multi-tenancy, so the bare domain WAS their app — and that is exactly what
 * had to stop: a cleaning company shopping for software would land on the
 * product's home page and be shown another company's booking form.
 *
 * Still overridable, and that override is the rollback: setting this back to a
 * company slug restores the old behaviour completely, guard included, without
 * a deploy.
 */
export const DEFAULT_ORG_SLUG =
  process.env.DEFAULT_ORG_SLUG?.trim().toLowerCase() || PLATFORM_ORG_SLUG;

/**
 * Where to send someone who arrives at the front door holding a link into the
 * application — a cleaner's bookmark, a phone home-screen icon — from back when
 * the bare domain served a company directly.
 *
 * Unset by default: the platform's own code should not carry a customer's name.
 * Production sets it to the company that used to live there, and clears it once
 * those bookmarks have died out.
 */
export const LEGACY_ORG_SLUG =
  process.env.LEGACY_ORG_SLUG?.trim().toLowerCase() || "";

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
 * Paths that belong to Awer itself rather than to a cleaning company.
 *
 * Deliberately an ALLOWLIST. The alternative — listing the tenant areas and
 * letting everything else through — means every route added from here on is
 * served on the front door by accident, quietly backed by Awer's own workspace.
 * Someone would eventually find `useawer.com/admin` showing an empty cleaning
 * company with a real "add a cleaner" button on it. Listing the few paths that
 * are genuinely ours fails the other way: a new route is kept off the front
 * door until someone decides otherwise.
 *
 * `/sign-in` is on the list because it is also the console door — Awer staff
 * sign in there. It gives nothing away: whether an account is platform staff is
 * decided after the password, by the console layout.
 */
const PLATFORM_PATHS = [
  "/welcome", // Awer's own marketing page, served as `/` on the front door
  "/get-started", // a cleaning company creating its workspace
  "/console", // Awer's own super-admin console
  "/sign-in", // staff door, shared with the console
  "/workspace-unavailable", // the suspended / unknown workspace notice
  "/design", // internal design reference
];

/** Is this path Awer's own, as opposed to part of a company's application? */
export function isPlatformPath(pathname: string): boolean {
  return PLATFORM_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** The smallest shape both `NextRequest.headers` and `next/headers` satisfy. */
type HeaderReader = { get(name: string): string | null | undefined };

/** Addresses that can only be a machine talking to itself, never a tenant. */
function isInternalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname === "::" ||
    hostname === "::1" ||
    // Bare IPs and IPv6 literals — the same two shapes orgSlugFromHost treats
    // as carrying no tenant label.
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) ||
    hostname.includes("[")
  );
}

/**
 * The host the BROWSER asked for, as opposed to the address the connection
 * happened to land on.
 *
 * Normally the same value, and `host` is the one to trust. They come apart on
 * exactly one kind of request — and it is one this app makes after every
 * successful server action. When an action calls `redirect()`, Next does not
 * hand the browser a 307: it renders the redirect target itself and streams it
 * back as the action's result, by fetching that page over HTTP from its own
 * INTERNAL origin (`__NEXT_PRIVATE_ORIGIN`, which `next dev` and a self-hosted
 * `next start` both set to the address they bind — `http://localhost:3006`).
 * The browser's headers ride along on that fetch, so `x-forwarded-host` still
 * says `acme.useawer.com` while `host` now says `localhost:3006`.
 *
 * Reading `host` alone there resolved the request to the platform, and the
 * proxy then answered "job created" with the body of Awer's own signup page:
 * the address bar said /admin/jobs while the page said "Start your workspace",
 * and only a manual reload put it right. Every server-action redirect on every
 * tenant was affected, not just the one that was reported.
 *
 * The forwarded header is consulted ONLY when `host` is an internal address,
 * which is the shape Next's self-fetch has and a shape no browser request for
 * a workspace ever has. That is what keeps this from becoming a tenant selector
 * a caller can set for itself: behind any proxy the Host header is the public
 * domain, so the forwarded value is ignored outright; and anyone who can reach
 * the origin directly to spoof `x-forwarded-host` can spoof `Host` instead, so
 * it opens nothing that was not already open. (Next only fills the forwarded
 * header in when it is absent — it never overwrites a caller's — which is
 * precisely why the trust has to be this narrow.)
 */
export function publicHostFromHeaders(h: HeaderReader): string | null {
  const host = h.get("host") ?? null;
  const hostname = host
    ? host.split(":")[0].trim().toLowerCase().replace(/\.$/, "")
    : "";
  if (hostname && !isInternalHostname(hostname)) return host;

  // A forwarded-host header can carry a list; the first hop is the browser's.
  const forwarded = h.get("x-forwarded-host")?.split(",")[0]?.trim();
  return forwarded || host;
}

/** The organization this request is for, read off the host it asked for. */
export function orgSlugFromRequestHeaders(h: HeaderReader): string {
  return orgSlugFromHost(publicHostFromHeaders(h));
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

/**
 * Where a workspace lives, worked out from the host the request arrived on.
 *
 * Signup happens on one host and finishes on another, so this has to build a URL
 * for a host the running code is not serving. Deriving it from the current
 * request rather than an env var means it is right in every environment at once:
 * `www.useawer.com` and `platform.useawer.com` both give
 * `<slug>.useawer.com`, and `localhost:3000` gives `<slug>.localhost:3000`,
 * which browsers resolve to 127.0.0.1 with no DNS or hosts file involved.
 *
 * Returns null where subdomains cannot work — a `*.vercel.app` build URL has its
 * own meaning for the first label, so a caller must show the address as text
 * instead of linking somewhere that would not resolve.
 */
export function workspaceOriginFor(
  slug: string,
  host: string | null | undefined,
  protocol = "https",
): string | null {
  if (!host) return null;

  const [rawHost, port] = host.split(":");
  const hostname = rawHost.trim().toLowerCase().replace(/\.$/, "");
  if (!hostname) return null;

  // Bare IPs and Vercel build URLs cannot carry a tenant label.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes("[")) return null;
  if (NON_TENANT_SUFFIXES.some((s) => hostname.endsWith(s))) return null;

  const parts = hostname.split(".");
  const isLocal = parts[parts.length - 1] === "localhost";

  // Drop an existing tenant (or infrastructure) label to get back to the root
  // the workspaces hang off. "useawer.com" and "localhost" are already roots.
  const root =
    isLocal
      ? "localhost"
      : parts.length >= 3
        ? parts.slice(1).join(".")
        : hostname;

  const suffix = port ? `:${port}` : "";
  return `${protocol}://${slug}.${root}${suffix}`;
}

/**
 * Where a workspace lives, for code that has no request to read a host from.
 *
 * Cron jobs and scripts still have to put absolute links in emails. They take
 * the root from configuration instead: `APP_ROOT_DOMAIN` if set, otherwise
 * `NEXT_PUBLIC_APP_URL`, which an existing deployment already has — so this
 * needs no new setup to start behaving correctly.
 *
 * Accepts either form for those variables: a bare domain (`useawer.com`) or a
 * full URL (`https://www.useawer.com`). Both are things a person reasonably
 * types into an environment variable, and guessing wrong here means every link
 * in every email is broken.
 */
export function originForSlug(slug: string): string {
  const fallback = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  const base = (process.env.APP_ROOT_DOMAIN || process.env.NEXT_PUBLIC_APP_URL || "").trim();
  if (!slug || !base) return fallback;

  let host: string;
  let protocol: string;
  try {
    const u = new URL(base.includes("://") ? base : `https://${base}`);
    host = u.host;
    protocol = u.protocol.replace(":", "");
  } catch {
    return fallback;
  }

  // Same derivation the signup handoff uses, rather than a second copy of it.
  return workspaceOriginFor(slug, host, protocol) ?? fallback;
}
