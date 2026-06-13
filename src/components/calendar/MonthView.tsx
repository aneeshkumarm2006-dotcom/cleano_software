"use client";
import React from "react";
import { useCalendar } from "@/components/calendar/CalendarContext";
import { useCalendarConfig } from "@/contexts/CalendarConfigContext";
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
import { CalendarEvent } from "./types";
import {
  getEventStyleInfo,
  getEventBackgroundColor,
  getEventBoxShadow,
  EventTypesConfig,
} from "./event-styles";

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const MonthView = () => {
  const {
    currentDate,
    events,
    openEventDetailsModal,
    setCurrentDate,
    setView,
    eventsLoading: isLoading,
  } = useCalendar();
  const { config: calendarConfig } = useCalendarConfig();

  const eventTypesConfig = (calendarConfig?.eventTypes ||
    {}) as EventTypesConfig;

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = addDays(startOfWeek(monthEnd), 6);

  const days: Date[] = [];
  let day = new Date(startDate);
  while (day <= endDate) {
    days.push(new Date(day));
    day = addDays(day, 1);
  }

  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  const handleDayClick = (date: Date, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-event-card]")) {
      return;
    }
    // Navigate to week view for the clicked day
    setCurrentDate(date);
    setView("week");
  };

  const handleEventClick = (e: React.MouseEvent, event: CalendarEvent) => {
    e.stopPropagation();
    openEventDetailsModal(event);
  };

  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="flex flex-col h-full">
      {/* Day Headers - Fixed */}
      <div className="flex-shrink-0 pb-4 px-4">
        <div className="grid grid-cols-7">
          {dayLabels.map((label, index) => {
            const isWeekend = index === 0 || index === 6;
            return (
              <div
                key={label}
                className={`flex items-center justify-center p-2 rounded-xl ${
                  isWeekend ? "bg-[#005F6A]/[0.02]" : ""
                }`}>
                <span className="app-title-small !font-[450] !text-[#005F6A]/60">
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Month Grid - Scrollable */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="grid grid-cols-7 min-h-full">
          {weeks.flat().map((day, index) => {
            const isCurrentMonth = isSameMonth(day, monthStart);
            const isToday = isSameDay(day, new Date());
            const isWeekend = day.getDay() === 0 || day.getDay() === 6;
            // Deduplicate by id so the same event isn't rendered twice for a day
            const dayEvents = Array.from(
              new Map(
                events
                  .filter((e) => eventOverlapsDay(e, day))
                  .map((e) => [e.id, e])
              ).values()
            );
            const isFirstRow = index < 7;

            return (
              <div
                key={day.toISOString()}
                className={`min-h-[120px] p-2 cursor-pointer transition-colors border-[#005F6A]/5 ${
                  index % 7 !== 0 ? "border-l" : ""
                } ${!isFirstRow ? "border-t" : ""} ${
                  isWeekend ? "bg-[#005F6A]/[0.02]" : ""
                } ${isCurrentMonth ? "hover:bg-[#005F6A]/[0.04]" : "bg-[#005F6A]/[0.1] opacity-10"} `}
                onClick={(e) => handleDayClick(day, e)}>
                {/* Day Number + cleanings count */}
                <div className="flex items-center gap-1 mb-2">
                  <span
                    className={`app-title ${
                      isToday
                        ? "bg-[#005F6A] !text-white px-2 py-0.5 rounded-lg"
                        : isCurrentMonth
                          ? "text-[#005F6A]"
                          : "text-[#005F6A]/5"
                    }`}>
                    {format(day, "d")}
                  </span>
                  {(() => {
                    const cleanings = dayEvents.filter(
                      (e) => !!e.metadata?.jobId
                    ).length;
                    return cleanings > 0 && isCurrentMonth ? (
                      <span
                        title={`${cleanings} cleaning${cleanings === 1 ? "" : "s"}`}
                        className="app-subtitle ml-auto !text-[10px] font-[600] text-[#005F6A] bg-[#005F6A]/10 px-1.5 py-0.5 rounded-full">
                        {cleanings}
                      </span>
                    ) : null;
                  })()}
                </div>

                {/* Events */}
                <div className="space-y-1">
                  {isLoading ? (
                    <>
                      {[0, 1, 2].map((i) => (
                        <div
                          key={`skeleton-${day.toISOString()}-${i}`}
                          className="px-2 py-1 rounded-lg bg-[#005F6A]/10 animate-pulse h-[40px]"
                        />
                      ))}
                    </>
                  ) : (
                    <>
                      {dayEvents.slice(0, 3).map((event) => {
                        const styleInfo = getEventStyleInfo(
                          event,
                          eventTypesConfig
                        );
                        const isJob = !!event.metadata?.jobId;

                        return (
                          <div
                            key={event.id}
                            data-event-card
                            className={`px-2 py-1 rounded-lg cursor-pointer transition-all hover:scale-[1.01]`}
                            style={{
                              backgroundColor:
                                getEventBackgroundColor(styleInfo),
                              color: styleInfo.color,
                              boxShadow: getEventBoxShadow(styleInfo),
                            }}
                            onClick={(e) => handleEventClick(e, event)}>
                            <div className="flex items-center justify-between gap-1">
                              <div className="app-title-small truncate flex-1">
                                {event.title}
                              </div>
                              {isJob &&
                                event.metadata?.status &&
                                event.metadata.status !== "CREATED" && (
                                  <div
                                    className="app-subtitle !text-[10px] px-1.5 py-0.5 rounded"
                                    style={{
                                      backgroundColor: styleInfo.color + "30",
                                      color: styleInfo.color,
                                    }}>
                                    {event.metadata.status.replace(/_/g, " ")}
                                  </div>
                                )}
                            </div>
                            {isJob && event.metadata?.location && (
                              <div className="app-subtitle truncate opacity-70 flex items-center gap-0.5">
                                <svg className="w-2.5 h-2.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                                {event.metadata.location}
                              </div>
                            )}
                            {isJob && (
                              <div className="flex items-center gap-1 flex-wrap">
                                {event.metadata?.jobType && (
                                  <span
                                    className="app-subtitle !text-[9px] px-1 py-0 rounded"
                                    style={{
                                      backgroundColor: styleInfo.color + "20",
                                      color: styleInfo.color,
                                    }}>
                                    {event.metadata.jobType === "R"
                                      ? "Res"
                                      : event.metadata.jobType === "C"
                                      ? "Com"
                                      : event.metadata.jobType === "PC"
                                      ? "Post-C"
                                      : event.metadata.jobType === "F"
                                      ? "F/Up"
                                      : event.metadata.jobType}
                                  </span>
                                )}
                                {event.metadata?.employeePay != null && (
                                  <span className="app-subtitle !text-[9px] font-[450] opacity-80">
                                    ${Number(event.metadata.employeePay).toFixed(0)}
                                  </span>
                                )}
                                {event.metadata?.missingEquipment?.length > 0 && (
                                  <svg
                                    className="w-3 h-3 flex-shrink-0"
                                    style={{ color: "#F59E0B" }}
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    strokeWidth={2}>
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
                                    />
                                  </svg>
                                )}
                              </div>
                            )}
                            {!isJob && event.label && (
                              <div className="app-subtitle truncate opacity-80">
                                {event.label}
                              </div>
                            )}
                            {isJob && event.start && (
                              <div className="app-subtitle truncate opacity-70">
                                {format(event.start, "h:mm a")}
                                {event.end && ` - ${format(event.end, "h:mm a")}`}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {dayEvents.length > 3 && (
                        <div className="app-subtitle !text-[#005F6A]/50 pl-1">
                          +{dayEvents.length - 3} more
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

