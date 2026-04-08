"use client";

import React, {
  createContext,
  useState,
  useContext,
  ReactNode,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { CalendarEvent } from "@/components/calendar/types";
import {
  startOfMonth,
  endOfMonth,
  addDays,
  startOfWeek,
  subMonths,
  addMonths,
  format,
} from "@/components/calendar/utils";
import { useCalendarConfig } from "@/contexts/CalendarConfigContext";
import { Toast } from "@/components/ui/Toast";
import { mutate as swrMutate } from "swr";
import { useCalendarData } from "@/hooks/useCalendarData";

type CalendarView = "month" | "week" | "day" | "list";

interface CalendarState {
  currentDate: Date;
  setCurrentDate: (date: Date) => void;
  view: CalendarView;
  setView: (view: CalendarView) => void;
  zoomLevel: number;
  setZoomLevel: (level: number) => void;
  events: CalendarEvent[];
  setEvents: (events: CalendarEvent[]) => void;
  eventsLoading: boolean;

  showModal: boolean;
  setShowModal: (show: boolean) => void;
  modalDate: Date | null;
  setModalDate: (date: Date | null) => void;
  showEventModal: boolean;
  setShowEventModal: (show: boolean) => void;
  selectedEvent: CalendarEvent | null;
  setSelectedEvent: (event: CalendarEvent | null) => void;
  editingEvent: CalendarEvent | null;
  setEditingEvent: (event: CalendarEvent | null) => void;
  handlePrev: () => void;
  handleNext: () => void;
  handleToday: () => void;
  handleAddEvent: (e: FormEvent) => Promise<void>;
  openEditModal: (event: CalendarEvent) => void;
  modalTitle: string;
  setModalTitle: (title: string) => void;
  modalDescription: string;
  setModalDescription: (description: string) => void;
  modalLabel: string;
  setModalLabel: (label: string) => void;
  modalPatientId: string;
  setModalPatientId: (id: string) => void;
  modalPatientFirstName: string;
  setModalPatientFirstName: (name: string) => void;
  modalPatientLastName: string;
  setModalPatientLastName: (name: string) => void;
  modalPatientDOB: string;
  setModalPatientDOB: (dob: string) => void;
  modalPatientPhone: string;
  setModalPatientPhone: (phone: string) => void;
  modalEventType: string;
  setModalEventType: (type: string) => void;
  modalSelectedEventType: string;
  setModalSelectedEventType: (type: string) => void;
  modalConfirmed: boolean;
  setModalConfirmed: (confirmed: boolean) => void;
  modalLocation: string;
  setModalLocation: (location: string) => void;
  startTime: string;
  setStartTime: (time: string) => void;
  endTime: string;
  setEndTime: (time: string) => void;
  movingEvent: CalendarEvent | null;
  setMovingEvent: (event: CalendarEvent | null) => void;
  hasMoved: boolean;
  setHasMoved: (moved: boolean) => void;
  clickedEvent: CalendarEvent | null;
  setClickedEvent: (event: CalendarEvent | null) => void;
  mouseDownTime: number | null;
  setMouseDownTime: (time: number | null) => void;
  moveOriginalDate: Date | null;
  setMoveOriginalDate: (date: Date | null) => void;
  moveStartX: number | null;
  setMoveStartX: (x: number | null) => void;
  moveStartY: number | null;
  setMoveStartY: (y: number | null) => void;
  finalizeEventMove: () => Promise<void>;
  resetEventMove: () => void;
  openEventDetailsModal: (event: CalendarEvent) => void;

  previewEvent: CalendarEvent | null;
  setPreviewEvent: (event: CalendarEvent | null) => void;
  openModalWithPreset: (preset: any, startTime: Date) => void;
  handleDeleteEvent: (id: string) => Promise<void>;
  resizingEvent: CalendarEvent | null;
  setResizingEvent: (event: CalendarEvent | null) => void;
  resizeEdge: "start" | "end" | null;
  setResizeEdge: (edge: "start" | "end" | null) => void;
  resizeStartY: number | null;
  setResizeStartY: (y: number | null) => void;
  resizeOriginalStart: Date | null;
  setResizeOriginalStart: (date: Date | null) => void;
  resizeOriginalEnd: Date | null;
  setResizeOriginalEnd: (date: Date | null) => void;
  finalizeEventResize: () => Promise<void>;
  openEventModal: (
    date: Date,
    startTimeStr?: string,
    endTimeStr?: string
  ) => void;
  openEventModalAtTime: (
    date: Date,
    yPosition: number,
    containerHeight: number,
    officeHours?: { start: number; end: number },
    zoomLevel?: number
  ) => void;
  recommendations: any[];
  setRecommendations: (recommendations: any[]) => void;
  recommendationsLoading: boolean;
  setRecommendationsLoading: (loading: boolean) => void;
  generateRecommendations: () => void;
  selectRecommendation: (recommendation: any) => void;
  refreshEvents: () => Promise<void>;
  showNotification: (
    type: "success" | "error" | "loading",
    title: string,
    message: string
  ) => void;

  // Prefetching control
  prefetchEnabled: boolean;
  setPrefetchEnabled: (enabled: boolean) => void;

  // Drag selection state for creating events
  isDraggingSelection: boolean;
  setIsDraggingSelection: (dragging: boolean) => void;
  dragSelectionStart: { day: Date; minutes: number } | null;
  setDragSelectionStart: (start: { day: Date; minutes: number } | null) => void;
  dragSelectionEnd: { day: Date; minutes: number } | null;
  setDragSelectionEnd: (end: { day: Date; minutes: number } | null) => void;
  dragStartPosition: { x: number; y: number } | null;
  setDragStartPosition: (pos: { x: number; y: number } | null) => void;

  // Job modal trigger (replaces legacy EventModals)
  showJobModal: boolean;
  setShowJobModal: (open: boolean) => void;
  jobModalData: { date: Date; startTime?: string; endTime?: string } | null;
  setJobModalData: (
    data: { date: Date; startTime?: string; endTime?: string } | null
  ) => void;
}

const CalendarContext = createContext<CalendarState | undefined>(undefined);

export const CalendarProvider = ({
  children,
  initialDate = new Date(),
  initialEvents = [],
  initialView = "month",
}: {
  children: ReactNode;
  initialDate?: Date;
  initialEvents?: CalendarEvent[];
  initialView?: CalendarView;
}) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { config: calendarConfig } = useCalendarConfig();

  const [currentDate, setCurrentDate] = useState(initialDate);
  const [view, setView] = useState<CalendarView>(initialView);
  const [localEvents, setLocalEvents] =
    useState<CalendarEvent[]>(initialEvents);
  const [zoomLevel, setZoomLevel] = useState<number>(100);

  const [showModal, setShowModal] = useState(false);
  const [modalDate, setModalDate] = useState<Date | null>(null);
  const [showEventModal, setShowEventModal] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(
    null
  );
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);

  const [modalTitle, setModalTitle] = useState("");
  const [modalDescription, setModalDescription] = useState("");
  const [modalLabel, setModalLabel] = useState("");
  const [modalPatientId, setModalPatientId] = useState("");
  const [modalPatientFirstName, setModalPatientFirstName] = useState("");
  const [modalPatientLastName, setModalPatientLastName] = useState("");
  const [modalPatientDOB, setModalPatientDOB] = useState("");
  const [modalPatientPhone, setModalPatientPhone] = useState("");
  const [modalEventType, setModalEventType] = useState("");
  const [modalSelectedEventType, setModalSelectedEventType] = useState("");
  const [modalConfirmed, setModalConfirmed] = useState(false);
  const [modalLocation, setModalLocation] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  const [movingEvent, setMovingEvent] = useState<CalendarEvent | null>(null);
  const [hasMoved, setHasMoved] = useState(false);
  const [clickedEvent, setClickedEvent] = useState<CalendarEvent | null>(null);
  const [mouseDownTime, setMouseDownTime] = useState<number | null>(null);
  const [moveOriginalDate, setMoveOriginalDate] = useState<Date | null>(null);
  const [moveOriginalEvent, setMoveOriginalEvent] =
    useState<CalendarEvent | null>(null);
  const [moveStartX, setMoveStartX] = useState<number | null>(null);
  const [moveStartY, setMoveStartY] = useState<number | null>(null);

  const [previewEvent, setPreviewEvent] = useState<CalendarEvent | null>(null);
  const [resizingEvent, setResizingEvent] = useState<CalendarEvent | null>(
    null
  );
  const [resizeEdge, setResizeEdge] = useState<"start" | "end" | null>(null);
  const [resizeStartY, setResizeStartY] = useState<number | null>(null);
  const [resizeOriginalStart, setResizeOriginalStart] = useState<Date | null>(
    null
  );
  const [resizeOriginalEnd, setResizeOriginalEnd] = useState<Date | null>(null);

  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);

  const [prefetchEnabled, setPrefetchEnabled] = useState<boolean>(true);

  const [isDraggingSelection, setIsDraggingSelection] = useState(false);
  const [dragSelectionStart, setDragSelectionStart] = useState<{
    day: Date;
    minutes: number;
  } | null>(null);
  const [dragSelectionEnd, setDragSelectionEnd] = useState<{
    day: Date;
    minutes: number;
  } | null>(null);
  const [dragStartPosition, setDragStartPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [showJobModal, setShowJobModal] = useState(false);
  const [jobModalData, setJobModalData] = useState<{
    date: Date;
    startTime?: string;
    endTime?: string;
  } | null>(null);

  const [toasts, setToasts] = useState<
    Array<{
      id: string;
      type: "success" | "error" | "loading";
      title: string;
      message: string;
    }>
  >([]);

  // Visible range based on view/currentDate
  const { visibleStart, visibleEnd } = useMemo(() => {
    if (view === "month") {
      return {
        visibleStart: startOfMonth(currentDate),
        visibleEnd: endOfMonth(currentDate),
      };
    }
    if (view === "week") {
      const start = startOfWeek(currentDate);
      return { visibleStart: start, visibleEnd: addDays(start, 6) };
    }
    return { visibleStart: currentDate, visibleEnd: currentDate };
  }, [view, currentDate]);

  // Fetch calendar data for visible range via SWR
  const {
    events: swrEvents,
    mutateRange: mutateRangeCache,
    isLoading: swrLoading,
  } = useCalendarData(visibleStart, visibleEnd);

  // Sync local events when server data changes (from SWR)
  const lastSwrSignatureRef = useRef<string>("");
  const localDirtyRef = useRef<boolean>(false);

  // Mark local state as "dirty" during drag/resize so SWR won't clobber it until it matches.
  useEffect(() => {
    if (movingEvent || resizingEvent) {
      localDirtyRef.current = true;
    }
  }, [movingEvent, resizingEvent]);

  useEffect(() => {
    // Keep SWR sync from overriding in-flight drag/resize state; only sync on data changes.
    if (movingEvent || resizingEvent) return;

    const normalize = (list: CalendarEvent[]) =>
      list.map((e) => ({
        ...e,
        // Parse ISO strings as local times (no 'Z' suffix means local time)
        start: e.start instanceof Date ? e.start : new Date(e.start),
        end:
          e.end instanceof Date ? e.end : e.end ? new Date(e.end) : undefined,
      }));

    const signatureFor = (list: CalendarEvent[]) =>
      JSON.stringify(
        list.map((e) => ({
          id: e.id,
          start: e.start instanceof Date ? e.start.toISOString() : e.start,
          end:
            e.end instanceof Date ? e.end.toISOString() : e.end ? e.end : null,
        }))
      );

    const normalizedSwr = swrEvents.length ? normalize(swrEvents) : [];
    const swrSignature = signatureFor(normalizedSwr);

    // If SWR data hasn't changed since last apply, skip.
    if (swrSignature === lastSwrSignatureRef.current) return;

    // If we have local dirty state and SWR does not match local yet, do not override.
    const localSignature = signatureFor(localEvents);
    if (localDirtyRef.current && swrSignature !== localSignature) {
      return;
    }

    // Apply SWR payload.
    if (normalizedSwr.length) {
      setLocalEvents(normalizedSwr);
      lastSwrSignatureRef.current = swrSignature;
      // If SWR now matches local, clear dirty flag.
      if (swrSignature === localSignature) {
        localDirtyRef.current = false;
      }
    } else {
      const normalizedInitial = normalize(initialEvents);
      setLocalEvents(normalizedInitial);
      lastSwrSignatureRef.current = signatureFor(normalizedInitial);
      localDirtyRef.current = false;
    }
  }, [initialEvents, swrEvents, localEvents, movingEvent, resizingEvent]);

  // Helper to format YYYY-MM-DD
  const toDateStr = useCallback((date: Date) => {
    const y = date.getFullYear();
    const m = `${date.getMonth() + 1}`.padStart(2, "0");
    const d = `${date.getDate()}`.padStart(2, "0");
    return `${y}-${m}-${d}`;
  }, []);

  const invalidateDays = useCallback(
    (dates: string[]) => {
      console.log("[CalendarContext] invalidateDays", dates);
      dates.forEach((d) => {
        const key = `calendar-range:${d}:${d}`;
        swrMutate(key);
      });
      if (mutateRangeCache) {
        mutateRangeCache();
      }
    },
    [mutateRangeCache]
  );

  const handlePrev = useCallback(() => {
    if (view === "month") {
      setCurrentDate((prev) => subMonths(prev, 1));
    } else if (view === "week") {
      setCurrentDate((prev) => addDays(prev, -7));
    } else if (view === "day") {
      setCurrentDate((prev) => addDays(prev, -1));
    } else {
      // list view follows week-sized jumps
      setCurrentDate((prev) => addDays(prev, -7));
    }
  }, [view]);

  // Capture original event snapshot when a move starts
  useEffect(() => {
    if (movingEvent && !moveOriginalEvent) {
      setMoveOriginalEvent({ ...movingEvent });
    }
  }, [movingEvent, moveOriginalEvent]);

  const handleNext = useCallback(() => {
    if (view === "month") {
      setCurrentDate((prev) => addMonths(prev, 1));
    } else if (view === "week") {
      setCurrentDate((prev) => addDays(prev, 7));
    } else if (view === "day") {
      setCurrentDate((prev) => addDays(prev, 1));
    } else {
      // list view follows week-sized jumps
      setCurrentDate((prev) => addDays(prev, 7));
    }
  }, [view]);

  const handleToday = useCallback(() => {
    setCurrentDate(new Date());
  }, []);

  const handleAddEvent = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    // UI-only: just close modal
    setShowModal(false);
    // Reset form
    setModalTitle("");
    setModalDescription("");
    setModalLabel("");
    setStartTime("");
    setEndTime("");
  }, []);

  const openEditModal = useCallback((event: CalendarEvent) => {
    setEditingEvent(event);
    setModalDate(event.start);
    setModalTitle(event.title);
    setModalDescription(event.description || "");
    setModalLabel(event.label || "");
    setStartTime(
      `${event.start.getHours().toString().padStart(2, "0")}:${event.start
        .getMinutes()
        .toString()
        .padStart(2, "0")}`
    );
    if (event.end) {
      setEndTime(
        `${event.end.getHours().toString().padStart(2, "0")}:${event.end
          .getMinutes()
          .toString()
          .padStart(2, "0")}`
      );
    }
    setModalConfirmed(event.confirmed ?? false);
    setShowEventModal(false);
    setShowModal(true);
  }, []);

  const openEventDetailsModal = useCallback(
    (event: CalendarEvent) => {
      // If this is a job event, navigate to the job detail page
      if (event.metadata?.jobId) {
        // Capture the current calendar URL to return to exact same view
        const currentParams = new URLSearchParams(searchParams.toString());
        const calendarUrl = `${pathname}?${currentParams.toString()}`;
        const encodedCalendarUrl = encodeURIComponent(calendarUrl);

        // Add returnTo parameter with the full calendar URL
        router.push(
          `/jobs/${event.metadata.jobId}?returnTo=${encodedCalendarUrl}`
        );
        return;
      }

      // Otherwise, show the event modal (for non-job events)
      setSelectedEvent(event);
      setShowEventModal(true);
    },
    [router, pathname, searchParams]
  );

  const openEventModal = useCallback(
    (date: Date, startTimeStr?: string, endTimeStr?: string) => {
      setJobModalData({
        date,
        startTime: startTimeStr,
        endTime: endTimeStr,
      });
      setShowJobModal(true);
    },
    []
  );

  const openEventModalAtTime = useCallback(
    (
      date: Date,
      yPosition: number,
      containerHeight: number,
      officeHours?: { start: number; end: number },
      zoomLevel?: number
    ) => {
      // Calculate time from y position
      const officeStart = officeHours?.start || 0;
      const hoursFromTop = yPosition / (zoomLevel || 100);
      const totalMinutes = officeStart * 60 + hoursFromTop * 60;
      const hours = Math.floor(totalMinutes / 60);
      const minutes = Math.floor(totalMinutes % 60);
      const timeStr = `${hours.toString().padStart(2, "0")}:${minutes
        .toString()
        .padStart(2, "0")}`;
      openEventModal(date, timeStr);
    },
    [openEventModal]
  );

  const openModalWithPreset = useCallback((preset: any, startTime: Date) => {
    setModalDate(startTime);
    setModalTitle(preset.name || "");
    setShowModal(true);
  }, []);

  const handleDeleteEvent = useCallback(async (id: string) => {
    setLocalEvents((prev) => prev.filter((e) => e.id !== id));
    setShowEventModal(false);
    setSelectedEvent(null);
  }, []);

  const showNotification = useCallback(
    (type: "success" | "error" | "loading", title: string, message: string) => {
      const id = Math.random().toString(36);
      setToasts((prev) => {
        // If there's a loading toast, replace it
        const filtered = prev.filter((t) => t.type !== "loading");
        return [...filtered, { id, type, title, message }];
      });

      // Auto-remove non-loading toasts
      if (type !== "loading") {
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 3000);
      }
    },
    []
  );

  const finalizeEventMove = useCallback(async () => {
    console.log("[CalendarContext] finalizeEventMove enter", {
      movingEvent,
      hasMoved,
      moveOriginalEvent,
    });

    // Capture payload before we clear move state so UI stops dragging immediately
    const payload =
      movingEvent && hasMoved && moveOriginalEvent
        ? {
            moved: { ...movingEvent },
            original: { ...moveOriginalEvent },
          }
        : null;

    // Clear drag state right away to prevent further visual movement
    setMovingEvent(null);
    setMoveOriginalDate(null);
    setMoveOriginalEvent(null);
    setMoveStartX(null);
    setMoveStartY(null);
    setHasMoved(false);

    if (!payload) {
      return;
    }

    const { moved, original } = payload;

    // Check if this is a job event
    if (moved.metadata?.jobId) {
      try {
        showNotification(
          "loading",
          "Updating Job",
          "Saving new date and time..."
        );

        // Import the update action dynamically
        const { updateJobDates } = await import(
          "@/app/(app)/actions/updateJobDates"
        );

        console.log("[CalendarContext] updateJobDates payload", {
          jobId: moved.metadata.jobId,
          start: moved.start,
          end: moved.end,
        });

        const result = await updateJobDates(
          moved.metadata.jobId,
          moved.start,
          moved.end
        );

        console.log("[CalendarContext] updateJobDates result", result);

        if (result.success) {
          showNotification(
            "success",
            "Job Updated",
            "Job date and time updated successfully"
          );
          // Update local state to reflect the change - keep the new position
          setLocalEvents((prev) =>
            prev.map((e) =>
              e.id === moved.id
                ? { ...e, start: moved.start, end: moved.end }
                : e
            )
          );

          // Invalidate affected days
          const oldDay = toDateStr(original.start);
          const newDay = toDateStr(moved.start);
          invalidateDays(oldDay === newDay ? [oldDay] : [oldDay, newDay]);
        } else {
          showNotification(
            "error",
            "Update Failed",
            result.error || "Failed to update job"
          );
          // Revert to original event state on error
          setLocalEvents((prev) =>
            prev.map((e) =>
              e.id === moved.id
                ? {
                    ...e,
                    start: original.start,
                    end: original.end,
                  }
                : e
            )
          );
        }
      } catch (error) {
        showNotification(
          "error",
          "Update Failed",
          "An error occurred while updating the job"
        );
        // Revert to original event state on error
        setLocalEvents((prev) =>
          prev.map((e) =>
            e.id === moved.id
              ? {
                  ...e,
                  start: original.start,
                  end: original.end,
                }
              : e
          )
        );
        console.error("Error updating job:", error);
      }
    }
  }, [
    movingEvent,
    hasMoved,
    moveOriginalEvent,
    showNotification,
    toDateStr,
    invalidateDays,
  ]);

  const resetEventMove = useCallback(() => {
    setMovingEvent(null);
    setMoveOriginalDate(null);
    setMoveOriginalEvent(null);
    setMoveStartX(null);
    setMoveStartY(null);
    setHasMoved(false);
  }, []);

  const finalizeEventResize = useCallback(async () => {
    console.log("[CalendarContext] finalizeEventResize enter", {
      resizingEvent,
      resizeOriginalStart,
      resizeOriginalEnd,
    });
    if (resizingEvent) {
      console.log("[CalendarContext] finalizeEventResize using", {
        id: resizingEvent.id,
        start: resizingEvent.start?.toISOString(),
        end: resizingEvent.end?.toISOString(),
        originalStart: resizeOriginalStart?.toISOString(),
        originalEnd: resizeOriginalEnd?.toISOString(),
      });
      // Check if this is a job event
      if (resizingEvent.metadata?.jobId) {
        try {
          showNotification("loading", "Updating Job", "Saving new duration...");

          // Import the update action dynamically
          const { updateJobDates } = await import(
            "@/app/(app)/actions/updateJobDates"
          );

          console.log("[CalendarContext] updateJobDates payload (resize)", {
            jobId: resizingEvent.metadata.jobId,
            start: resizingEvent.start,
            end: resizingEvent.end,
          });

          const result = await updateJobDates(
            resizingEvent.metadata.jobId,
            resizingEvent.start,
            resizingEvent.end
          );

          console.log(
            "[CalendarContext] updateJobDates result (resize)",
            result
          );

          if (result.success) {
            showNotification(
              "success",
              "Job Updated",
              "Job duration updated successfully"
            );
            // Update local state to reflect the change
            setLocalEvents((prev) =>
              prev.map((e) =>
                e.id === resizingEvent.id
                  ? { ...e, start: resizingEvent.start, end: resizingEvent.end }
                  : e
              )
            );

            const day = toDateStr(resizeOriginalStart || resizingEvent.start);
            invalidateDays([day]);
          } else {
            showNotification(
              "error",
              "Update Failed",
              result.error || "Failed to update job"
            );
            // Revert the change on error
            setLocalEvents((prev) =>
              prev.map((e) =>
                e.id === resizingEvent.id
                  ? {
                      ...e,
                      start: resizeOriginalStart || e.start,
                      end: resizeOriginalEnd || e.end,
                    }
                  : e
              )
            );
          }
        } catch (error) {
          showNotification(
            "error",
            "Update Failed",
            "An error occurred while updating the job"
          );
          console.error("Error updating job:", error);
        }
      }
    }

    setResizingEvent(null);
    setResizeEdge(null);
    setResizeStartY(null);
    setResizeOriginalStart(null);
    setResizeOriginalEnd(null);
  }, [
    resizingEvent,
    resizeOriginalStart,
    resizeOriginalEnd,
    showNotification,
    toDateStr,
    invalidateDays,
  ]);

  const generateRecommendations = useCallback(() => {
    setRecommendationsLoading(true);
    setTimeout(() => {
      setRecommendations([]);
      setRecommendationsLoading(false);
    }, 100);
  }, []);

  const selectRecommendation = useCallback((recommendation: any) => {
    // UI-only: no-op
  }, []);

  const refreshEvents = useCallback(async () => {
    // UI-only: no-op
  }, []);

  const value: CalendarState = {
    currentDate,
    setCurrentDate,
    view,
    setView,
    zoomLevel,
    setZoomLevel,
    events: localEvents,
    setEvents: setLocalEvents,
    eventsLoading: swrLoading,
    showModal,
    setShowModal,
    modalDate,
    setModalDate,
    showEventModal,
    setShowEventModal,
    selectedEvent,
    setSelectedEvent,
    editingEvent,
    setEditingEvent,
    handlePrev,
    handleNext,
    handleToday,
    handleAddEvent,
    openEditModal,
    modalTitle,
    setModalTitle,
    modalDescription,
    setModalDescription,
    modalLabel,
    setModalLabel,
    modalPatientId,
    setModalPatientId,
    modalPatientFirstName,
    setModalPatientFirstName,
    modalPatientLastName,
    setModalPatientLastName,
    modalPatientDOB,
    setModalPatientDOB,
    modalPatientPhone,
    setModalPatientPhone,
    modalEventType,
    setModalEventType,
    modalSelectedEventType,
    setModalSelectedEventType,
    modalConfirmed,
    setModalConfirmed,
    modalLocation,
    setModalLocation,
    startTime,
    setStartTime,
    endTime,
    setEndTime,
    movingEvent,
    setMovingEvent,
    hasMoved,
    setHasMoved,
    clickedEvent,
    setClickedEvent,
    mouseDownTime,
    setMouseDownTime,
    moveOriginalDate,
    setMoveOriginalDate,
    moveStartX,
    setMoveStartX,
    moveStartY,
    setMoveStartY,
    finalizeEventMove,
    resetEventMove,
    openEventDetailsModal,
    previewEvent,
    setPreviewEvent,
    openModalWithPreset,
    handleDeleteEvent,
    resizingEvent,
    setResizingEvent,
    resizeEdge,
    setResizeEdge,
    resizeStartY,
    setResizeStartY,
    resizeOriginalStart,
    setResizeOriginalStart,
    resizeOriginalEnd,
    setResizeOriginalEnd,
    finalizeEventResize,
    openEventModal,
    openEventModalAtTime,
    recommendations,
    setRecommendations,
    recommendationsLoading,
    setRecommendationsLoading,
    generateRecommendations,
    selectRecommendation,
    refreshEvents,
    showNotification,
    prefetchEnabled,
    setPrefetchEnabled,
    isDraggingSelection,
    setIsDraggingSelection,
    dragSelectionStart,
    setDragSelectionStart,
    dragSelectionEnd,
    setDragSelectionEnd,
    dragStartPosition,
    setDragStartPosition,
    showJobModal,
    setShowJobModal,
    jobModalData,
    setJobModalData,
  };

  return (
    <CalendarContext.Provider value={value}>
      {children}
      {/* Toast Notifications */}
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          type={toast.type}
          title={toast.title}
          message={toast.message}
          onClose={() =>
            setToasts((prev) => prev.filter((t) => t.id !== toast.id))
          }
        />
      ))}
    </CalendarContext.Provider>
  );
};

export const useCalendar = () => {
  const context = useContext(CalendarContext);
  if (context === undefined) {
    throw new Error("useCalendar must be used within a CalendarProvider");
  }
  return context;
};
