"use client";

import { useEffect } from "react";

/**
 * The cleaner job detail is a server component, so it can't reset scroll itself.
 * Opening a job from My Jobs / Calendar / Dashboard / Available Jobs used to
 * inherit the previous page's scroll offset and drop the cleaner into the
 * middle of the page. Reset on mount (and whenever the job changes).
 */
export default function ScrollToTop({ jobId }: { jobId: string }) {
  useEffect(() => {
    window.scrollTo(0, 0);
    // The cleaner shell scrolls an inner container, not the window.
    document
      .querySelectorAll<HTMLElement>(".cl-app-main, .overflow-y-auto")
      .forEach((el) => {
        el.scrollTop = 0;
      });
  }, [jobId]);

  return null;
}
