"use client";

import React, { useMemo } from "react";
import { useCalendar } from "@/components/calendar/CalendarContext";
import {
  addDays,
  eventOverlapsDay,
  hasRealEnd,
  startOfMonth,
  endOfMonth,
  startOfWeek,
} from "@/components/calendar/utils";
import { CalendarEvent } from "@/components/calendar/types";
import { AlertCircle } from "lucide-react";
import {
  statusMeta,
  hasMissingEquipment,
  hourlyLabel,
  propertyLabel,
  priceLabel,
  cleanerLabel,
  shortLocation,
  isCancelled,
} from "./status-meta";
import { jobTypeLabel } from "@/lib/calendar-labels";

type ListViewProps = {
  view: "month" | "week" | "day";
};

function timeStr(d: Date) {
  // Floating Toronto wall-clock date (see getJobsForDay/toBusinessWallClock).
  return d
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .replace(":00", "");
}

/**
 * Length of the booking, or null when it doesn't have one.
 *
 * Half the live jobs store `endTime === startTime` (see `eventEnd` in ./utils),
 * which this printed as a flat **"0h"** under every one of their start times.
 * The old `?? +2h` fallback never fired for them either — and inventing a
 * duration is the wrong repair anyway, so an unknown length now prints nothing.
 */
function durationLabel(event: CalendarEvent): string | null {
  if (!hasRealEnd(event)) return null;
  const hrs = (event.end!.getTime() - event.start.getTime()) / 3600000;
  return `${Math.round(hrs * 10) / 10}h`;
}

export const ListView: React.FC<ListViewProps> = ({ view }) => {
  const { currentDate, events, openEventDetailsModal } = useCalendar();

  const days = useMemo(() => {
    if (view === "day") return [currentDate];
    if (view === "week") {
      const weekStart = startOfWeek(currentDate);
      return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    }
    const start = startOfMonth(currentDate);
    const end = endOfMonth(currentDate);
    const result: Date[] = [];
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) result.push(new Date(d));
    return result;
  }, [currentDate, view]);

  const groups = useMemo(
    () =>
      days
        .map((day) => ({
          day,
          dayEvents: Array.from(
            new Map(
              events.filter((e) => eventOverlapsDay(e, day)).map((e) => [e.id, e])
            ).values()
          ).sort((a, b) => a.start.getTime() - b.start.getTime()),
        }))
        .filter((g) => g.dayEvents.length > 0),
    [days, events]
  );

  return (
    <div className="cal-list admin-font">
      {groups.length === 0 ? (
        <div className="cal-ag-empty" style={{ padding: 32, textAlign: "center" }}>
          No jobs in this range.
        </div>
      ) : (
        groups.map(({ day, dayEvents }) => (
          <div key={day.toISOString()} className="cal-list-group">
            <div className="cal-list-daylabel">
              <span className="cal-list-dayname">
                {day.toLocaleDateString("en-US", { weekday: "long" })}
              </span>
              <span className="cal-list-daydate">
                {day.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
              <span className="cal-list-count">
                {/* Active work, not rows — same rule as the month grid. */}
                {dayEvents.filter((e) => !isCancelled(e)).length}{" "}
                {dayEvents.filter((e) => !isCancelled(e)).length === 1 ? "job" : "jobs"}
              </span>
            </div>
            {dayEvents.map((event) => {
              const m = statusMeta(event);
              const jt = event.metadata?.jobType as string | undefined;
              const typeName = jt ? jobTypeLabel(jt) : "Clean";
              const loc = shortLocation(event);
              const pay = priceLabel(event);
              const who = cleanerLabel(event);
              // "Hourly · 4h" (Stage 8). Carries no rate, so it is safe for
              // every viewer the list serves — see hourlyLabel's note.
              const hourly = hourlyLabel(event);
              // "Apt" / "House" (Stage 9). Null when unrecorded, and carries no
              // money, so it is safe for every viewer this list serves.
              const property = propertyLabel(event);
              return (
                <button
                  key={event.id}
                  className="cal-list-row"
                  onClick={() => openEventDetailsModal(event)}>
                  <span className="cal-list-bar" style={{ background: m.color }} />
                  <span className="cal-list-time">
                    {timeStr(event.start)}
                    {durationLabel(event) ? (
                      <span className="cal-list-dur">{durationLabel(event)}</span>
                    ) : null}
                  </span>
                  <span className="cal-list-main">
                    <span className="cal-list-client">
                      {event.title}
                      {hasMissingEquipment(event) ? (
                        <span className="cal-warn-mini" title="Missing equipment">
                          <AlertCircle size={13} />
                        </span>
                      ) : null}
                    </span>
                    <span className="cal-list-sub">
                      {typeName}
                      {property ? ` · ${property}` : ""}
                      {hourly ? ` · ${hourly}` : ""}
                      {who ? ` · ${who}` : ""}
                      {loc ? ` · ${loc}` : ""}
                    </span>
                  </span>
                  <span>
                    <span className="pill" style={{ background: m.tint, color: m.color }}>
                      <span className="pill-dot" style={{ background: m.color }} />
                      {m.label}
                    </span>
                  </span>
                  {pay ? <span className="cal-list-pay">{pay}</span> : null}
                </button>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
};
