"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Pull-to-refresh for the crew app.
 *
 * An installed PWA has no browser chrome, so there is no reload button and the
 * OS pull-to-refresh doesn't reach us — cleaners had literally no way to fetch
 * fresh jobs short of killing the app. This restores the gesture everyone
 * already expects from a native app.
 *
 * Feel notes (this is what separates "native" from "a website with a spinner"):
 *  - The indicator SCRUBS to the finger rather than playing a canned animation.
 *  - Movement is damped to ~45% of the drag: real objects resist, and a 1:1
 *    follow reads as a bug.
 *  - It only arms when the scroller is already at the very top, so it can
 *    never hijack a normal scroll.
 *  - A short vibration fires exactly once, when you cross the release
 *    threshold — that haptic tick is the single most "native" cue available.
 */
const THRESHOLD = 64;   // px of damped travel needed to trigger
const MAX_PULL = 96;    // hard stop so it can't be dragged to the moon
const DAMPING = 0.45;

export default function PullToRefresh() {
  const router = useRouter();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const armed = useRef(false);
  const passedThreshold = useRef(false);

  useEffect(() => {
    // The crew shell scrolls an inner container, not the window.
    const scroller = () =>
      document.querySelector<HTMLElement>(".cl-app-main") ??
      document.scrollingElement as HTMLElement | null;

    function onStart(e: TouchEvent) {
      if (refreshing || e.touches.length !== 1) return;
      const el = scroller();
      if (!el || el.scrollTop > 0) return;   // only at the very top
      armed.current = true;
      passedThreshold.current = false;
      startY.current = e.touches[0].clientY;
    }

    function onMove(e: TouchEvent) {
      if (!armed.current || startY.current === null || refreshing) return;
      const raw = e.touches[0].clientY - startY.current;
      if (raw <= 0) { setPull(0); return; }   // dragging up = normal scroll
      const el = scroller();
      if (el && el.scrollTop > 0) { armed.current = false; setPull(0); return; }
      const damped = Math.min(raw * DAMPING, MAX_PULL);
      setPull(damped);
      if (damped > 6 && e.cancelable) e.preventDefault(); // stop rubber-banding
      if (!passedThreshold.current && damped >= THRESHOLD) {
        passedThreshold.current = true;
        navigator.vibrate?.(8);   // the "you can let go now" tick
      }
    }

    function onEnd() {
      if (!armed.current) return;
      armed.current = false;
      startY.current = null;
      setPull((current) => {
        if (current >= THRESHOLD && !refreshing) {
          setRefreshing(true);
          router.refresh();
          // Hold the spinner briefly so a fast refresh still reads as an
          // action that happened, rather than a flicker.
          window.setTimeout(() => { setRefreshing(false); setPull(0); }, 900);
          return THRESHOLD;
        }
        return 0;
      });
    }

    // passive:false on move so preventDefault can suppress overscroll.
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, [refreshing, router]);

  const progress = Math.min(1, pull / THRESHOLD);
  const visible = pull > 0 || refreshing;

  return (
    <div
      className="cl-ptr"
      data-active={visible ? "" : undefined}
      data-refreshing={refreshing ? "" : undefined}
      style={{
        transform: `translate(-50%, ${pull}px)`,
        opacity: progress,
      }}
      aria-hidden={!visible}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
           style={{ transform: `rotate(${progress * 270}deg)` }}>
        <circle
          cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.4"
          strokeLinecap="round" strokeDasharray="57"
          strokeDashoffset={57 - 57 * progress}
        />
      </svg>
    </div>
  );
}
