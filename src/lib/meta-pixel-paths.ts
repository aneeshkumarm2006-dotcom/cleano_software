/**
 * Which paths the platform's Meta pixel may fire on.
 *
 * Pure, and separate from the component, because this list is the whole
 * safety property and the component cannot be imported outside a browser
 * runtime — so the rule would otherwise be untestable.
 *
 * The property: a TENANT surface must never report into the platform's ad
 * account. A cleaning company's customers booking on their own subdomain are
 * not Bookmops' ad audience, and counting them would bury the signups the
 * platform actually pays for under traffic that was never a conversion. It is
 * the advertising shape of the per-tenant Stripe key bug.
 */

/** Public, unauthenticated funnel pages belonging to the platform itself. */
export const TRACKED_PATHS = ["/welcome", "/get-started"] as const;

export function isTrackedPath(pathname: string): boolean {
  // Exact match, or a genuine sub-path. NOT a prefix match on the raw string:
  // "/welcome-back" starts with "/welcome" and is a different page.
  return TRACKED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
