"use client";

import useSWR, { mutate as globalMutate } from "swr";
import { useEffect, useRef, useState } from "react";

type CalendarEventDTO = {
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

const fetcher = async (_key: string, dates: string[]): Promise<CalendarEventDTO[]> => {
  const results = await Promise.all(
    dates.map(async (date) => {
      const res = await fetch(`/api/calendar/${date}`);
      if (!res.ok) {
        throw new Error(`Failed to load calendar for ${date}`);
      }
      const json = await res.json();
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
  const dates = enumerateDates(start, end);
  const key = dates.length ? `calendar-range:${dates[0]}:${dates[dates.length - 1]}` : null;

  const { data, isLoading, error, mutate } = useSWR(
    key ? [key, dates] : null,
    ([, datesArr]) => fetcher(key!, datesArr as string[]),
    {
      revalidateOnFocus: false,
      dedupingInterval: 60_000,
    }
  );

  // Preserve last successful data to avoid flicker/clearing on revalidate/error
  const lastDataRef = useRef<CalendarEventDTO[]>([]);
  const [stableData, setStableData] = useState<CalendarEventDTO[]>([]);

  useEffect(() => {
    if (data) {
      lastDataRef.current = data;
      setStableData(data);
    }
  }, [data]);

  // On first render with no data yet, keep empty; on errors, retain last data
  const events = data ?? lastDataRef.current ?? [];

  const mutateDay = (dateStr: string) => {
    const dayKey = `calendar-range:${dateStr}:${dateStr}`;
    globalMutate(dayKey);
  };

  return {
    events,
    isLoading,
    error,
    mutateRange: () => mutate(),
    mutateDay,
  };
}

