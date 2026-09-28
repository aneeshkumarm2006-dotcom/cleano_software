"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Measured pixel width of a time-grid day column.
 *
 * The lane budget that stops ten overlapping jobs becoming ten slivers
 * (`resolveLaneCap`) is a pixel judgement, and the column is sized by flex —
 * 1/7 of whatever is left after the sidebar, the page gutters and the hour
 * gutter, which is different on every screen and changes when the sidebar
 * collapses. So it is measured rather than assumed.
 *
 * Returns `[ref, width]`. Width is `null` until the first measurement lands, on
 * purpose: the layout falls back to the percent-based cascade for that one
 * paint rather than guessing a width and reflowing.
 */
export function useColumnWidth(): [
  (el: HTMLElement | null) => void,
  number | null
] {
  const [width, setWidth] = useState<number | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    return () => observerRef.current?.disconnect();
  }, []);

  const ref = useCallback((el: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el) return;

    setWidth(el.getBoundingClientRect().width || null);

    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      // Ignore sub-pixel churn — every change re-lays out every card.
      setWidth((prev) =>
        w && (prev === null || Math.abs(prev - w) > 1) ? w : prev
      );
    });
    ro.observe(el);
    observerRef.current = ro;
  }, []);

  return [ref, width];
}

export default useColumnWidth;
