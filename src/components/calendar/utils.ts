import { CalendarEvent } from "./types";

// Date utilities
export const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
export const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
export const addMonths = (d: Date, amount: number) =>
  new Date(d.getFullYear(), d.getMonth() + amount, d.getDate());
export const subMonths = (d: Date, amount: number) => addMonths(d, -amount);
export const addDays = (d: Date, amount: number) => {
  const date = new Date(d);
  date.setDate(date.getDate() + amount);
  return date;
};
export const startOfWeek = (d: Date) => {
  const date = new Date(d);
  const day = date.getDay();
  date.setDate(date.getDate() - day);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};
export const isSameMonth = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
export const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export const hexToRgba = (hex: string, alpha: number) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export const eventOverlapsDay = (event: CalendarEvent, day: Date) => {
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(day);
  dayEnd.setHours(23, 59, 59, 999);

  const eventStart = event.start;
  const eventEnd = event.end ?? event.start; // treat one-hour default when no explicit end

  return eventStart <= dayEnd && eventEnd >= dayStart;
};
export const format = (d: Date, token: string) => {
  if (token === "d") return d.getDate().toString();
  if (token === "MMMM yyyy")
    return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  if (token === "EEE d")
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
    });
  if (token === "EEEE, d MMMM yyyy")
    return d.toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  if (token === "d MMM")
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  if (token === "d MMM yyyy")
    return d.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  return d.toDateString();
};

export const eventOverlaps = (a: CalendarEvent, b: CalendarEvent) => {
    const aStart = a.start.getTime();
    const aEnd = (
    a.end ?? new Date(a.start.getTime() + 60 * 60 * 1000)
    ).getTime();
    const bStart = b.start.getTime();
    const bEnd = (
    b.end ?? new Date(b.start.getTime() + 60 * 60 * 1000)
    ).getTime();
    return aStart < bEnd && aEnd > bStart;
};

/**
 * Determines the appropriate color for a calendar event based on its type and metadata
 * @param event - The calendar event
 * @param calendarConfig - The calendar configuration containing event types
 * @param opacity - The opacity for the background color (default: 0.15)
 * @returns Object with eventColor, eventBgColor, and styling information
 */
export const getEventColors = (
  event: any,
  calendarConfig: any,
  opacity: number = 0.15
): { eventColor: string; eventBgColor: string; isUnconfirmed: boolean; borderStyle: string; borderWidth: string } => {
  let eventColor: string;

  // TDO appointments get special styling
  if (event.metadata?.isTdoAppointment) {
    eventColor = "#8B5CF6"; // Purple for TDO appointments
  } else if (event.metadata?.selectedEventType === "block") {
    // Block events get a specific color
    eventColor = "#6B7280"; // Gray-500
  } else if (event.metadata?.selectedEventType && event.metadata.selectedEventType !== "" && calendarConfig?.eventTypes) {
    // Events with event type use the event type color
    const eventTypes = calendarConfig.eventTypes as any;
    const eventType = eventTypes[event.metadata.selectedEventType];
    if (eventType?.color) {
      eventColor = eventType.color;
    } else {
      eventColor = "#16A34A"; // Green as default (instead of blue)
    }
  } else {
    // Fallback to default color for events without type
    eventColor = "#16A34A"; // Green as default (instead of blue)
  }

  const isUnconfirmed = event.confirmed === false;
  let eventBgColor = hexToRgba(eventColor, opacity);
  let borderStyle = "solid";
  let borderWidth = "1px";

  // TDO appointments get special border styling
  if (event.metadata?.isTdoAppointment) {
    borderStyle = "solid";
    borderWidth = "2px";
    // Use a slightly higher opacity for TDO appointments to make them more visible
    eventBgColor = hexToRgba(eventColor, Math.min(opacity * 1.5, 0.3));
  } else if (isUnconfirmed) {
    // For unconfirmed events, use a lighter background and dashed border
    eventBgColor = hexToRgba(eventColor, opacity * 0.5); // Even lighter background
    borderStyle = "dashed";
    borderWidth = "2px";
  }

  return { eventColor, eventBgColor, isUnconfirmed, borderStyle, borderWidth };
};

// Helper function to check if an event should be considered "unassigned"
// This includes events with no room label AND events assigned to deleted rooms
export const isEventUnassigned = (event: CalendarEvent, existingRoomNames: string[]): boolean => {
  // No label or empty label
  if (!event.label || event.label === "") return true;
  // Label exists but doesn't match any configured room (orphaned events)
  return !existingRoomNames.includes(event.label);
};

