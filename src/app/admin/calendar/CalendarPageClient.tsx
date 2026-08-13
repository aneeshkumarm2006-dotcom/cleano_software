"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Calendar from "@/components/calendar/Calendar";
import type {
  ClientLite,
  User as JobModalUser,
  AddOnCatalogItem,
} from "@/app/admin/jobs/JobModal";
import { CalendarRef, CalendarEvent } from "@/components/calendar/types";
import type { TaxRates } from "@/lib/tax";
import { CalendarProvider } from "@/components/calendar/CalendarContext";
import { useCalendarData } from "@/hooks/useCalendarData";
import { useCalendar } from "@/components/calendar/CalendarContext";
import CalendarJobActions from "@/components/calendar/CalendarJobActions";

const validViews = new Set(["month", "week", "day"]);

type GridView = "month" | "week" | "day";

/** What `?view=`, `?date=` and `?list=` mean, in one place. */
function readCalendarUrlState(params: URLSearchParams): {
  view: GridView;
  date: Date;
  listMode: boolean;
} {
  const viewParam = params.get("view");
  const dateParam = params.get("date");
  const parsed = dateParam ? new Date(dateParam) : null;
  return {
    view:
      viewParam && validViews.has(viewParam) ? (viewParam as GridView) : "month",
    date: parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date(),
    listMode: params.get("list") === "1",
  };
}

/**
 * Mirror the calendar's visible state into the URL.
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 * This used to be two effects pulling in opposite directions: one HYDRATED
 * `view`/`currentDate` out of `searchParams` and one PUSHED them back with
 * `router.replace`, with a single-slot `selfWrittenRef` supposed to stop the
 * second from feeding the first. Three things went wrong with that:
 *
 *  1. `router.replace` re-runs the whole `/admin/calendar` server component
 *     (users + clients + saved addresses + booking config + tax rates) for a
 *     change the server does not even read — `page.tsx` takes no searchParams
 *     at all. The URL therefore did not change until that round trip finished,
 *     which is why clicking Week left `location.search` empty for many seconds.
 *  2. While those slow replaces were in flight, `selfWrittenRef` only ever
 *     remembered the LATEST one. An earlier replace landing afterwards did not
 *     match it, so the hydrate effect treated the app's own stale write as an
 *     external URL change and pushed `view`/`currentDate` BACK to it —
 *     the mount-time `?view=month&date=<mount instant>` beating the user's
 *     later Week/Day choice, exactly the frozen query string that was reported.
 *  3. `listMode` was not in the context at all, so List could never reach the
 *     URL (it lives in CalendarContext now).
 *
 * ── What it does now ────────────────────────────────────────────────────────
 * One direction only. The URL is read ONCE, by `CalendarPageClient` below, to
 * seed the provider; after that the context is the single source of truth and
 * this component is a pure writer. Writes go through the History API rather
 * than the router — the App Router supports that and keeps `usePathname` /
 * `useSearchParams` in step, it is synchronous so the URL tracks the click
 * immediately, and it does not re-request a server payload that cannot differ.
 * (Same technique, same reason, as the `?tab=` sync in AnalyticsView.)
 */
function CalendarUrlSync() {
  const { view, setView, currentDate, listMode } = useCalendar();

  // Mobile default (no explicit ?view=): the 7-column month/week grids are
  // cramped on phones — land on the Day view instead. Mount-only; `matchMedia`
  // cannot run during render without a hydration mismatch.
  const mobileDefaultRef = useRef(false);
  useEffect(() => {
    if (mobileDefaultRef.current) return;
    mobileDefaultRef.current = true;
    const params = new URLSearchParams(window.location.search);
    if (params.get("view")) return;
    if (window.matchMedia("(max-width: 767px)").matches) setView("day");
  }, [setView]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("view", view);
    params.set("date", currentDate.toISOString());
    if (listMode) params.set("list", "1");
    else params.delete("list");
    const qs = params.toString();
    if (qs === window.location.search.replace(/^\?/, "")) return;
    window.history.replaceState(null, "", `${window.location.pathname}?${qs}`);
  }, [view, currentDate, listMode]);

  return null;
}

export default function CalendarPageClient({
  isEmployee = false,
  clients = [],
  users = [],
  addOnCatalog = [],
  taxRates,
}: {
  isEmployee?: boolean;
  clients?: ClientLite[];
  users?: JobModalUser[];
  addOnCatalog?: AddOnCatalogItem[];
  taxRates?: TaxRates;
}) {
  const calendarRef = useRef<CalendarRef>(null);
  const searchParams = useSearchParams();

  // Derive initial state from URL for a no-flicker first paint.
  //
  // This is the ONLY place the URL is read back into state. The provider takes
  // these as `useState` initializers, so a later URL change cannot reach into
  // the running calendar and reset it — which is what made the old two-effect
  // hydrate/push pair in `CalendarUrlSync` above fight itself. The memo still
  // tracks `searchParams` because `startDate`/`endDate` below use it to keep
  // the seed range on the month the calendar is showing.
  const {
    view: initialView,
    date: initialDate,
    listMode: initialListMode,
  } = useMemo(
    () => readCalendarUrlState(new URLSearchParams(searchParams.toString())),
    [searchParams]
  );

  // Seed range: the month the calendar is actually SHOWING, not whatever month
  // it happens to be today.
  //
  // This hook exists to publish `mutateRange` on `window` so CalendarContext can
  // refresh both SWR caches after a write (see `refreshEvents` there). It was
  // pinned to `new Date()` with an empty dep list, which meant that the moment
  // the URL pointed at any other month — and `CalendarUrlSync` writes `?date=`
  // on every navigation — this asked for a DIFFERENT key than the provider's
  // own subscription: 31 more day requests for a month nobody was looking at,
  // and an `initialEvents` fallback holding the wrong month's jobs. Keyed off
  // `initialDate` the two hooks land on the same SWR key and share one fetch.
  const { startDate, endDate } = useMemo(() => {
    const start = new Date(initialDate.getFullYear(), initialDate.getMonth(), 1);
    const end = new Date(initialDate.getFullYear(), initialDate.getMonth() + 1, 0);
    return { startDate: start, endDate: end };
  }, [initialDate]);

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
      initialView={initialView}
      initialListMode={initialListMode}>
      <CalendarUrlSync />
      <div className="h-full overflow-hidden">
        <Calendar
          ref={calendarRef}
          hideNewJobButton={isEmployee}
          clients={clients}
          users={users}
          addOnCatalog={addOnCatalog}
          taxRates={taxRates}
        />
      </div>
      {/* The booking drawer (item 8). Same lookups the New-job modal gets, so
          its Edit action can open the shared JobModal in edit mode rather than
          bouncing the admin to the job detail page. */}
      <CalendarJobActions
        isEmployee={isEmployee}
        clients={clients}
        users={users}
        addOnCatalog={addOnCatalog}
        taxRates={taxRates}
      />
    </CalendarProvider>
  );
}

