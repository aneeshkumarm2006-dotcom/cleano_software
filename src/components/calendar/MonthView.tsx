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
import { statusMeta, isUnconfirmed } from "./status-meta";
import CornerBadge from "./CornerBadge";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
          return (
            <div
              key={i}
              className={`cal-mcell ${inMonth ? "" : "out"} ${today ? "today" : ""}`}
              onClick={() => goToDay(day)}>
              <div className="cal-mcell-head">
                {list.length ? (
                  <span className="cal-mcount">
                    {list.length} {list.length === 1 ? "job" : "jobs"}
                  </span>
                ) : (
                  <span />
                )}
                <span className={`cal-mdate ${today ? "today" : ""}`}>
                  {format(day, "d")}
                </span>
              </div>
              <div className="cal-mcell-jobs">
                {list.slice(0, 2).map((event) => {
                  const m = statusMeta(event);
                  return (
                    <button
                      key={event.id}
                      className={`cal-chip ${isUnconfirmed(event) ? "faded" : ""}`}
                      style={{ background: m.tint, color: m.color }}
                      onClick={(e) => {
                        e.stopPropagation();
                        openEventDetailsModal(event);
                      }}>
                      <CornerBadge event={event} />
                      <span className="cal-chip-dot" style={{ background: m.color }} />
                      <span className="cal-chip-t">
                        {format(event.start, "h:mm a").replace(":00", "")}
                      </span>
                      <span className="cal-chip-n">
                        {(event.title || "").split(" ")[0]}
                      </span>
                    </button>
                  );
                })}
                {list.length > 2 ? (
                  <button
                    className="cal-more"
                    onClick={(e) => {
                      e.stopPropagation();
                      goToDay(day);
                    }}>
                    +{list.length - 2} more
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
