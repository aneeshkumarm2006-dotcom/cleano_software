"use client";

import React, { useMemo } from "react";
import { useCalendar } from "@/components/calendar/CalendarContext";
import {
  addDays,
  eventOverlapsDay,
  startOfMonth,
  endOfMonth,
  startOfWeek,
} from "@/components/calendar/utils";
import { CalendarEvent } from "@/components/calendar/types";
import { AlertCircle } from "lucide-react";
import {
  statusMeta,
  hasMissingEquipment,
  payLabel,
  shortLocation,
} from "./status-meta";

type ListViewProps = {
  view: "month" | "week" | "day";
};

const JOB_TYPE_LABEL: Record<string, string> = {
  R: "Residential",
  C: "Commercial",
  PC: "Post construction",
  F: "Follow-up",
};

function timeStr(d: Date) {
  return d
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .replace(":00", "");
}

function durationLabel(event: CalendarEvent) {
  const end = event.end ?? new Date(event.start.getTime() + 2 * 3600000);
  const hrs = (end.getTime() - event.start.getTime()) / 3600000;
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
                {dayEvents.length} {dayEvents.length === 1 ? "job" : "jobs"}
              </span>
            </div>
            {dayEvents.map((event) => {
              const m = statusMeta(event);
              const jt = event.metadata?.jobType as string | undefined;
              const typeName = (jt && JOB_TYPE_LABEL[jt]) || jt || "Clean";
              const loc = shortLocation(event);
              const pay = payLabel(event);
              return (
                <button
                  key={event.id}
                  className="cal-list-row"
                  onClick={() => openEventDetailsModal(event)}>
                  <span className="cal-list-bar" style={{ background: m.color }} />
                  <span className="cal-list-time">
                    {timeStr(event.start)}
                    <span className="cal-list-dur">{durationLabel(event)}</span>
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
