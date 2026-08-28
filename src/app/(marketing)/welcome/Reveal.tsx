"use client";

import { useEffect } from "react";

/**
 * Section entrances for the marketing page.
 *
 * Deliberately the only client JavaScript on this page. It reveals anything
 * carrying `data-reveal` once it scrolls into view, staggered by an optional
 * `data-reveal-delay` in milliseconds.
 *
 * The hidden start state is plain CSS in the server-rendered stylesheet, not
 * something stamped onto the document by a script. An earlier version set an
 * attribute on <html> before paint, which is the usual trick — and it produced
 * a hydration mismatch, because React compares the attributes it rendered
 * against the ones it finds. Nothing here touches an element React owns.
 *
 * That leaves three ways the reveal could hide the page instead of decorating
 * it, and all three are answered without JavaScript: reduced motion and print
 * override the start state in CSS, no-JS overrides it with a <noscript> style,
 * and a hydration that never happens is caught by the failsafe in page.tsx —
 * which watches for the flag set below.
 */
export default function Reveal() {
  useEffect(() => {
    // Tells the failsafe that someone is home, so it stands down.
    (window as unknown as { __mkReveal?: boolean }).__mkReveal = true;

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (typeof IntersectionObserver === "undefined") {
      els.forEach((el) => el.classList.add("is-in"));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          const delay = Number(el.dataset.revealDelay ?? 0);
          window.setTimeout(() => el.classList.add("is-in"), delay);
          io.unobserve(el);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return null;
}
