"use client";

import useSWR, { mutate as globalMutate } from "swr";
import { useCallback, useEffect, useMemo, useRef } from "react";

export type CalendarEventDTO = {
  id: string;
  title: string;
  description?: string;
  label?: string;
  start: string;
  end?: string;
  confirmed?: boolean;
  importance?: number | null;
  metadata?: Record<string, any>;
};

type RangeResult = {
  events: CalendarEventDTO[];
  isLoading: boolean;
  error?: any;
  mutateRange: () => void;
  mutateDay: (dateStr: string) => void;
};

/**
 * One shared empty array for the "nothing loaded yet" case.
 *
 * `events` is a dependency of effects in `CalendarContext`, so returning a
 * fresh `[]` literal here would hand those effects a new reference on every
 * render. Module scope makes the identity constant for the lifetime of the tab.
 */
const NO_EVENTS: CalendarEventDTO[] = [];

/**
 * Range fetch.
 *
 * Prefers the single `/api/calendar/range` call (one session check, one job
 * query, one badge pass for the whole span) and falls back to the historical
 * per-day fan-out only if that endpoint is unavailable — see
 * `src/app/api/calendar/range/route.ts`.
 */
const fetcher = async (dates: string[]): Promise<CalendarEventDTO[]> => {
  if (!dates.length) return [];

  const start = dates[0];
  const end = dates[dates.length - 1];

  const res = await fetch(
    `/api/calendar/range?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
  );

  if (res.ok) {
    const json = await res.json();
    if (json?.success) {
      // `days` is keyed by YYYY-MM-DD. Flatten in the caller's date order so the
      // array matches what the per-day fan-out used to produce.
      const days = (json.data ?? {}) as Record<string, CalendarEventDTO[]>;
      const out: CalendarEventDTO[] = [];
      for (const date of dates) {
        const dayEvents = days[date];
        if (dayEvents?.length) out.push(...dayEvents);
      }
      return out;
    }
    throw new Error(json?.error || "Failed to load calendar");
  }

  // 404 only: an older build without the range route. Any other status is a
  // real failure and must surface rather than trigger 31 more requests.
  if (res.status !== 404) {
    throw new Error(`Failed to load calendar (${res.status})`);
  }

  const results = await Promise.all(
    dates.map(async (date) => {
      const dayRes = await fetch(`/api/calendar/${date}`);
      if (!dayRes.ok) {
        throw new Error(`Failed to load calendar for ${date}`);
      }
      const json = await dayRes.json();
      if (!json.success) {
        throw new Error(json.error || `Failed to load calendar for ${date}`);
      }
      return json.data as CalendarEventDTO[];
    })
  );

  return results.flat();
};

function toDateString(date: Date) {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function enumerateDates(start: Date, end: Date) {
  const dates: string[] = [];
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const last = new Date(end);
  last.setHours(0, 0, 0, 0);

  while (cur <= last) {
    dates.push(toDateString(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

export function useCalendarData(start: Date, end: Date): RangeResult {
  // Callers rebuild these Dates on every render (`startOfMonth(currentDate)`
  // and friends), so memoise on the civil dates rather than on identity.
  const startStr = toDateString(start);
  const endStr = toDateString(end);

  const dates = useMemo(
    () => enumerateDates(new Date(`${startStr}T00:00:00`), new Date(`${endStr}T00:00:00`)),
    [startStr, endStr]
  );

  const key = dates.length
    ? `calendar-range:${dates[0]}:${dates[dates.length - 1]}`
    : null;

  const { data, isLoading, error, mutate } = useSWR(
    key ? [key, dates] : null,
    ([, datesArr]) => fetcher(datesArr as string[]),
    {
      revalidateOnFocus: false,
      dedupingInterval: 60_000,
    }
  );

  // Preserve last successful data to avoid flicker/clearing on revalidate/error.
  const lastDataRef = useRef<CalendarEventDTO[]>(NO_EVENTS);
  useEffect(() => {
    if (data) lastDataRef.current = data;
  }, [data]);

  // Stable identity in every branch: `data` is SWR's cached array, and both
  // fallbacks are refs/module constants rather than fresh literals.
  const events = data ?? lastDataRef.current;

  // `mutate` is stable per SWR key, so these stay stable too. That matters:
  // `CalendarPageClient` keys an effect on `mutateRange` to publish it on
  // `window`, and `CalendarContext` keys `invalidateDays` on it.
  const mutateRange = useCallback(() => {
    void mutate();
  }, [mutate]);

  const mutateDay = useCallback((dateStr: string) => {
    const dayKey = `calendar-range:${dateStr}:${dateStr}`;
    void globalMutate(dayKey);
  }, []);

  return {
    events,
    isLoading,
    error,
    mutateRange,
    mutateDay,
  };
}
