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
  /**
   * List is a rendering MODE laid over `view`, not a fourth granularity — the
   * toolbar's List segment keeps whatever month/week/day span was showing and
   * renders it as rows (`<ListView view={view} />`).
   *
   * It lived as `useState` inside `Calendar.tsx` until now, which made the
   * toolbar the only thing that knew List was on: the context — and therefore
   * `CalendarUrlSync`, which mirrors the context into the URL — could not see
   * it, so `?view=` said "month" while List was on screen and a reload always
   * came back on the grid. Hoisted here so there is one source of truth for
   * what the user is looking at.
   */
  listMode: boolean;
  setListMode: (on: boolean) => void;
  zoomLevel: number;
  setZoomLevel: (level: number) => void;
  events: CalendarEvent[];
  setEvents: (events: CalendarEvent[]) => void;
  eventsLoading: boolean;
  /** Calendar search (fix 3): filters visible events by client, address,
      cleaner, service type and notes. */
  searchQuery: string;
  setSearchQuery: (q: string) => void;

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
  initialListMode = false,
}: {
  children: ReactNode;
  initialDate?: Date;
  initialEvents?: CalendarEvent[];
  initialView?: CalendarView;
  initialListMode?: boolean;
}) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { config: calendarConfig } = useCalendarConfig();

  const [currentDate, setCurrentDate] = useState(initialDate);
  const [view, setView] = useState<CalendarView>(initialView);
  const [listMode, setListMode] = useState<boolean>(initialListMode);
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

  // Calendar search (fix 3). Filters the visible events by client name,
  // address, cleaner, service type and notes. Client-side over the already
  // loaded month, so typing is instant and never refetches.
  const [searchQuery, setSearchQuery] = useState("");
  const filteredEvents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return localEvents;
    return localEvents.filter((e) => {
      const m = (e.metadata ?? {}) as Record<string, unknown>;
      const cleaners = Array.isArray(m.cleaners)
        ? (m.cleaners as { name?: string }[]).map((c) => c.name ?? "").join(" ")
        : "";
      const hay = [
        e.title,
        e.label ?? "",
        m.location as string,
        m.jobType as string,
        m.notes as string,
        m.employeeName as string,
        cleaners,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [localEvents, searchQuery]);

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
  //
  // `lastAppliedSignatureRef` records the signature of the payload this effect
  // last WROTE into `localEvents`. The previous version stored two different
  // things in it — the SWR signature on one branch and the *seed* signature on
  // the other — while always comparing the SWR signature against it. Once the
  // seed was non-empty and SWR was not (any range that legitimately has no
  // jobs, and every range still in flight after one had already loaded) the
  // guard could never match again, so the effect fell through, called
  // `setLocalEvents` with a freshly built array, and — because `localEvents`
  // was one of its own dependencies — immediately re-ran. That is the
  // "Maximum update depth exceeded" loop: it never terminates on its own, and
  // it starves `CalendarUrlSync` and `CalendarPageClient`'s
  // `window.__calendarMutateRange` effect, which is why neither of those ever
  // committed.
  //
  // Two changes make it convergent: the ref now always records what was
  // actually applied, and `localEvents` is read through a ref instead of being
  // a dependency, so writing state can no longer re-trigger the effect that
  // wrote it.
  const lastAppliedSignatureRef = useRef<string>("");
  const localDirtyRef = useRef<boolean>(false);
  const localEventsRef = useRef<CalendarEvent[]>(localEvents);

  // Declared BEFORE the sync effect on purpose: React runs a fiber's effects in
  // declaration order, so by the time the sync effect below reads the ref in
  // any given commit it already holds that commit's `localEvents`.
  useEffect(() => {
    localEventsRef.current = localEvents;
  }, [localEvents]);

  // Mark local state as "dirty" during drag/resize so SWR won't clobber it until it matches.
  useEffect(() => {
    if (movingEvent || resizingEvent) {
      localDirtyRef.current = true;
    }
  }, [movingEvent, resizingEvent]);

  useEffect(() => {
    // Keep SWR sync from overriding in-flight drag/resize state; only sync on data changes.
    if (movingEvent || resizingEvent) return;

    type NormalizableEvent = Omit<CalendarEvent, "start" | "end"> & {
      start: string | Date;
      end?: string | Date | null;
    };
    const normalize = (list: NormalizableEvent[]): CalendarEvent[] =>
      list.map((e) => ({
        ...e,
        // Parse ISO strings as local times (no 'Z' suffix means local time)
        start: typeof e.start === "string" ? new Date(e.start) : e.start,
        end:
          e.end == null
            ? undefined
            : typeof e.end === "string"
            ? new Date(e.end)
            : e.end,
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

    // What we would apply: the SWR payload when it has anything, otherwise the
    // seed the page handed down.
    const next = swrEvents.length
      ? normalize(swrEvents)
      : normalize(initialEvents);
    const nextSignature = signatureFor(next);

    // Already applied — nothing to do. This is now a like-for-like comparison,
    // so it always matches on the run immediately after an apply.
    if (nextSignature === lastAppliedSignatureRef.current) return;

    const localSignature = signatureFor(localEventsRef.current);

    // The server has caught up with the optimistic local state: record it and
    // release the dirty hold without touching state (no re-render).
    if (localSignature === nextSignature) {
      lastAppliedSignatureRef.current = nextSignature;
      localDirtyRef.current = false;
      return;
    }

    // Local drag/resize result not yet reflected by the server — hold it, and
    // deliberately do NOT record the signature so the next payload is retried.
    if (localDirtyRef.current) return;

    setLocalEvents(next);
    lastAppliedSignatureRef.current = nextSignature;
  }, [initialEvents, swrEvents, movingEvent, resizingEvent]);

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
      // Show the event details modal for all events (including jobs)
      // CalendarJobActions will handle job-specific UI when rendered
      setSelectedEvent(event);
      setShowEventModal(true);
    },
    []
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
          "@/app/admin/actions/updateJobDates"
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
            "@/app/admin/actions/updateJobDates"
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

  /**
   * Re-read the visible range from the server.
   *
   * Was a no-op, which was survivable while nothing on the calendar mutated a
   * job — drag/resize call `invalidateDays` directly. The booking drawer (item
   * 8) cancels, charges and edits from inside the grid, so a stale chip would
   * keep showing "Unpaid" on a job the admin had just marked paid.
   *
   * Both caches are poked: this provider's own range subscription, and the
   * month-range one `CalendarPageClient` holds (it publishes its mutator on
   * `window` for exactly this reason). Different SWR keys, so refreshing one
   * leaves the other stale.
   */
  const refreshEvents = useCallback(async () => {
    mutateRangeCache?.();
    const external = (window as unknown as {
      __calendarMutateRange?: () => void;
    }).__calendarMutateRange;
    if (typeof external === "function") external();
  }, [mutateRangeCache]);

  const value: CalendarState = {
    currentDate,
    setCurrentDate,
    view,
    setView,
    listMode,
    setListMode,
    zoomLevel,
    setZoomLevel,
    events: filteredEvents,
    setEvents: setLocalEvents,
    eventsLoading: swrLoading,
    searchQuery,
    setSearchQuery,
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
