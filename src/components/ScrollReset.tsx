"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Next.js only resets the WINDOW scroll position on navigation. The admin and
 * cleaner shells scroll an inner `overflow-y: auto` container instead, so
 * clicking a link kept the previous page's scroll offset and new pages opened
 * mid-page. On every pathname change this resets any container tagged
 * `data-scroll-reset` (plus the window, for the customer portal).
 */
export default function ScrollReset() {
  const pathname = usePathname();

  useEffect(() => {
    document
      .querySelectorAll<HTMLElement>("[data-scroll-reset]")
      .forEach((el) => {
        el.scrollTop = 0;
      });
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
