"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { X, ArrowLeft, ArrowRight, Compass } from "lucide-react";

/**
 * The guided tour a new workspace gets alongside the setup checklist.
 *
 * The two answer different questions and neither replaces the other. The
 * checklist answers "what do I still have to DO", reads live data and stays
 * until the work is done. This answers "what IS all this", runs once, and is
 * gone. Somebody who has never seen the app needs both: a list of tasks is
 * meaningless if you do not yet know what a "service area" is, and a walkthrough
 * you watched last Tuesday cannot tell you what is still outstanding.
 *
 * IT POINTS, IT DOES NOT DRIVE. Every step highlights something already on
 * screen and explains it; none of them navigate. A tour that walks the user
 * through six routes is six page loads that can each fail, and it strands them
 * somewhere unfamiliar if they quit halfway. This one starts and ends on the
 * dashboard, so leaving at any point costs nothing.
 *
 * A MISSING TARGET IS NOT A BROKEN STEP. Sidebar groups collapse, the nav is
 * filtered by role, and the whole sidebar is off-screen on a phone — so any
 * step's element may genuinely not be there. When that happens the step still
 * runs; it just centres itself and skips the spotlight, rather than pointing at
 * the top-left corner of the page.
 */

export interface TourStop {
  /** `data-tour` value to spotlight. Omitted for the opening and closing cards. */
  target?: string;
  title: string;
  body: string;
}

/**
 * Remembered per browser, not per user.
 *
 * There is no per-user preference column on User, and adding one means a
 * migration against the production database for a "don't show me this again"
 * flag. That trade is not worth it: the cost of being wrong here is that
 * somebody on a second browser is offered the tour again and dismisses it in
 * one click. Never read outside a try/catch — Safari's private mode throws on
 * access rather than returning null.
 */
const SEEN_KEY = "awer.tour.seen.v1";

function markSeen() {
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* storage unavailable — the tour simply offers itself again next time */
  }
}

export function hasSeenTour(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const CARD_W = 336;
const GAP = 16;

export default function Tour({
  stops,
  onClose,
}: {
  stops: TourStop[];
  onClose: () => void;
}) {
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const stop = stops[i];
  const last = i === stops.length - 1;

  const finish = useCallback(() => {
    markSeen();
    onClose();
  }, [onClose]);

  // Measure the current target. useLayoutEffect so the spotlight is in place in
  // the same frame the card is, rather than flashing at the previous step's
  // position first.
  useLayoutEffect(() => {
    if (!stop.target) {
      setBox(null);
      return;
    }
    const el = document.querySelector<HTMLElement>(`[data-tour="${stop.target}"]`);
    if (!el) {
      setBox(null);
      return;
    }

    const measure = () => {
      const r = el.getBoundingClientRect();
      // A zero-size rect is a collapsed sidebar group or a display:none item,
      // not a target. Treat it exactly like an absent element.
      if (r.width === 0 || r.height === 0) {
        setBox(null);
        return;
      }
      setBox({ top: r.top, left: r.left, width: r.width, height: r.height });
    };

    // The nav has its own scroll container, so bring the item into view before
    // measuring rather than spotlighting a rectangle that is scrolled away.
    el.scrollIntoView({ block: "nearest", behavior: "auto" });
    measure();

    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [stop.target, i]);

  // Escape leaves, and arrow keys step. A tour that traps you is worse than no
  // tour at all.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish();
      } else if (e.key === "ArrowRight") {
        setI((n) => Math.min(n + 1, stops.length - 1));
      } else if (e.key === "ArrowLeft") {
        setI((n) => Math.max(n - 1, 0));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finish, stops.length]);

  // Focus moves to the card on every step, so a screen reader announces the new
  // panel and the buttons are reachable without hunting for them.
  useEffect(() => {
    cardRef.current?.focus();
  }, [i]);

  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  /**
   * Where the card sits.
   *
   * Beside the highlight when there is room to its right (the sidebar case, and
   * most of them), then below, then above, and only then centred. The order
   * matters less than the rule underneath it: a candidate is used ONLY if the
   * whole card fits on screen there. The first version stopped at "below" and
   * the setup card — which is 700px tall — pushed the tour panel clean off the
   * bottom of the window, so the step ran with nothing visible to read.
   *
   * Measured, not assumed: the card's height changes with the length of each
   * step's text, so it is read back off the DOM rather than guessed at.
   */
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const cardH = card.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clampX = (x: number) => Math.max(GAP, Math.min(x, vw - CARD_W - GAP));
    const fitsV = (t: number) => t >= GAP && t + cardH + GAP <= vh;

    if (!box) {
      setPos({ top: Math.max(GAP, (vh - cardH) / 2), left: (vw - CARD_W) / 2 });
      return;
    }
    if (box.left + box.width + GAP + CARD_W + GAP <= vw) {
      setPos({
        top: Math.max(GAP, Math.min(box.top - 8, vh - cardH - GAP)),
        left: box.left + box.width + GAP,
      });
    } else if (fitsV(box.top + box.height + GAP)) {
      setPos({ top: box.top + box.height + GAP, left: clampX(box.left) });
    } else if (fitsV(box.top - GAP - cardH)) {
      setPos({ top: box.top - GAP - cardH, left: clampX(box.left) });
    } else {
      setPos({ top: Math.max(GAP, (vh - cardH) / 2), left: (vw - CARD_W) / 2 });
    }
  }, [box, i]);

  // Hidden until placed, so the card is never painted at the previous step's
  // position for a frame before it moves.
  const placement: React.CSSProperties = pos
    ? { top: pos.top, left: pos.left }
    : { top: 0, left: 0, opacity: 0, pointerEvents: "none" };

  return (
    <div className="tour-root" role="dialog" aria-modal="true" aria-label="Guided tour">
      {/* The dimmer. When a target is measured it gets a cut-out, drawn as a
          transparent block with an enormous spread shadow — one element rather
          than the four strips the same effect usually takes. */}
      {box ? (
        <div
          className="tour-spot"
          style={{
            top: box.top - 4,
            left: box.left - 4,
            width: box.width + 8,
            height: box.height + 8,
          }}
          onClick={finish}
        />
      ) : (
        <div className="tour-dim" onClick={finish} />
      )}

      <div
        className="tour-card"
        style={placement}
        ref={cardRef}
        tabIndex={-1}
        aria-live="polite"
      >
        <div className="tour-card-head">
          <span className="tour-step">
            Step {i + 1} of {stops.length}
          </span>
          <button type="button" className="tour-x" onClick={finish} aria-label="Close the tour">
            <X size={15} />
          </button>
        </div>

        <h3 className="tour-title">{stop.title}</h3>
        <p className="tour-body">{stop.body}</p>

        <div className="tour-dots" aria-hidden="true">
          {stops.map((s, n) => (
            <span key={s.title} className={n === i ? "on" : n < i ? "past" : ""} />
          ))}
        </div>

        <div className="tour-actions">
          <button type="button" className="tour-skip" onClick={finish}>
            {last ? "Close" : "Skip tour"}
          </button>
          <div className="tour-nav">
            {i > 0 && (
              <button type="button" className="tour-btn" onClick={() => setI(i - 1)}>
                <ArrowLeft size={14} />
                Back
              </button>
            )}
            {last ? (
              <button type="button" className="tour-btn primary" onClick={finish}>
                <Compass size={14} />
                Get started
              </button>
            ) : (
              <button type="button" className="tour-btn primary" onClick={() => setI(i + 1)}>
                Next
                <ArrowRight size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
