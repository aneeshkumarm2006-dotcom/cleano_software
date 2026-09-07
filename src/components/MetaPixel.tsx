"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Meta's pixel, on the marketing funnel only.
 *
 * Mounted from the root layout but gated to an explicit allowlist of public
 * funnel paths. That is the whole point of the allowlist: a cleaning company's
 * staff working inside the admin app, and their customers on a tenant booking
 * page, are not Awer's ad audience. Tracking them would leak one company's
 * activity into our advertising profile and bury the signups we actually pay
 * for under traffic that was never a conversion.
 *
 * Ships dark: with NEXT_PUBLIC_META_PIXEL_ID unset nothing loads and no
 * request leaves the browser, so deploying this before the ad account exists
 * changes nothing.
 */

/** Public, unauthenticated funnel pages. Prefix match. */
const TRACKED_PATHS = ["/welcome", "/get-started"];

declare global {
  interface Window {
    fbq?: ((...args: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean };
    _fbq?: unknown;
  }
}

export function isTrackedPath(pathname: string): boolean {
  return TRACKED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Fire a Meta standard event. A no-op when the pixel never loaded. */
export function trackMeta(event: string, params?: Record<string, unknown>): void {
  if (typeof window === "undefined" || typeof window.fbq !== "function") return;
  try {
    window.fbq("track", event, params);
  } catch {
    /* analytics must never break a signup */
  }
}

export default function MetaPixel() {
  const pathname = usePathname();
  const loaded = useRef(false);

  useEffect(() => {
    const id = process.env.NEXT_PUBLIC_META_PIXEL_ID;
    if (!id || !isTrackedPath(pathname)) return;

    if (!loaded.current && !window.fbq) {
      loaded.current = true;
      // Meta's own loader, written out rather than injected as a blob so the
      // page's CSP does not need script-src 'unsafe-eval'.
      const queue: unknown[] = [];
      const fbq = Object.assign(
        (...args: unknown[]) => {
          queue.push(args);
        },
        { queue, loaded: true },
      );
      window.fbq = fbq;
      window._fbq = fbq;

      const s = document.createElement("script");
      s.async = true;
      s.src = "https://connect.facebook.net/en_US/fbevents.js";
      document.head.appendChild(s);

      window.fbq("init", id);
    }

    // Every funnel page view, including client-side navigations, which a bare
    // script tag would miss entirely.
    trackMeta("PageView");
  }, [pathname]);

  return null;
}
