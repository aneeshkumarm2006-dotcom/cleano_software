"use client";

import React, { useEffect, useMemo, useState, useRef } from "react";
import Button from "@/components/ui/Button";
import { useCalendar } from "@/components/calendar/CalendarContext";
import { useCalendarConfig } from "@/contexts/CalendarConfigContext";
import { MonthView } from "@/components/calendar/MonthView";
import { WeekView } from "@/components/calendar/WeekView";
import { DayView } from "@/components/calendar/DayView";
import { ListView } from "@/components/calendar/ListView";
import ZoomControls from "@/components/calendar/ZoomControls";
import { format, addDays, startOfWeek } from "@/components/calendar/utils";
import { CalendarRef, CalendarEvent } from "@/components/calendar/types";
import Card from "@/components/ui/Card";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Plus,
} from "lucide-react";
import { OfficeHours } from "@/components/calendar/calendar-helpers";
import JobModal from "../../app/(app)/jobs/JobModal";
import { saveJob } from "../../app/(app)/actions/saveJob";

interface CalendarProps {
  initialDate?: Date;
  events?: CalendarEvent[];
  onDateSelect?: (date: Date) => void;
  onEventAdd?: (event: CalendarEvent) => void;
  persist?: boolean;
  onEventsChange?: (events: CalendarEvent[]) => void;
}

