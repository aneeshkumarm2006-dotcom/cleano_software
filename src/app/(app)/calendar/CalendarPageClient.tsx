"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Calendar from "@/components/calendar/Calendar";
import { CalendarRef, CalendarEvent } from "@/components/calendar/types";
import { CalendarProvider } from "@/components/calendar/CalendarContext";
import { useCalendarData } from "@/hooks/useCalendarData";
import { useCalendar } from "@/components/calendar/CalendarContext";

const validViews = new Set(["month", "week", "day"]);

/** Sync calendar view/date with URL search params */
function CalendarUrlSync() {
  const { view, setView, currentDate, setCurrentDate } = useCalendar();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hydratedRef = useRef(false);

  // On mount: hydrate state from URL (if present/valid)
  useEffect(() => {
    const viewParam = searchParams.get("view");
    if (viewParam && validViews.has(viewParam)) {
      setView(viewParam as typeof view);
    }

    const dateParam = searchParams.get("date");
    if (dateParam) {
      const parsed = new Date(dateParam);
      if (!Number.isNaN(parsed.getTime())) {
        setCurrentDate(parsed);
      }
    }

    hydratedRef.current = true;
  }, [searchParams, setView, setCurrentDate]);

  // Push current state back to URL (preserve other params)
  useEffect(() => {
    if (!hydratedRef.current) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set("view", view);
    next.set("date", currentDate.toISOString());
    const nextStr = next.toString();
    if (nextStr === searchParams.toString()) return;
    router.replace(`${pathname}?${nextStr}`);
  }, [view, currentDate, pathname, router, searchParams]);

  return null;
}

export default function CalendarPageClient() {
  const calendarRef = useRef<CalendarRef>(null);
  const searchParams = useSearchParams();

  // Derive initial state from URL for a no-flicker first paint
  const { initialView, initialDate } = useMemo(() => {
    const viewParam = searchParams.get("view");
    const dateParam = searchParams.get("date");

    const view =
      viewParam && validViews.has(viewParam) ? (viewParam as "month" | "week" | "day") : "month";

    let date = new Date();
    if (dateParam) {
      const parsed = new Date(dateParam);
      if (!Number.isNaN(parsed.getTime())) {
        date = parsed;
      }
    }

    return { initialView: view, initialDate: date };
  }, [searchParams]);

  // Default range: current month (unchanged – data fetch remains month-based)
  const { startDate, endDate } = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { startDate: start, endDate: end };
  }, []);

  const { events: rawEvents, mutateRange } = useCalendarData(
    startDate,
    endDate
  );

  const events: CalendarEvent[] = useMemo(
    () =>
      rawEvents.map((event) => ({
        id: event.id,
        title: event.title,
        description: event.description,
        label: event.label || null,
        start: new Date(event.start),
        end: event.end ? new Date(event.end) : undefined,
        confirmed: event.confirmed,
        importance: event.importance,
        metadata: event.metadata,
      })),
    [rawEvents]
  );

  // Expose mutateRange globally for CalendarContext to call when invalidating
  React.useEffect(() => {
    (window as any).__calendarMutateRange = mutateRange;
    return () => {
      delete (window as any).__calendarMutateRange;
    };
  }, [mutateRange]);

  return (
    <CalendarProvider
      initialEvents={events}
      initialDate={initialDate}
      initialView={initialView}>
      <CalendarUrlSync />
      <div className="h-full overflow-hidden">
        <Calendar ref={calendarRef} />
      </div>
    </CalendarProvider>
  );
}

