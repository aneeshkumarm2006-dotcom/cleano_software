"use client";
import React from "react";
import { useCalendar } from "@/components/calendar/CalendarContext";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  addDays,
  isSameMonth,
  isSameDay,
  format,
  eventOverlapsDay,
} from "@/components/calendar/utils";
import { statusMeta, isUnconfirmed, isCancelled } from "./status-meta";
import CornerBadge from "./CornerBadge";
import { avatarColor, initials, shortName } from "@/lib/avatar";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** How many job cards a day cell shows before collapsing to "+N more". */
const MONTH_CARDS_PER_DAY = 3;

/**
 * The person a month card is colour-keyed to: the first assigned cleaner,
 * falling back to the job's lead employee. Null when nobody is assigned — that
 * must stay visually distinct rather than borrowing someone's colour
 * (awer_fixes.pdf item 28).
 */
function assigneeOf(event: {
  metadata?: {
    cleaners?: { name?: string | null }[];
    employeeName?: string | null;
  };
}): string | null {
  const first = event.metadata?.cleaners?.[0]?.name;
  if (first) return first;
  const lead = event.metadata?.employeeName;
  if (lead && lead !== "Unassigned") return lead;
  return null;
}

export const MonthView = () => {
  const {
    currentDate,
    events,
    openEventDetailsModal,
    setCurrentDate,
    setView,
  } = useCalendar();

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const gridStart = startOfWeek(monthStart);
  const gridEnd = addDays(startOfWeek(monthEnd), 6);

  const cells: Date[] = [];
  for (let d = new Date(gridStart); d <= gridEnd; d = addDays(d, 1)) {
    cells.push(new Date(d));
  }

  const goToDay = (date: Date) => {
    setCurrentDate(date);
    setView("day");
  };

  const eventsFor = (day: Date) =>
    Array.from(
      new Map(
        events.filter((e) => eventOverlapsDay(e, day)).map((e) => [e.id, e])
      ).values()
    ).sort((a, b) => a.start.getTime() - b.start.getTime());

  return (
    <div className="cal-month admin-font">
      <div className="cal-month-dow">
        {DOW.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="cal-month-grid">
        {cells.map((day, i) => {
          const inMonth = isSameMonth(day, monthStart);
          const today = isSameDay(day, new Date());
          const list = eventsFor(day);
          const activeCount = list.filter((e) => !isCancelled(e)).length;
          return (
            <div
              key={i}
              className={`cal-mcell ${inMonth ? "" : "out"} ${today ? "today" : ""}`}
              onClick={() => goToDay(day)}>
              {/* Day number first, job count second: `.cal-mcell-head` is
                  space-between, so source order IS reading order — the date
                  belongs on the left of the cell and the count pill on the
                  right. With no jobs the date is the only child and lands at
                  flex-start, which is where it belongs anyway. */}
              <div className="cal-mcell-head">
                <span className={`cal-mdate ${today ? "today" : ""}`}>
                  {format(day, "d")}
                </span>
                {/*
                  The count is ACTIVE work, not rows (Aug 31 list, item 10).
                  Cancelled jobs stay on the day — they are still a record, and
                  the doc asks for them to remain visible — but a day with one
                  booking and two cancellations is a one-job day, and saying
                  "3 jobs" made a quiet week look busy.
                */}
                {activeCount ? (
                  <span className="cal-mcount">
                    {activeCount} {activeCount === 1 ? "job" : "jobs"}
                  </span>
                ) : null}
              </div>
              <div className="cal-mcell-jobs">
                {list.slice(0, MONTH_CARDS_PER_DAY).map((event) => {
                  const m = statusMeta(event);
                  const assignee = assigneeOf(event);
                  return (
                    <button
                      key={event.id}
                      className={`cal-chip ${isUnconfirmed(event) ? "faded" : ""}`}
                      style={{ background: m.tint, color: m.color }}
                      onClick={(e) => {
                        e.stopPropagation();
                        openEventDetailsModal(event);
                      }}
                      /* Item 28: the card is scannable BY CLEANER, so the
                         assignee belongs in the tooltip too. */
                      title={`${format(event.start, "h:mm a")} · ${event.title ?? ""}${
                        assignee ? ` · ${assignee}` : " · Unassigned"
                      }`}>
                      <CornerBadge event={event} />
                      {/* The dot is keyed to the ASSIGNED CLEANER, not the job
                          status — status is already carried by the chip's own
                          tint, and colouring by person is what makes a month
                          grid scannable at a glance. Unassigned stays neutral
                          so it reads as "nobody", not as a person. */}
                      <span
                        className="cal-chip-dot"
                        style={{
                          background: assignee ? avatarColor(assignee) : "transparent",
                          border: assignee ? undefined : `1.5px dashed ${m.color}`,
                        }}
                      />
                      <span className="cal-chip-t">
                        {format(event.start, "h:mm a").replace(":00", "")}
                      </span>
                      <span className="cal-chip-n">
                        {shortName(event.title || "")}
                      </span>
                      {assignee ? (
                        <span className="cal-chip-who">{initials(assignee)}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              {/* Sibling of the chip list, NOT a child of it: `.cal-mcell-jobs`
                  is `overflow:hidden` and shrinks before the cell does, so a
                  "+N more" inside it was clipped to a 2px hit-target on every
                  busy day. Out here the chips are what give way when a cell
                  runs short, and the only affordance for the rest of the day's
                  jobs stays whole and clickable. */}
              {list.length > MONTH_CARDS_PER_DAY ? (
                <button
                  className="cal-more"
                  onClick={(e) => {
                    e.stopPropagation();
                    goToDay(day);
                  }}>
                  +{list.length - MONTH_CARDS_PER_DAY} more
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};
