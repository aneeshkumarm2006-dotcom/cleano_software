import type { JobSummary } from "@bookmops/api/v1";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { useSource } from "../session";

export const calendarKeys = {
  // Under "jobs", so anything that refreshes the job lists (a clock-out, a
  // claim) refreshes the calendar too.
  range: (from: string, to: string) => ["jobs", "range", from, to] as const,
};

/** A month holds a few dozen jobs at most; this only guards a runaway cursor. */
const MAX_PAGES = 10;

/** The cleaner's jobs starting from `from` to `to` (company dates), every page. */
export function useJobsBetween(from: string, to: string, enabled = true) {
  const source = useSource();
  return useQuery({
    queryKey: calendarKeys.range(from, to),
    queryFn: async () => {
      const items: JobSummary[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < MAX_PAGES; i++) {
        const page = await source.jobsBetween(from, to, cursor);
        items.push(...page.items);
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      return items;
    },
    enabled,
    // A month's jobs change when the office books or moves one, not by the
    // second; the cleaner's own claims and clock-outs refresh "jobs" anyway.
    staleTime: 60_000,
    // Keep last month on screen while the next one loads, rather than a spinner.
    placeholderData: keepPreviousData,
  });
}
