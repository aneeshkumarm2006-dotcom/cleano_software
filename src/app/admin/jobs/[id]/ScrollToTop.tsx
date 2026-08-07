"use client";

import { useEffect } from "react";

/**
 * Belt-and-braces for the job detail page opening mid-scroll.
 *
 * <ScrollReset> in the admin shell handles SPA navigations (it keys on
 * pathname), and JobDetailView's scroller now carries `data-scroll-reset` so it
 * is actually in scope. This covers the cases ScrollReset can't: a full page
 * load from a plain `<a href>` (the Requests page's "Open job"), a browser
 * refresh, and content that streams in late.
 *
 * Two deliberate differences from the cleaner-side twin
 * (`cleaners/my-jobs/[jobId]/ScrollToTop.tsx`):
 *
 *  1. It targets `[data-scroll-reset]`, never `.overflow-y-auto`. The admin
 *     shell wrapper is itself `overflow-y-auto` and comes first in the DOM — a
 *     previous attempt at this fix reset the sidebar instead of the page
 *     (see the comment in JobDetailView near `updateView`).
 *  2. It bails out on a hash. The calendar deep-links to `#photos`; resetting
 *     scroll would fight that anchor.
 *
 * Keyed on `jobId` only — NOT searchParams. Tab switches and logs pagination go
 * through `router.replace(…, { scroll: false })`, which keeps this component
 * mounted, so the effect doesn't re-fire and the admin keeps their place.
 */
export default function ScrollToTop({ jobId }: { jobId: string }) {
  useEffect(() => {
    if (window.location.hash) return;

    const reset = () => {
      window.scrollTo(0, 0);
      document
        .querySelectorAll<HTMLElement>("[data-scroll-reset]")
        .forEach((el) => {
          if (el.scrollTop) el.scrollTop = 0;
        });
    };

    reset();
    // The header can render before the tabs' content settles; catch the shift.
    const raf = requestAnimationFrame(reset);
    return () => cancelAnimationFrame(raf);
  }, [jobId]);

  return null;
}
