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
import { isSameDay, eventOverlapsDay, isEventUnassigned } from "./utils";
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
import EventCard from "./EventCard";
import ScheduleBlocks from "./ScheduleBlocks";
import { getCurrentTimeMeta, useTimezoneLabel } from "./time-utils";
import useDragSelection from "./useDragSelection";

/** Selection preview overlay during drag */
const SelectionPreview: React.FC<{
  start: { day: Date; minutes: number };
  end: { day: Date; minutes: number };
  roomColumns: string[];
  zoomLevel: number;
  officeHours: OfficeHours | null;
  currentRoomIndex: number;
}> = ({
  start,
  end,
  roomColumns,
  zoomLevel,
  officeHours,
  currentRoomIndex,
}) => {
  // For day view, we only show preview in the current room column
  if (currentRoomIndex === -1) return null;

  const officeStart = officeHours?.start || 0;

  // Convert minutes to pixel position
  const minutesToTop = (mins: number) => {
    const hoursFromOfficeStart = (mins - officeStart * 60) / 60;
    return hoursFromOfficeStart * zoomLevel;
  };

  // Calculate time bounds
  let startMinutes = start.minutes;
  let endMinutes = end.minutes;

  // Normalize the order
  if (endMinutes < startMinutes) {
    [startMinutes, endMinutes] = [endMinutes, startMinutes];
  }

  const top = minutesToTop(startMinutes);
  const bottom = minutesToTop(endMinutes);
  const height = Math.max(bottom - top, zoomLevel / 4);

  return (
    <div
      className="absolute z-40 pointer-events-none bg-[#005F6A]/[0.08]"
      style={{
        left: `${(currentRoomIndex / roomColumns.length) * 100}%`,
        width: `${100 / roomColumns.length}%`,
        top: `${top}px`,
        height: `${height}px`,
      }}
    />
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const DayView: React.FC = () => {
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
  const dayGridRef = useRef<HTMLDivElement>(null);
  const roomColumnRefs = useRef<(HTMLDivElement | null)[]>([]);

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const [currentTime, setCurrentTime] = useState(new Date());
  const [currentDragRoomIndex, setCurrentDragRoomIndex] = useState<number>(-1);

  // Update current time every second
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // ---------------------------------------------------------------------------
  // Computed Values
  // ---------------------------------------------------------------------------

  /** Timezone label (e.g., "GMT+2") */
  const timezoneLabel = useTimezoneLabel();

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

  /** Current time indicator meta */
  const { show: showCurrentTimeIndicator, top: currentTimeTop } =
    getCurrentTimeMeta(currentTime, officeHours, zoomLevel, {
      day: currentDate,
    });

  /** Day events including preview */
  const dayEvents = useMemo(() => {
    const baseEvents = events.filter((event) =>
      eventOverlapsDay(event, currentDate)
    );
    if (previewEvent && eventOverlapsDay(previewEvent, currentDate)) {
      return [...baseEvents, previewEvent];
    }
    return baseEvents;
  }, [events, previewEvent, currentDate]);

  // Get all available rooms from calendar config
  const allRooms = calendarConfig?.labels || [];
  const hasRooms = allRooms.length > 0;

  // Get list of existing room names for comparison
  const existingRoomNames = useMemo(
    () => allRooms.map((room: any) => room.name),
    [allRooms]
  );

  // Check if there are events without rooms or with deleted room assignments
  const eventsWithoutRooms = useMemo(
    () =>
      dayEvents.filter((event) => isEventUnassigned(event, existingRoomNames)),
    [dayEvents, existingRoomNames]
  );
  const hasEventsWithoutRooms = eventsWithoutRooms.length > 0;

  // Set up room display variables
  const roomNames = useMemo(() => {
    const names: string[] = [];

    // Add configured room columns
    if (hasRooms) {
      names.push(...allRooms.map((room: any) => room.name));
    }

    // Always add "Unassigned Events" column if there are events without rooms
    if (hasEventsWithoutRooms) {
      names.push("Unassigned Events");
    }

    // If no rooms and no unassigned events, show a default column
    if (names.length === 0) {
      names.push("All Events");
    }

    return names;
  }, [hasRooms, allRooms, hasEventsWithoutRooms]);

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

  const toTimeStr = useCallback((mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
  }, []);

  const { startSelection: startDragSelection } = useDragSelection({
    gridRef: dayGridRef,
    yToMinutes: yPositionToMinutes,
    snapMinutes: 15,
    dragThreshold: DRAG_THRESHOLD,
    onPreviewChange: setCurrentDragRoomIndex,
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
      openEventModal(currentDate, startTimeStr, endTimeStr);
      setCurrentDragRoomIndex(-1);
    },
  });

  /** Handle mouse down on 15-minute tile - start drag selection */
  const handleDragSelectionStart = useCallback(
    (
      e: React.MouseEvent,
      roomIndex: number,
      hourIndex: number,
      minuteOffset: number = 0
    ) => {
      const actualHour = visibleHours[hourIndex];
      const startMinutes = actualHour * 60 + minuteOffset;
      startDragSelection(e, currentDate, startMinutes, roomIndex);
    },
    [visibleHours, currentDate, startDragSelection]
  );

  /** Handle preset drop from sidebar */
  const handlePresetDrop = useCallback(
    (e: React.DragEvent, roomName?: string) => {
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
      const startTime = new Date(currentDate);
      startTime.setHours(
        Math.floor(totalMinutes / 60),
        totalMinutes % 60,
        0,
        0
      );

      openModalWithPreset(preset, startTime);
    },
    [visibleHours.length, officeHours, currentDate, openModalWithPreset]
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

      // Calculate segment bounds for border radius
      const eventEnd =
        event.end || new Date(event.start.getTime() + 60 * 60 * 1000);
      const segStart = new Date(
        Math.max(event.start.getTime(), visibleStart.getTime())
      );
      const segEnd = new Date(
        Math.min((event.end || eventEnd).getTime(), visibleEnd.getTime())
      );
      const borderRadiusClasses = getBorderRadiusClasses(
        event,
        segStart,
        segEnd
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
          className={borderRadiusClasses}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => handleEventClick(e, event)}
          renderLocation={(ev, color) =>
            ev.metadata?.location ? (
              <div
                className="app-subtitle truncate text-[10px]"
                style={{ color, opacity: 0.7 }}>
                📍 {ev.metadata.location}
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
  return (
    <div className="flex flex-col h-full">
      {/* Header Row - Fixed */}
      <div className="flex-shrink-0 flex pb-0 px-4 overflow-x-auto">
        {/* Timezone Label */}
        <div className="w-10 flex-shrink-0 flex flex-col items-center justify-end py-3">
          <span className="app-subtitle !text-[#005F6A]/50">
            {timezoneLabel}
          </span>
        </div>

        {/* Room Headers */}
        <div className="flex-1 flex bg-transparent min-w-fit">
          {roomNames.map((roomName) => (
            <div
              key={roomName}
              className={`flex items-baseline gap-1 p-2 rounded-xl min-w-[200px] flex-1 ${
                roomName === "Unassigned Events" ? "bg-[#005F6A]/5" : ""
              }`}>
              <span
                className={`app-title ${
                  roomName === "Unassigned Events"
                    ? "text-[#005F6A]/70 italic"
                    : "text-[#005F6A]"
                }`}>
                {roomName}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Time Grid - Scrollable */}
      <div className="flex flex-1 overflow-y-auto overflow-x-auto p-4">
        {/* Time Labels Column */}
        <div className="w-10 flex-shrink-0 flex flex-col select-none">
          {visibleHours.map((hour) => (
            <div
              key={hour}
              className="relative flex-shrink-0"
              style={{ height: `${zoomLevel}px` }}>
              <span className="absolute right-0 pr-2 z-[1000] section-title !lowercase !text-[#005F6A]/30 text-right -translate-y-1/2">
                {formatHour(hour, use24HourClock)}
              </span>
            </div>
          ))}
        </div>

        {/* Room Columns Container */}
        <div className="flex-1 relative" ref={dayGridRef}>
          <div className="flex relative" data-day-grid="true">
            {/* Horizontal Grid Lines */}
            <div className="absolute inset-0 pointer-events-none">
              {visibleHours.map((hour) => (
                <React.Fragment key={hour}>
                  {/* Hour line */}
                  <div
                    className="absolute left-0 right-0 border-t-1 border-[#005F6A]/5"
                    style={{
                      top: `${
                        (hour - (officeHours?.start || 0)) * zoomLevel
                      }px`,
                    }}
                  />
                  {/* 15-minute interval lines */}
                  {[15, 30, 45].map((minutes) => (
                    <div
                      key={`${hour}-${minutes}`}
                      className="absolute left-0 right-0 border-t-1 border-[#005F6A]/[0.025]"
                      style={{
                        top: `${
                          (hour - (officeHours?.start || 0)) * zoomLevel +
                          (minutes * zoomLevel) / 60
                        }px`,
                      }}
                    />
                  ))}
                </React.Fragment>
              ))}

              {/* Current Time Indicator */}
              {showCurrentTimeIndicator && (
                <CurrentTimeIndicator top={currentTimeTop} />
              )}

              {/* Drag Selection Preview */}
              {isDraggingSelection &&
                dragSelectionStart &&
                dragSelectionEnd && (
                  <SelectionPreview
                    start={dragSelectionStart}
                    end={dragSelectionEnd}
                    roomColumns={roomNames}
                    zoomLevel={zoomLevel}
                    officeHours={officeHours}
                    currentRoomIndex={currentDragRoomIndex}
                  />
                )}
            </div>

            {/* Room Columns */}
            {roomNames.map((roomName, roomIndex) => {
              // Collect events for this room
              const columnEvents =
                roomName === "Unassigned Events" || roomName === "All Events"
                  ? dayEvents.filter((ev) =>
                      isEventUnassigned(ev, existingRoomNames)
                    )
                  : dayEvents.filter((ev) => ev.label === roomName);

              const layoutMap = computeEventLayout(columnEvents, null);

              return (
                <div
                  key={roomName}
                  ref={(el) => {
                    roomColumnRefs.current[roomIndex] = el;
                  }}
                  data-room-column={roomIndex}
                  data-room-name={roomName}
                  className={`relative min-w-[200px] flex-1 ${
                    roomIndex > 0 ? "border-l border-[#005F6A]/10" : ""
                  } ${
                    roomName === "Unassigned Events"
                      ? "bg-[#005F6A]/[0.02]"
                      : ""
                  }`}
                  style={{ minHeight: `${gridHeight}px` }}
                  onDrop={(e) => handlePresetDrop(e, roomName)}
                  onDragOver={(e) => e.preventDefault()}>
                  {/* Schedule Blocks */}
                  <ScheduleBlocks
                    day={currentDate}
                    scheduleBlocks={scheduleBlocks}
                    officeHours={officeHours}
                    zoomLevel={zoomLevel}
                    roomName={roomName}
                  />

                  {/* Events */}
                  {columnEvents.map((event) => {
                    const layout = layoutMap[event.id];
                    if (!layout) return null;
                    return renderEventCard(event, currentDate, layout);
                  })}

                  {/* 15-Minute Tile Drag Handlers with Hover Effect */}
                  {visibleHours.flatMap((hour, hourIndex) =>
                    [0, 15, 30, 45].map((minutes) => (
                      <div
                        key={`${hour}-${minutes}`}
                        className={`absolute left-0 right-0 z-20 transition-colors duration-200 ${
                          isDraggingSelection
                            ? "cursor-crosshair"
                            : "cursor-pointer hover:bg-[#005F6A]/[0.06]"
                        }`}
                        style={{
                          top: `${
                            hourIndex * zoomLevel + (minutes * zoomLevel) / 60
                          }px`,
                          height: `${zoomLevel / 4}px`,
                        }}
                        onMouseDown={(e) =>
                          handleDragSelectionStart(
                            e,
                            roomIndex,
                            hourIndex,
                            minutes
                          )
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
