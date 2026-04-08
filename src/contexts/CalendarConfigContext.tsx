"use client";

import React, { createContext, useState, useContext } from "react";

interface ICalendarConfig {
  eventTypes?: Record<string, any>;
  labels?: Array<{ name: string; labelConfig?: any }>;
  use24HourClock?: boolean;
  hideNonOfficeHours?: boolean;
  officeHoursStart?: string;
  officeHoursEnd?: string;
  scheduleBlocks?: Record<string, any>;
  prefetchEnabled?: boolean;
}

interface CalendarConfigContextType {
  config: ICalendarConfig | null;
  isLoading: boolean;
  refetchConfig: () => void;
  updateConfig: (updates: Partial<ICalendarConfig>) => void;
}

const CalendarConfigContext = createContext<
  CalendarConfigContextType | undefined
>(undefined);

export const CalendarConfigProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  // Default per-type colors (aligned with the app palette so events stay visible)
  const defaultEventTypes: Record<string, any> = {
    "R - Residential": { color: "#005F6A" }, // teal (app primary family)
    "C - Commercial": { color: "#005F6A" }, // amber
    "PC - Post Construction": { color: "#005F6A" }, // violet
    "F - Follow-up": { color: "#005F6A" }, // green
  };

  const [config, setConfig] = useState<ICalendarConfig | null>({
    eventTypes: defaultEventTypes,
    labels: [],
    use24HourClock: false,
    hideNonOfficeHours: false,
    scheduleBlocks: {},
  });
  const [isLoading, setIsLoading] = useState(false);

  const refetchConfig = () => {
    // UI-only: no-op
  };

  const updateConfig = (updates: Partial<ICalendarConfig>) => {
    setConfig((prev) => {
      if (!prev) return prev;
      return { ...prev, ...updates };
    });
  };

  const value = {
    config,
    isLoading,
    refetchConfig,
    updateConfig,
  };

  return (
    <CalendarConfigContext.Provider value={value}>
      {children}
    </CalendarConfigContext.Provider>
  );
};

export const useCalendarConfig = () => {
  const context = useContext(CalendarConfigContext);
  if (context === undefined) {
    throw new Error(
      "useCalendarConfig must be used within a CalendarConfigProvider"
    );
  }
  return context;
};
