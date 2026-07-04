"use client";

import { createContext, useContext } from "react";

export interface CalendarOverlays {
  availability: boolean;
  blocks: boolean;
  /** Admin-selected cleaner whose availability the overlay shows.
   *  null = the logged-in user's own availability (self-view). */
  availabilityEmployeeId: string | null;
}

const CalendarOverlaysContext = createContext<CalendarOverlays>({
  availability: true,
  blocks: true,
  availabilityEmployeeId: null,
});

export const CalendarOverlaysProvider = CalendarOverlaysContext.Provider;

export function useCalendarOverlays(): CalendarOverlays {
  return useContext(CalendarOverlaysContext);
}