const Calendar = React.forwardRef<CalendarRef, CalendarProps>((props, ref) => {
  const {
    view,
    setView,
    handlePrev,
    handleNext,
    handleToday,
    currentDate,
    openEventDetailsModal,
    setModalDate,
    setShowModal,
    events,
    movingEvent,
    setMovingEvent,
    zoomLevel,
    finalizeEventMove,
    resizingEvent,
    setResizingEvent,
    resizeEdge,
    resizeStartY,
    resizeOriginalStart,
    resizeOriginalEnd,
    finalizeEventResize,
    setEvents,
    moveOriginalDate,
    moveStartX,
    moveStartY,
    setHasMoved,
    showJobModal,
    setShowJobModal,
    jobModalData,
    setJobModalData,
  } = useCalendar();

  const toLocalDateStr = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const buildUTCDateTime = (date: Date, time?: string) => {
    if (!time) return "";
    // Keep the intended local clock time by storing as UTC literal
    return `${toLocalDateStr(date)}T${time}:00Z`;
  };

  // Track latest move/resize targets for global pointer-up guard
  const movingEventRef = useRef<CalendarEvent | null>(null);
  const resizingEventRef = useRef<CalendarEvent | null>(null);

  useEffect(() => {
    movingEventRef.current = movingEvent ?? null;
  }, [movingEvent]);

  useEffect(() => {
    resizingEventRef.current = resizingEvent ?? null;
  }, [resizingEvent]);

  // Global pointer-up guard: finalize moves/resizes even if the transient
  // listeners haven't attached yet or mouseup happens outside the grid.
  useEffect(() => {
    const handlePointerUp = () => {
      if (movingEventRef.current) {
        finalizeEventMove();
      }
      if (resizingEventRef.current) {
        finalizeEventResize();
      }
    };

    window.addEventListener("mouseup", handlePointerUp, true);
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("blur", handlePointerUp, true);

    return () => {
      window.removeEventListener("mouseup", handlePointerUp, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("blur", handlePointerUp, true);
    };
  }, [finalizeEventMove, finalizeEventResize]);

  const [listMode, setListMode] = useState(false);
  const { config: calendarConfig } = useCalendarConfig();

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

  React.useImperativeHandle(ref, () => ({
    openEventModal: (date: Date) => {
      setModalDate(date);
      setShowModal(true);
      props.onDateSelect?.(date);
    },
    openEventDetailsModal: (event: CalendarEvent) => {
      openEventDetailsModal(event);
    },
  }));

  useEffect(() => {
    props.onEventsChange?.(events);
  }, [events, props.onEventsChange]);

  const renderCurrentView = () => {
    if (listMode) {
      return <ListView view={view as "month" | "week" | "day"} />;
    }
    if (view === "month") return <MonthView />;
    if (view === "week") return <WeekView />;
    return <DayView />;
  };

  const getHeaderTitle = () => {
    if (view === "month" || view === "week")
      return format(currentDate, "MMMM yyyy");
    if (view === "day") return format(currentDate, "EEEE, d MMMM yyyy");
    return format(currentDate, "EEEE, d MMMM yyyy");
  };

  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (movingEvent && moveOriginalDate && moveStartY && moveStartX) {
        const deltaX = Math.abs(e.clientX - moveStartX);
        const deltaY = Math.abs(e.clientY - moveStartY);
        if (deltaX > 3 || deltaY > 3) {
          setHasMoved(true);
        }
        console.log("[Calendar] mousemove drag", {
          id: movingEvent.id,
          deltaX,
          deltaY,
          start: movingEvent.start,
          end: movingEvent.end,
        });
        const calcNewTimes = () => {
          const snapTo15 = (mins: number) =>
            Math.max(0, Math.min(24 * 60 - 15, Math.round(mins / 15) * 15));

          const officeStartMinutes = (officeHours?.start || 0) * 60;
          const officeEndMinutes =
            officeHours && officeHours.end > (officeHours?.start || 0)
              ? officeHours.end * 60
              : 24 * 60;

          const computeMinutesFromPosition = (
            yOffset: number,
            rectHeight: number
          ) => {
            const clampedY = Math.max(0, Math.min(rectHeight, yOffset));
            const minutesFromTop = (clampedY / zoomLevel) * 60;
            const rawMinutes = minutesFromTop + officeStartMinutes;
            const snapped = snapTo15(rawMinutes);
            return Math.min(officeEndMinutes - 15, snapped);
          };

          let baseDate = new Date(moveOriginalDate);
          let newRoom = movingEvent.label;
          let minutesFromMidnight: number | null = null;

          if (view === "week") {
            // Query all day columns by their data attribute
            const dayColumns = document.querySelectorAll("[data-day-column]");
            if (dayColumns.length === 7) {
              // Find which day column the mouse is over
              for (let i = 0; i < dayColumns.length; i++) {
                const col = dayColumns[i] as HTMLElement;
                const rect = col.getBoundingClientRect();
                if (e.clientX >= rect.left && e.clientX <= rect.right) {
                  const dayIndex = parseInt(
                    col.getAttribute("data-day-column") || "0",
                    10
                  );
                  const weekStartConst = startOfWeek(currentDate);
                  baseDate = addDays(weekStartConst, dayIndex);
                  minutesFromMidnight = computeMinutesFromPosition(
                    e.clientY - rect.top,
                    rect.height
                  );
                  break;
                }
              }
            }
          } else if (view === "day") {
            const roomColumns = document.querySelectorAll("[data-room-name]");
            if (roomColumns.length > 0) {
              let targetRoomName = null;

              for (let i = 0; i < roomColumns.length; i++) {
                const roomColumn = roomColumns[i] as HTMLElement;
                const rect = roomColumn.getBoundingClientRect();

                if (e.clientX >= rect.left && e.clientX <= rect.right) {
                  targetRoomName = roomColumn.getAttribute("data-room-name");
                  minutesFromMidnight = computeMinutesFromPosition(
                    e.clientY - rect.top,
                    rect.height
                  );
                  break;
                }
              }

              if (targetRoomName) {
                if (
                  targetRoomName === "Unassigned Events" ||
                  targetRoomName === "All Events"
                ) {
                  newRoom = undefined;
                } else {
                  newRoom = targetRoomName;
                }
              }
            }
          }

          // Fallback to delta-based calc if no column detected
          if (minutesFromMidnight === null) {
            const deltaMinutes = ((e.clientY - moveStartY) / zoomLevel) * 60;
            const originalMinutes =
              movingEvent.start.getHours() * 60 +
              movingEvent.start.getMinutes();
            minutesFromMidnight = snapTo15(originalMinutes + deltaMinutes);
          }

          const boundedMinutes = Math.max(
            0,
            Math.min(24 * 60 - 15, minutesFromMidnight)
          );
          const newHour = Math.floor(boundedMinutes / 60);
          const newMin = boundedMinutes % 60;

          const newStart = new Date(baseDate);
          newStart.setHours(newHour, newMin, 0, 0);

          let newEnd: Date | undefined;
          if (movingEvent.end) {
            const dur = movingEvent.end.getTime() - movingEvent.start.getTime();
            newEnd = new Date(newStart.getTime() + dur);
          }

          return { newStart, newEnd, newRoom };
        };

        const { newStart, newEnd, newRoom } = calcNewTimes();

        // Build updated event object so downstream handlers use latest dates
        const updatedEvent: CalendarEvent = {
          ...movingEvent,
          start: newStart,
          end: newEnd,
          label: newRoom,
        };

        console.log("[Calendar] mousemove new times", {
          id: movingEvent.id,
          newStart,
          newEnd,
          newRoom,
        });

        // Update through setEvents
        const nextEvents = events.map((ev: CalendarEvent) =>
          ev.id === movingEvent.id ? updatedEvent : ev
        );
        setEvents(nextEvents);
        // Keep movingEvent in sync so finalizeEventMove sees the new times
        setMovingEvent(updatedEvent);
      }

      if (resizingEvent && resizeStartY !== null && resizeEdge) {
        const deltaY = e.clientY - resizeStartY;
        const rawMinutes = Math.round(deltaY);
        const snappedMinutes = Math.round(rawMinutes / 15) * 15;

        let updatedResizing: CalendarEvent | null = null;

        console.log("[Calendar] resize mousemove", {
          id: resizingEvent.id,
          deltaY,
          rawMinutes,
          snappedMinutes,
          edge: resizeEdge,
        });

        const newEvents = events.map((ev) => {
          if (ev.id !== resizingEvent.id) return ev;
          let newStart = new Date(ev.start);
          let newEnd = ev.end ? new Date(ev.end) : undefined;

          if (resizeEdge === "start") {
            const candidate = new Date(
              resizeOriginalStart!.getTime() + snappedMinutes * 60000
            );
            if (
              newEnd &&
              candidate.getTime() <= newEnd.getTime() - 15 * 60000
            ) {
              newStart = candidate;
            }
          } else if (resizeEdge === "end") {
            const origEnd =
              resizeOriginalEnd ??
              new Date(resizeOriginalStart!.getTime() + 60 * 60000);
            const candidate = new Date(
              origEnd.getTime() + snappedMinutes * 60000
            );
            if (candidate.getTime() >= newStart.getTime() + 15 * 60000) {
              newEnd = candidate;
            }
          }

          updatedResizing = { ...ev, start: newStart, end: newEnd };

          console.log("[Calendar] resize computed", {
            id: ev.id,
            edge: resizeEdge,
            newStart: newStart.toISOString(),
            newEnd: newEnd?.toISOString(),
            origStart: ev.start.toISOString(),
            origEnd: ev.end?.toString(),
          });

          return updatedResizing;
        });

        setEvents(newEvents);
        if (updatedResizing) {
          setResizingEvent(updatedResizing);
        }
      }
    };

    const handleGlobalMouseUp = () => {
      if (movingEvent) {
        finalizeEventMove();
      }
      if (resizingEvent) {
        finalizeEventResize();
      }
    };

    if (movingEvent || resizingEvent) {
      document.addEventListener("mousemove", handleGlobalMouseMove);
      document.addEventListener("mouseup", handleGlobalMouseUp);
    }

    return () => {
      document.removeEventListener("mousemove", handleGlobalMouseMove);
      document.removeEventListener("mouseup", handleGlobalMouseUp);
    };
  }, [
    movingEvent,
    resizingEvent,
    resizeStartY,
    resizeEdge,
    finalizeEventMove,
    finalizeEventResize,
    setEvents,
    moveOriginalDate,
    moveStartX,
    moveStartY,
    setHasMoved,
    events,
    view,
    currentDate,
    setMovingEvent,
    zoomLevel,
    officeHours,
    setResizingEvent,
  ]);

  return (
    <div className="flex flex-col h-full select-none gap-4">
      {/* Fixed Header */}
      <div className="flex-shrink-0 bg-white sticky top-0 z-10 p-4">
        <div className="w-full grid grid-cols-3 items-center">
          <div className="w-full flex items-center justify-start">
            <h2 className="h2-subtitle">{getHeaderTitle()}</h2>
          </div>

          <div className="w-full flex items-center justify-center">
            <div className="w-fit flex gap-1 rounded-2xl overflow-hidden bg-neutral-50">
              {(["month", "week", "day"] as const).map((v) => (
                <Button
                  key={v}
                  border={false}
                  variant={view === v ? "action" : "ghost"}
                  size="md"
                  className="text-[#005F6A] !px-6 !py-4"
                  onClick={() => setView(v)}>
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </Button>
              ))}
            </div>
          </div>

          <div className="w-full flex items-center justify-end gap-2">
            <div className="w-fit flex gap-1 rounded-2xl overflow-hidden bg-neutral-50">
              <Button
                variant={listMode ? "ghost" : "action"}
                size="md"
                className="text-[#005F6A] !px-6 py-3"
                onClick={() => setListMode(false)}
                aria-label="Calendar view">
                <CalendarDays className="w-4 h-4" />
              </Button>
              <Button
                variant={listMode ? "action" : "ghost"}
                size="md"
                className="text-[#005F6A] !px-6 py-3"
                onClick={() => setListMode(true)}
                aria-label="List view">
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  viewBox="0 0 24 24">
                  <rect x="4" y="5" width="16" height="2" rx="1" />
                  <rect x="4" y="11" width="16" height="2" rx="1" />
                  <rect x="4" y="17" width="16" height="2" rx="1" />
                </svg>
              </Button>
            </div>

            <Card className="!p-0 !w-fit flex items-center gap-1">
              <Button
                variant="ghost"
                size="md"
                className="px-3 py-3"
                onClick={handlePrev}>
                <ChevronLeft
                  className="w-4 h-4 text-[#005F6A]"
                  strokeWidth={1.5}
                />
              </Button>

              <Button
                variant="primary"
                size="md"
                border={false}
                onClick={handleToday}
                className="w-fit px-6 py-3">
                Today
              </Button>

              <Button
                variant="ghost"
                size="md"
                className="px-3 py-3"
                onClick={handleNext}>
                <ChevronRight
                  className="w-4 h-4 text-[#005F6A]"
                  strokeWidth={1.5}
                />
              </Button>
            </Card>
            <Button
              variant="primary"
              size="md"
              className="px-6 py-3"
              onClick={() => {
                setShowJobModal(true);
              }}>
              New Job
            </Button>
          </div>
        </div>
      </div>

      {/* Scrollable Calendar Body */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {renderCurrentView()}
      </div>

      <JobModal
        isOpen={showJobModal}
        onClose={() => setShowJobModal(false)}
        job={
          jobModalData
            ? {
                id: "",
                clientName: "",
                location: "",
                description: "",
                jobType: "",
                jobDate: null,
                startTime: buildUTCDateTime(
                  jobModalData.date,
                  jobModalData.startTime
                ),
                endTime: buildUTCDateTime(
                  jobModalData.date,
                  jobModalData.endTime
                ),
                price: null,
                employeePay: null,
                totalTip: null,
                parking: null,
                notes: null,
                cleaners: [],
              }
            : null
        }
        mode="create"
        users={[]}
        onSubmit={async (formData) => {
          // Prefill times if provided by drag selection
          if (jobModalData?.date) {
            const dateStr = jobModalData.date.toISOString().split("T")[0];
            if (jobModalData.startTime) {
              formData.set("startDate", dateStr);
              formData.set("startTime", jobModalData.startTime);
            }
            if (jobModalData.endTime) {
              formData.set("endDate", dateStr);
              formData.set("endTime", jobModalData.endTime);
            }
          }

          const result = await saveJob(formData);
          if (result.success) {
            setShowJobModal(false);
            setJobModalData(null);
          }
          return result;
        }}
      />
    </div>
  );
});

Calendar.displayName = "Calendar";

export default Calendar;
