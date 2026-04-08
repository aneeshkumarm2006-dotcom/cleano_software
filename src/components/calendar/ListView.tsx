"use client";

import React, { useMemo } from "react";
import { useCalendar } from "@/components/calendar/CalendarContext";
import { useCalendarConfig } from "@/contexts/CalendarConfigContext";
import {
  addDays,
  eventOverlapsDay,
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
} from "@/components/calendar/utils";
import {
  getEventBackgroundColor,
  getEventBoxShadow,
  getEventStyleInfo,
  EventTypesConfig,
} from "@/components/calendar/event-styles";
import { CalendarEvent } from "@/components/calendar/types";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";

const formatTimeRange = (
  event: CalendarEvent,
  timeFormatter: Intl.DateTimeFormat
) => {
  const startStr = timeFormatter.format(event.start);
  const endStr = event.end ? timeFormatter.format(event.end) : null;
  return endStr ? `${startStr} - ${endStr}` : startStr;
};

type ListViewProps = {
  view: "month" | "week" | "day";
};

export const ListView: React.FC<ListViewProps> = ({ view }) => {
  const { currentDate, events, openEventDetailsModal } = useCalendar();
  const { config: calendarConfig } = useCalendarConfig();

  const eventTypesConfig = (calendarConfig?.eventTypes ||
    {}) as EventTypesConfig;
  const use24HourClock = !!calendarConfig?.use24HourClock;

  const days = useMemo(() => {
    if (view === "day") {
      return [currentDate];
    }

    if (view === "week") {
      const weekStart = startOfWeek(currentDate);
      return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    }

    // Month view: list all days in the month
    const start = startOfMonth(currentDate);
    const end = endOfMonth(currentDate);
    const result: Date[] = [];
    let day = new Date(start);
    while (day <= end) {
      result.push(new Date(day));
      day = addDays(day, 1);
    }
    return result;
  }, [currentDate, view]);

  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
        hour12: !use24HourClock,
      }),
    [use24HourClock]
  );

  const eventsByDay = useMemo(() => {
    return days.map((day) => {
      const dayEvents = Array.from(
        new Map(
          events.filter((e) => eventOverlapsDay(e, day)).map((e) => [e.id, e])
        ).values()
      ).sort((a, b) => a.start.getTime() - b.start.getTime());
      return { day, dayEvents };
    });
  }, [days, events]);

  const renderEvent = (event: CalendarEvent) => {
    const styleInfo = getEventStyleInfo(event, eventTypesConfig);
    return (
      <Button
        key={event.id}
        variant="primary"
        border={false}
        className="w-full flex items-start gap-3 text-left !rounded-2xl"
        style={{
          backgroundColor: getEventBackgroundColor(styleInfo),
          boxShadow: getEventBoxShadow(styleInfo),
        }}
        onClick={() => openEventDetailsModal(event)}>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span
              className="app-title-small truncate"
              style={{ color: styleInfo.color }}>
              {event.title}
            </span>
            {event.metadata?.jobId && (
              <Badge size="sm" variant="secondary">
                Job
              </Badge>
            )}
            {event.label && (
              <Badge size="sm" variant="default">
                {event.label}
              </Badge>
            )}
          </div>
          <div className="app-subtitle !text-[#005F6A]/70">
            {formatTimeRange(event, timeFormatter)}
          </div>
          {event.description && (
            <div className="text-xs text-[#005F6A]/70 line-clamp-2">
              {event.description}
            </div>
          )}
        </div>
      </Button>
    );
  };

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {eventsByDay.map(({ day, dayEvents }) => (
        <Card
          variant="ghost"
          key={day.toISOString()}
          className="space-y-3 !p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="app-title">{format(day, "EEEE, d MMMM yyyy")}</p>
              <p className="app-subtitle !text-[#005F6A]/60">
                {dayEvents.length} event{dayEvents.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>

          {dayEvents.length === 0 ? (
            <div className="text-sm text-[#005F6A]/50">No events</div>
          ) : (
            <div className="space-y-2">
              {dayEvents.map((event) => renderEvent(event))}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
};
