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
  EventLayout,
  getVisibleTimeBounds,
  calculateEventPosition,
  getBorderRadiusClasses,
  computeEventLayout,
  overflowGroups,
  resolveLaneCap,
  formatHour,
} from "./calendar-helpers";
import { CurrentTimeIndicator } from "./calendar-components";
import { ScheduleBlocksConfig } from "@/types/calendar";
import EventCard from "./EventCard";
import EventOverflowChip from "./EventOverflow";
import useColumnWidth from "./useColumnWidth";
import ScheduleBlocks from "./ScheduleBlocks";
import AvailabilityOverlay from "./AvailabilityOverlay";
import { getCurrentTimeMeta } from "./time-utils";
import useDragSelection from "./useDragSelection";
import { useCalendarOverlays } from "./CalendarOverlaysContext";

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
      className="absolute z-40 pointer-events-none bg-[#008C9C]/[0.08]"
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
  const dayGridRef = useRef<HTMLDivElement>(null);
  const roomColumnRefs = useRef<(HTMLDivElement | null)[]>([]);
  // Room lanes are equal-width, so the first column's width budgets them all
  // (item 8 · Q2 §7). A single-column day is the wide case — ten overlapping
  // jobs all fit here, which is where the week's "+N more" chip sends you.
  const [measureColumn, columnWidth] = useColumnWidth();
  const laneCap = resolveLaneCap(columnWidth);

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  // Client-only clock — see the note in WeekView. Seeding from `new Date()`
  // during SSR renders the now-line at the server's instant and mismatches on
  // hydration; null renders no line at all until the browser has read its own.
  const [currentTime, setCurrentTime] = useState<Date | null>(null);
  const [currentDragRoomIndex, setCurrentDragRoomIndex] = useState<number>(-1);

  // Take the first reading after mount, then update every second
  useEffect(() => {
    setCurrentTime(new Date());
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

  /** Current time indicator meta — nothing to place until the clock exists */
  const { show: showCurrentTimeIndicator, top: currentTimeTop } = currentTime
    ? getCurrentTimeMeta(currentTime, officeHours, zoomLevel, {
        day: currentDate,
      })
    : { show: false, top: 0 };

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
    onPreviewChange: (idx: number | null) => setCurrentDragRoomIndex(idx ?? -1),
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
    (event: CalendarEvent, day: Date, layout: EventLayout) => {
      // Budgeted out of a lane — the column's "+N more" chip stands in for it.
      if (layout.hidden) return null;
      const position = calculateEventPosition(
        event,
        day,
        officeHours,
        zoomLevel,
        { ...layout, columnWidth: columnWidth ?? undefined }
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
            zIndex: position.zIndex,
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
    [officeHours, zoomLevel, eventTypesConfig, handleEventClick, columnWidth]
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const baseHour = visibleHours[0] ?? 0;
  const officeTop = (8 - baseHour) * zoomLevel;
  const officeHeight = 10 * zoomLevel; // 8 → 18
  const isToday = currentTime ? isSameDay(currentDate, currentTime) : false;
  const singleLane = roomNames.length === 1 && roomNames[0] === "All Events";

  return (
    <div className="cal-grid admin-font">
      <div className="cal-grid-inner">
        {/* Sticky header row (room lanes) */}
        <div className="cal-grid-header">
          <div className="cal-gutter-head" />
          {roomNames.map((roomName) => {
            const columnEvents =
              roomName === "Unassigned Events" || roomName === "All Events"
                ? dayEvents.filter((ev) => isEventUnassigned(ev, existingRoomNames))
                : dayEvents.filter((ev) => ev.label === roomName);
            const dow = singleLane
              ? currentDate.toLocaleDateString("en-US", { weekday: "long" })
              : roomName;
            return (
              <div key={roomName} className={`cal-dayhead ${isToday ? "today" : ""}`}>
                <span className="cal-dayhead-dow">{dow}</span>
                <span className={`cal-dayhead-num ${isToday ? "today" : ""}`}>
                  {currentDate.getDate()}
                </span>
                {columnEvents.length ? (
                  <span className="cal-dayhead-count">{columnEvents.length}</span>
                ) : null}
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

          {/* Room columns */}
          <div
            className="cal-cols"
            data-day-grid="true"
            ref={dayGridRef}
            style={{ height: `${gridHeight}px` }}>
            <div className="cal-hourlines">
              {visibleHours.map((hour) => (
                <div key={hour} className="cal-hline" style={{ height: `${zoomLevel}px` }} />
              ))}
              {showCurrentTimeIndicator && <CurrentTimeIndicator top={currentTimeTop} />}
              {isDraggingSelection && dragSelectionStart && dragSelectionEnd && (
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

            {roomNames.map((roomName, roomIndex) => {
              const columnEvents =
                roomName === "Unassigned Events" || roomName === "All Events"
                  ? dayEvents.filter((ev) => isEventUnassigned(ev, existingRoomNames))
                  : dayEvents.filter((ev) => ev.label === roomName);

              const layoutMap = computeEventLayout(columnEvents, null, laneCap);
              const overflow = overflowGroups(
                columnEvents,
                layoutMap,
                currentDate,
                officeHours,
                zoomLevel
              );

              return (
                <div
                  key={roomName}
                  ref={(el) => {
                    roomColumnRefs.current[roomIndex] = el;
                    if (roomIndex === 0) measureColumn(el);
                  }}
                  data-room-column={roomIndex}
                  data-room-name={roomName}
                  className="cal-col"
                  style={{ minHeight: `${gridHeight}px` }}
                  onDrop={(e) => handlePresetDrop(e, roomName)}
                  onDragOver={(e) => e.preventDefault()}>
                  {/* Office-hours shading */}
                  {officeHeight > 0 && (
                    <div className="cal-office" style={{ top: `${officeTop}px`, height: `${officeHeight}px` }} />
                  )}

                  {/* Schedule Blocks */}
                  {showBlocks && (
                    <ScheduleBlocks
                      day={currentDate}
                      scheduleBlocks={scheduleBlocks}
                      officeHours={officeHours}
                      zoomLevel={zoomLevel}
                      roomName={roomName}
                    />
                  )}

                  {/* Availability Overlay */}
                  {showAvailability && (
                    <AvailabilityOverlay
                      day={currentDate}
                      officeHours={officeHours}
                      zoomLevel={zoomLevel}
                    />
                  )}

                  {/* Events */}
                  {columnEvents.map((event) => {
                    const layout = layoutMap[event.id];
                    if (!layout) return null;
                    return renderEventCard(event, currentDate, layout);
                  })}

                  {/* Jobs that ran out of lanes — one chip per stack (Q2 §7) */}
                  {overflow.map((group) => (
                    <EventOverflowChip
                      key={group.key}
                      events={group.events}
                      top={group.top}
                      onSelect={openEventDetailsModal}
                    />
                  ))}

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
                          handleDragSelectionStart(e, roomIndex, hourIndex, minutes)
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
