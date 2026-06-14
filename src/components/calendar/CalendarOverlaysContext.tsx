"use client";

import { createContext, useContext } from "react";

export interface CalendarOverlays {
  availability: boolean;
  blocks: boolean;
}

const CalendarOverlaysContext = createContext<CalendarOverlays>({
  availability: true,
  blocks: true,
});

export const CalendarOverlaysProvider = CalendarOverlaysContext.Provider;

export function useCalendarOverlays(): CalendarOverlays {
  return useContext(CalendarOverlaysContext);
}
