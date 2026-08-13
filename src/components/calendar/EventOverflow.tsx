"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarEvent } from "./types";
import { statusMeta } from "./status-meta";

/**
 * The "+N more" chip for a crowded time column, and the list it opens
 * (client feedback item 8 · Q2 §7).
 *
 * Week and Day used to split n overlapping jobs into n equal lanes with no
 * floor — ten concurrent bookings became ten ~12px slivers, which is the
 * "especially when the jobs are stacked up on one another" half of the
 * complaint. Lanes are now budgeted at a readable width
 * (`calendar-helpers.resolveLaneCap`) and the surplus arrives here.
 *
 * Deliberately the SAME idiom as the month cell's "+N more" so there is one
 * overflow affordance in the calendar, not two. It differs in where it goes:
 * the month chip switches to the Day view, because a day cell has no room to
 * list anything; here the list is the point, so it opens in place and each row
 * opens the booking drawer directly. That is what makes ten stacked jobs
 * individually clickable without leaving the week.
 */
function timeStr(d: Date) {
  // Floating store wall-clock date (getJobsForDay → toBusinessWallClock), so
  // browser-local formatting already shows business time. See ./utils.
  return d
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .replace(":00", "");
}

export const EventOverflowChip: React.FC<{
  events: CalendarEvent[];
  top: number;
  onSelect: (event: CalendarEvent) => void;
}> = ({ events, top, onSelect }) => {
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const place = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const W = 262;
    // Prefer to the right of the chip; flip inside the viewport at either edge.
    const left = Math.max(8, Math.min(r.left - W + r.width, window.innerWidth - W - 8));
    const top = Math.max(8, Math.min(r.bottom + 6, window.innerHeight - 340));
    setPos({ top, left });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    const close = (e: MouseEvent) => {
      if (
        popRef.current?.contains(e.target as Node) ||
        btnRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // `true` — the grid stops propagation on its own pointer handlers, so a
    // bubbling listener would never see the click that should dismiss this.
    document.addEventListener("mousedown", close, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    // Capture phase again: the calendar body is the element that scrolls, and
    // scroll events don't bubble.
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", close, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="cal-ev-more"
        style={{ top: `${top + 1}px`, right: "3px", height: "19px" }}
        aria-haspopup="true"
        aria-expanded={open}
        title={`${events.length} more overlapping ${
          events.length === 1 ? "job" : "jobs"
        }`}
        // The 15-minute drag-create tiles sit under the cards; without this the
        // press-through starts a New Job selection behind the popover.
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}>
        +{events.length}
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={popRef}
              className="cal-stack-pop admin-font"
              style={{ top: pos.top, left: pos.left }}
              onMouseDown={(e) => e.stopPropagation()}>
              <div className="cal-stack-pop-head">
                {events.length} more at this time
              </div>
              {events.map((event) => {
                const m = statusMeta(event);
                return (
                  <button
                    key={event.id}
                    type="button"
                    className="cal-stack-row"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpen(false);
                      onSelect(event);
                    }}>
                    <span
                      className="cal-stack-dot"
                      style={{ background: m.color }}
                    />
                    <span className="cal-stack-time">{timeStr(event.start)}</span>
                    <span className="cal-stack-name">{event.title}</span>
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </>
  );
};

export default EventOverflowChip;
