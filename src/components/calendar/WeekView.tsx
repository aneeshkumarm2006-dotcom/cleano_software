"use client";

import React, {
  useEffect,
  useState,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { useCalendar } from "./CalendarContext";
import { useCalendarConfig } from "@/contexts/CalendarConfigContext";
import { startOfWeek, addDays, isSameDay, eventOverlapsDay } from "./utils";
import { CalendarEvent } from "./types";
import { getEventStyleInfo, EventTypesConfig } from "./event-styles";
import {
  MIN_EVENT_HEIGHT,
  DRAG_THRESHOLD,
  OfficeHours,
  getVisibleTimeBounds,
  calculateEventPosition,
  getBorderRadiusClasses,
  computeEventLayout,
  formatHour,
} from "./calendar-helpers";
import { CurrentTimeIndicator } from "./calendar-components";
import { ScheduleBlocksConfig } from "@/types/calendar";
import { HiMapPin } from "react-icons/hi2";
import EventCard from "./EventCard";
import ScheduleBlocks from "./ScheduleBlocks";
import AvailabilityOverlay from "./AvailabilityOverlay";
import { getCurrentTimeMeta } from "./time-utils";
import useDragSelection from "./useDragSelection";
import { useCalendarOverlays } from "./CalendarOverlaysContext";

/** Selection preview overlay during drag */
const SelectionPreview: React.FC<{
  start: { day: Date; minutes: number };
  end: { day: Date; minutes: number };
  weekDays: Date[];
  zoomLevel: number;
  officeHours: OfficeHours | null;
}> = ({ start, end, weekDays, zoomLevel, officeHours }) => {
  // Calculate which days are selected
  const startDayIndex = weekDays.findIndex(
    (d) => d.toDateString() === start.day.toDateString()
  );
  const endDayIndex = weekDays.findIndex(
    (d) => d.toDateString() === end.day.toDateString()
  );

  if (startDayIndex === -1 || endDayIndex === -1) return null;

  // Normalize direction
  const minDayIndex = Math.min(startDayIndex, endDayIndex);
  const maxDayIndex = Math.max(startDayIndex, endDayIndex);

  // Calculate time bounds
  let startMinutes = start.minutes;
  let endMinutes = end.minutes;

  // For single-day selection, normalize the order
  if (startDayIndex === endDayIndex) {
    if (endMinutes < startMinutes) {
      [startMinutes, endMinutes] = [endMinutes, startMinutes];
    }
  } else {
    // For multi-day, use the earlier day's time as start
    if (startDayIndex > endDayIndex) {
      startMinutes = end.minutes;
      endMinutes = start.minutes;
    }
  }

  const officeStart = officeHours?.start || 0;

  // Convert minutes to pixel position
  const minutesToTop = (mins: number) => {
    const hoursFromOfficeStart = (mins - officeStart * 60) / 60;
    return hoursFromOfficeStart * zoomLevel;
  };

  const previews: React.ReactNode[] = [];

  for (let dayIndex = minDayIndex; dayIndex <= maxDayIndex; dayIndex++) {
    let dayStartMinutes: number;
    let dayEndMinutes: number;

    if (minDayIndex === maxDayIndex) {
      // Single day selection
      dayStartMinutes = startMinutes;
      dayEndMinutes = endMinutes;
    } else if (dayIndex === minDayIndex) {
      // First day of multi-day selection
      dayStartMinutes =
        startDayIndex < endDayIndex ? startMinutes : endMinutes - 15;
      dayEndMinutes = (officeHours?.end || 24) * 60;
    } else if (dayIndex === maxDayIndex) {
      // Last day of multi-day selection
      dayStartMinutes = (officeHours?.start || 0) * 60;
      dayEndMinutes =
        startDayIndex < endDayIndex ? endMinutes : startMinutes + 15;
    } else {
      // Middle days - full day
      dayStartMinutes = (officeHours?.start || 0) * 60;
      dayEndMinutes = (officeHours?.end || 24) * 60;
    }

    const top = minutesToTop(dayStartMinutes);
    const bottom = minutesToTop(dayEndMinutes);
    const height = Math.max(bottom - top, zoomLevel / 4); // Minimum height

    previews.push(
      <div
        key={dayIndex}
        className="absolute z-40 pointer-events-none bg-[#008C9C]/[0.08]"
        style={{
          left: `${(dayIndex / 7) * 100}%`,
          width: `${100 / 7}%`,
          top: `${top}px`,
          height: `${height}px`,
        }}
      />
    );
  }

  return <>{previews}</>;
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const WeekView: React.FC = () => {
  // ---------------------------------------------------------------------------
  // Context & Config
  // ---------------------------------------------------------------------------
  const {
    currentDate,
    events,
    zoomLevel,
    previewEvent,
    openModalWithPreset,
    openEventModalAtTime,
    openEventDetailsModal,
    openEventModal,
    // Drag selection state
    isDraggingSelection,
    setIsDraggingSelection,
    dragSelectionStart,
    setDragSelectionStart,
    dragSelectionEnd,
    setDragSelectionEnd,
    dragStartPosition,
    setDragStartPosition,
  } = useCalendar();

  const { config: calendarConfig } = useCalendarConfig();
  const { availability: showAvailability, blocks: showBlocks } = useCalendarOverlays();

  // ---------------------------------------------------------------------------
  // Derived Config
  // ---------------------------------------------------------------------------
  const scheduleBlocks =
    ((calendarConfig as any)?.scheduleBlocks as ScheduleBlocksConfig) || {};
  const eventTypesConfig = (calendarConfig?.eventTypes ||
    {}) as EventTypesConfig;
  const use24HourClock = !!calendarConfig?.use24HourClock;

  // ---------------------------------------------------------------------------
  // Refs
  // ---------------------------------------------------------------------------
  const weekGridRef = useRef<HTMLDivElement>(null);
  const dayColumnRefs = useRef<(HTMLDivElement | null)[]>([]);

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const [currentTime, setCurrentTime] = useState(new Date());

  // Update current time every second
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // ---------------------------------------------------------------------------
  // Computed Values
  // ---------------------------------------------------------------------------

  /** Office hours configuration */
  const officeHours = useMemo((): OfficeHours | null => {
    if (
      !calendarConfig?.hideNonOfficeHours ||
      !calendarConfig?.officeHoursStart ||
      !calendarConfig?.officeHoursEnd
    ) {
      return null;
    }
    const start = parseInt(calendarConfig.officeHoursStart.split(":")[0], 10);
    const end = parseInt(calendarConfig.officeHoursEnd.split(":")[0], 10);
    if (start >= 0 && start <= 23 && end >= 0 && end <= 23 && start < end) {
      return { start, end };
    }
    return null;
  }, [calendarConfig]);

  /** Array of visible hours */
  const visibleHours = useMemo(
    () =>
      officeHours
        ? Array.from(
            { length: officeHours.end - officeHours.start + 1 },
            (_, i) => i + officeHours.start
          )
        : Array.from({ length: 25 }, (_, i) => i),
    [officeHours]
  );

  /** Total grid height in pixels */
  const gridHeight = visibleHours.length * zoomLevel;

  /** Week start date and array of 7 days */
  const weekStart = startOfWeek(currentDate);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  /** Current time indicator meta */
  const { show: showCurrentTimeIndicator, top: currentTimeTop } =
    getCurrentTimeMeta(currentTime, officeHours, zoomLevel, {
      days: weekDays,
    });

  // ---------------------------------------------------------------------------
  // Event Handlers
  // ---------------------------------------------------------------------------

  /** Handle click on an event */
  const handleEventClick = useCallback(
    (e: React.MouseEvent, event: CalendarEvent) => {
      e.stopPropagation();

      // Ignore preview events
      if (event.id === "preview") return;

      openEventDetailsModal(event);
    },
    [openEventDetailsModal]
  );

  // ---------------------------------------------------------------------------
  // Drag Selection Handlers
  // ---------------------------------------------------------------------------

  /** Convert Y position within grid to minutes from midnight */
  const yPositionToMinutes = useCallback(
    (y: number): number => {
      // Grid height is visibleHours.length * zoomLevel
      const maxY = visibleHours.length * zoomLevel;
      const clampedY = Math.max(0, Math.min(maxY, y));
      // Each pixel represents (60 / zoomLevel) minutes
      const fractionalHours = clampedY / zoomLevel;
      const minutesFromTop = fractionalHours * 60;
      const totalMinutes = minutesFromTop + (officeHours?.start || 0) * 60;
      // Snap to 15-minute intervals
      return Math.floor(totalMinutes / 15) * 15;
    },
    [zoomLevel, officeHours, visibleHours.length]
  );

  /** Determine which day column the mouse is over based on X position */
  const getDayFromXPosition = useCallback(
    (clientX: number): Date | null => {
      for (let i = 0; i < dayColumnRefs.current.length; i++) {
        const colEl = dayColumnRefs.current[i];
        if (colEl) {
          const rect = colEl.getBoundingClientRect();
          if (clientX >= rect.left && clientX <= rect.right) {
            return weekDays[i];
          }
        }
      }
      return null;
    },
    [weekDays]
  );

  const toTimeStr = useCallback((mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
  }, []);

  const { startSelection: startDragSelection } = useDragSelection({
    gridRef: weekGridRef,
    yToMinutes: yPositionToMinutes,
    getDayFromXPosition,
    snapMinutes: 15,
    dragThreshold: DRAG_THRESHOLD,
    state: {
      dragSelectionStart,
      setDragSelectionStart,
      dragSelectionEnd,
      setDragSelectionEnd,
      dragStartPosition,
      setDragStartPosition,
      isDraggingSelection,
      setIsDraggingSelection,
    },
    onComplete: (start, end) => {
      const startTimeStr = toTimeStr(start.minutes);
      const endTimeStr = toTimeStr(end.minutes);
      openEventModal(start.day, startTimeStr, endTimeStr);
    },
  });

  /** Handle mouse down on 15-minute tile - start drag selection */
  const handleDragSelectionStart = useCallback(
    (
      e: React.MouseEvent,
      day: Date,
      hourIndex: number,
      minuteOffset: number = 0
    ) => {
      const actualHour = visibleHours[hourIndex];
      const startMinutes = actualHour * 60 + minuteOffset;
      startDragSelection(e, day, startMinutes);
    },
    [visibleHours, startDragSelection]
  );

  /** Handle preset drop from sidebar */
  const handlePresetDrop = useCallback(
    (e: React.DragEvent, day: Date) => {
      e.preventDefault();
      const preset = JSON.parse(e.dataTransfer.getData("application/json"));
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const y = e.clientY - rect.top;

      // Snap to 15-minute intervals
      const clamped = Math.max(0, Math.min(rect.height, y));
      const snappedY = Math.round(clamped / 15) * 15;

      // Convert Y position to time
      const totalMinutes =
        Math.max(
          0,
          Math.min((visibleHours.length - 1) * 60, Math.round(snappedY))
        ) +
        (officeHours?.start || 0) * 60;
      const startTime = new Date(day);
      startTime.setHours(
        Math.floor(totalMinutes / 60),
        totalMinutes % 60,
        0,
        0
      );

      openModalWithPreset(preset, startTime);
    },
    [visibleHours.length, officeHours, openModalWithPreset]
  );

  // ---------------------------------------------------------------------------
  // Render Helpers
  // ---------------------------------------------------------------------------

  /** Render a single event card */
  const renderEventCard = useCallback(
    (
      event: CalendarEvent,
      day: Date,
      layout: { index: number; total: number }
    ) => {
      const position = calculateEventPosition(
        event,
        day,
        officeHours,
        zoomLevel,
        layout
      );
      if (!position) return null;

      const styleInfo = getEventStyleInfo(event, eventTypesConfig);
      const { start: visibleStart, end: visibleEnd } = getVisibleTimeBounds(
        day,
        officeHours
      );
      const eventEnd =
        event.end || new Date(event.start.getTime() + 60 * 60 * 1000);
      const segStart = new Date(
        Math.max(event.start.getTime(), visibleStart.getTime())
      );
      const segEnd = new Date(
        Math.min((event.end || eventEnd).getTime(), visibleEnd.getTime())
      );
      const isBeingMoved = event.id === "preview";

      return (
        <EventCard
          key={event.id}
          event={event}
          layout={{
            top: position.top,
            height: position.height,
            left: position.left,
            width: position.width,
          }}
          styleInfo={styleInfo}
          isBeingMoved={isBeingMoved}
          canResize={false}
          minEventHeight={MIN_EVENT_HEIGHT}
          className={getBorderRadiusClasses(event, segStart, segEnd)}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => handleEventClick(e, event)}
          renderLocation={(ev, color) =>
            ev.metadata?.location ? (
              <div
                className="app-subtitle truncate text-[10px] flex items-center gap-0.5"
                style={{ color, opacity: 0.7 }}>
                <HiMapPin className="w-3 h-3" /> {ev.metadata.location}
              </div>
            ) : null
          }
        />
      );
    },
    [officeHours, zoomLevel, eventTypesConfig, handleEventClick]
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const baseHour = visibleHours[0] ?? 0;
  const officeTop = (8 - baseHour) * zoomLevel;
  const officeHeight = 10 * zoomLevel; // 8 → 18

  return (
    <div className="cal-grid admin-font">
      <div className="cal-grid-inner">
        {/* Sticky day-header row */}
        <div className="cal-grid-header">
          <div className="cal-gutter-head" />
          {weekDays.map((day) => {
            const isToday = isSameDay(day, currentTime);
            const count = events.filter((e) => eventOverlapsDay(e, day)).length;
            return (
              <div key={day.toISOString()} className={`cal-dayhead ${isToday ? "today" : ""}`}>
                <span className="cal-dayhead-dow">
                  {day.toLocaleDateString("en-US", { weekday: "short" })}
                </span>
                <span className={`cal-dayhead-num ${isToday ? "today" : ""}`}>
                  {day.getDate()}
                </span>
                {count ? <span className="cal-dayhead-count">{count}</span> : null}
              </div>
            );
          })}
        </div>

        <div className="cal-grid-scroll">
          {/* Hour gutter */}
          <div className="cal-gutter">
            {visibleHours.map((hour) => (
              <div key={hour} className="cal-hour" style={{ height: `${zoomLevel}px` }}>
                <span>{formatHour(hour, use24HourClock)}</span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          <div
            className="cal-cols"
            data-week-grid="true"
            ref={weekGridRef}
            style={{ height: `${gridHeight}px` }}>
            {/* Hour lines + now-line + selection preview */}
            <div className="cal-hourlines">
              {visibleHours.map((hour) => (
                <div key={hour} className="cal-hline" style={{ height: `${zoomLevel}px` }} />
              ))}
              {showCurrentTimeIndicator && <CurrentTimeIndicator top={currentTimeTop} />}
              {isDraggingSelection && dragSelectionStart && dragSelectionEnd && (
                <SelectionPreview
                  start={dragSelectionStart}
                  end={dragSelectionEnd}
                  weekDays={weekDays}
                  zoomLevel={zoomLevel}
                  officeHours={officeHours}
                />
              )}
            </div>

            {weekDays.map((day, index) => {
              const dayEvents = [
                ...events,
                ...(previewEvent && eventOverlapsDay(previewEvent, day)
                  ? [previewEvent]
                  : []),
              ].filter((event) => eventOverlapsDay(event, day));

              const layoutMap = computeEventLayout(dayEvents, null);

              return (
                <div
                  key={day.toISOString()}
                  ref={(el) => {
                    dayColumnRefs.current[index] = el;
                  }}
                  data-day-column={index}
                  className="cal-col"
                  style={{ minHeight: `${gridHeight}px` }}
                  onDrop={(e) => handlePresetDrop(e, day)}
                  onDragOver={(e) => e.preventDefault()}>
                  {/* Office-hours shading (8am–6pm) */}
                  {officeHeight > 0 && (
                    <div className="cal-office" style={{ top: `${officeTop}px`, height: `${officeHeight}px` }} />
                  )}

                  {/* Schedule Blocks */}
                  {showBlocks && (
                    <ScheduleBlocks
                      day={day}
                      scheduleBlocks={scheduleBlocks}
                      officeHours={officeHours}
                      zoomLevel={zoomLevel}
                    />
                  )}

                  {/* Availability Overlay */}
                  {showAvailability && (
                    <AvailabilityOverlay
                      day={day}
                      officeHours={officeHours}
                      zoomLevel={zoomLevel}
                    />
                  )}

                  {/* Events */}
                  {dayEvents.map((event) => {
                    const layout = layoutMap[event.id];
                    if (!layout) return null;
                    return renderEventCard(event, day, layout);
                  })}

                  {/* 15-Minute Tile Drag Handlers */}
                  {visibleHours.flatMap((hour, hourIndex) =>
                    [0, 15, 30, 45].map((minutes) => (
                      <div
                        key={`${hour}-${minutes}`}
                        className={`absolute left-0 right-0 z-20 transition-colors duration-200 ${
                          isDraggingSelection
                            ? "cursor-crosshair"
                            : "cursor-pointer hover:bg-[#008C9C]/[0.05]"
                        }`}
                        style={{
                          top: `${hourIndex * zoomLevel + (minutes * zoomLevel) / 60}px`,
                          height: `${zoomLevel / 4}px`,
                        }}
                        onMouseDown={(e) =>
                          handleDragSelectionStart(e, day, hourIndex, minutes)
                        }
                      />
                    ))
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
