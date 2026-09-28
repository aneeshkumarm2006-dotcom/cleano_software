"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Next.js only resets the WINDOW scroll on navigation, but this app scrolls
 * inner containers: the admin shell has one, and almost every page ALSO wraps
 * its content in its own `overflow-y-auto` div. Those page wrappers are the
 * real scrollers, so a route change could leave the new page rendered
 * mid-scroll.
 *
 * On every pathname change we reset the window plus the shell container
 * (`[data-scroll-reset]`), `<main>`, and main's DIRECT children (the per-page
 * wrappers). Scoping to direct children deliberately leaves deep inner
 * scrollers alone — a chat thread that auto-scrolls to its newest message must
 * not be yanked back to the top.
 *
 * The reset repeats on the next frames and shortly after, because page content
 * streams in (Suspense) and can restore or shift scroll after the first pass.
 */
export default function ScrollReset() {
  const pathname = usePathname();

  useEffect(() => {
    // Stop the browser from restoring a previous scroll offset on top of us.
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }

    const reset = () => {
      window.scrollTo(0, 0);
      const scrollingEl = document.scrollingElement as HTMLElement | null;
      if (scrollingEl && scrollingEl.scrollTop) scrollingEl.scrollTop = 0;

      const targets = new Set<HTMLElement>();
      document
        .querySelectorAll<HTMLElement>("[data-scroll-reset]")
        .forEach((el) => targets.add(el));
      document.querySelectorAll<HTMLElement>("main").forEach((main) => {
        targets.add(main);
        main
          .querySelectorAll<HTMLElement>(":scope > *")
          .forEach((child) => targets.add(child));
      });

      targets.forEach((el) => {
        if (el.scrollTop) el.scrollTop = 0;
      });
    };

    reset();
    const raf1 = requestAnimationFrame(() => {
      reset();
      requestAnimationFrame(reset);
    });
    // Catches content that streams in after the first paint.
    const late = window.setTimeout(reset, 150);

    return () => {
      cancelAnimationFrame(raf1);
      window.clearTimeout(late);
    };
  }, [pathname]);

  return null;
}
