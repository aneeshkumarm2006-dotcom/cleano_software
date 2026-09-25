"use client";

// Month grid for the available-jobs board (Stage 13 / PDF #13, p.9).
//
// Deliberately NOT the admin `src/components/calendar/MonthView.tsx`: that one
// is wired to `CalendarContext` and fetches `/api/calendar/range`, which would
// drag a whole data stack — and a second server round-trip — into a screen whose
// jobs are already in props. This component knows nothing about jobs at all: it
// is handed a day-key → count map and draws dots. That is also what keeps step
// 13.5 true by construction — there is no payload here to leak.
//
// Presentation only: no state, no fetching, no writes. The selected day and the
// visible month are owned by AvailableJobsClient, because the day list below the
// grid and the claim flow need them too.

import {
  addMonths,
  dayDotPlan,
  dayLabel,
  monthGridCells,
  monthKey,
  monthLabel,
  sameMonth,
  startOfMonth,
} from "@/lib/available-jobs-calendar";
import { civilKey } from "@/lib/tz-calendar";

/** Column headings. Sunday-first, matching the rest of the calendar stack. */
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Props {
  /** Business-timezone day key → how many *visible* jobs land on it. */
  countsByDay: Map<string, number>;
  /** Civil date inside the visible month. */
  anchor: Date;
  onAnchorChange: (next: Date) => void;
  /** Civil day key of the selected day, or null when nothing is selected. */
  selectedKey: string | null;
  onSelect: (dayKey: string) => void;
  /** "Today" as a civil day key, per the business timezone. */
  todayKey: string;
  /** Navigation bounds — see monthNavBounds(). */
  minMonth: Date;
  maxMonth: Date;
}

export default function AvailableJobsCalendar({
  countsByDay,
  anchor,
  onAnchorChange,
  selectedKey,
  onSelect,
  todayKey,
  minMonth,
  maxMonth,
}: Props) {
  const cells = monthGridCells(anchor);
  const atStart = sameMonth(anchor, minMonth);
  const atEnd = sameMonth(anchor, maxMonth);
  // A day key's first seven characters ARE its month key — no parsing needed,
  // and nothing to get wrong about the timezone.
  const showToday = monthKey(anchor) !== todayKey.slice(0, 7);

  return (
    <section className="cl-avc" aria-label="Available jobs calendar">
      <header className="cl-avc-head">
        <button
          type="button"
          className="cl-avc-navbtn"
          onClick={() => onAnchorChange(addMonths(anchor, -1))}
          disabled={atStart}
          aria-label="Previous month">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>

        {/* Announced on change, so a screen-reader user who presses the arrows
            hears which month they landed in. */}
        <h2 className="cl-avc-month" aria-live="polite">
          {monthLabel(anchor)}
        </h2>

        <button
          type="button"
          className="cl-avc-navbtn"
          onClick={() => onAnchorChange(addMonths(anchor, 1))}
          disabled={atEnd}
          aria-label="Next month">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
        </button>
      </header>

      {showToday && (
        <div className="cl-avc-todayrow">
          <button
            type="button"
            className="cl-avc-today"
            onClick={() => {
              const back = todayCivil(todayKey, anchor);
              onAnchorChange(startOfMonth(back));
              onSelect(todayKey);
            }}>
            Back to today
          </button>
        </div>
      )}

      {/* Column headings are decoration: every cell already carries its full
          date in `aria-label`, so announcing "Sun" seven times adds nothing. */}
      <div className="cl-avc-dow" aria-hidden="true">
        {DOW.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>

      <div className="cl-avc-grid">
        {cells.map((cell) => {
          const key = civilKey(cell);
          const count = countsByDay.get(key) ?? 0;
          const { dots, extra } = dayDotPlan(count);
          const inMonth = sameMonth(cell, anchor);
          const isToday = key === todayKey;
          const isSelected = key === selectedKey;

          const cls = [
            "cl-avc-day",
            inMonth ? "" : "out",
            isToday ? "today" : "",
            isSelected ? "sel" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <button
              key={key}
              type="button"
              className={cls}
              aria-pressed={isSelected}
              // The count belongs in the name, not only in the dots: a dot is
              // invisible to a screen reader, and "3 dots" would be a
              // description of the drawing rather than of the day.
              aria-label={`${dayLabel(cell)} — ${
                count === 0
                  ? "no available jobs"
                  : `${count} available job${count === 1 ? "" : "s"}`
              }${isToday ? " (today)" : ""}`}
              // Tapping a leading/trailing cell follows it into its own month,
              // rather than selecting a day the grid is about to stop showing.
              onClick={() => {
                if (!inMonth) onAnchorChange(startOfMonth(cell));
                onSelect(key);
              }}>
              <span className="cl-avc-daynum">{cell.getDate()}</span>
              <span className="cl-avc-dots" aria-hidden="true">
                {Array.from({ length: dots }, (_, i) => (
                  <span key={i} className="cl-avc-dot" />
                ))}
                {extra > 0 && <span className="cl-avc-more">+{extra}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * The civil date behind `todayKey`. The key is the source of truth (it was
 * derived in the business timezone); `anchor` is only a fallback for a key that
 * somehow isn't a date, so the "Back to today" button can never produce an
 * Invalid Date.
 */
function todayCivil(todayKey: string, anchor: Date): Date {
  const [y, m, d] = todayKey.split("-").map(Number);
  if (!y || !m || !d) return anchor;
  return new Date(y, m - 1, d);
}
