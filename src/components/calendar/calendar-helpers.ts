import { CalendarEvent } from "./types";
import { eventOverlaps } from "./utils";

// ============================================================================
// CONSTANTS
// ============================================================================

/** Minimum event height in pixels */
export const MIN_EVENT_HEIGHT = 15;

/** Minimum block height in pixels */
export const MIN_BLOCK_HEIGHT = 10;

/** Drag threshold in pixels - movement beyond this starts a drag selection */
export const DRAG_THRESHOLD = 5;

// ============================================================================
// TYPES
// ============================================================================

export interface EventPosition {
  top: number;
  height: number;
  left: string;
  width: string;
}

export interface OfficeHours {
  start: number;
  end: number;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Creates the visible time bounds for a given day, respecting office hours.
 */
export function getVisibleTimeBounds(
  day: Date,
  officeHours: OfficeHours | null
): { start: Date; end: Date } {
  const visibleStart = new Date(day);
  const visibleEnd = new Date(day);

  if (officeHours) {
    visibleStart.setHours(officeHours.start, 0, 0, 0);
    visibleEnd.setHours(officeHours.end, 0, 0, 0);
  } else {
    visibleStart.setHours(0, 0, 0, 0);
    visibleEnd.setHours(23, 59, 59, 999);
  }

  return { start: visibleStart, end: visibleEnd };
}

/**
 * Calculates the pixel position and size for an event within the time grid.
 */
export function calculateEventPosition(
  event: CalendarEvent,
  day: Date,
  officeHours: OfficeHours | null,
  zoomLevel: number,
  layout: { index: number; total: number }
): EventPosition | null {
  const { start: visibleStart, end: visibleEnd } = getVisibleTimeBounds(
    day,
    officeHours
  );
  const eventEnd =
    event.end || new Date(event.start.getTime() + 60 * 60 * 1000);

  // Skip events outside visible time range
  if (
    event.start.getTime() >= visibleEnd.getTime() ||
    eventEnd.getTime() <= visibleStart.getTime()
  ) {
    return null;
  }

  // Clip event to visible boundaries
  const segStart = new Date(
    Math.max(event.start.getTime(), visibleStart.getTime())
  );
  const segEnd = new Date(
    Math.min((event.end || eventEnd).getTime(), visibleEnd.getTime())
  );

  // Calculate vertical position
  const officeStart = officeHours?.start || 0;
  const top =
    (segStart.getHours() - officeStart) * zoomLevel +
    (segStart.getMinutes() * zoomLevel) / 60;

  const height = Math.max(
    MIN_EVENT_HEIGHT,
    (segEnd.getHours() - segStart.getHours()) * zoomLevel +
      ((segEnd.getMinutes() - segStart.getMinutes()) * zoomLevel) / 60
  );

  // Calculate horizontal position based on overlapping events
  const gapWidth = layout.total > 1 ? 2 : 0;
  const availableWidth = 100 - (layout.total - 1) * gapWidth;
  const width = `${availableWidth / layout.total}%`;
  const left = `${layout.index * (availableWidth / layout.total) + layout.index * gapWidth}%`;

  return { top, height, left, width };
}

/**
 * Determines border radius classes based on whether event is clipped at top/bottom.
 */
export function getBorderRadiusClasses(
  event: CalendarEvent,
  segStart: Date,
  segEnd: Date
): string {
  const topRound = segStart.getTime() === event.start.getTime();
  const bottomRound = event.end
    ? segEnd.getTime() === event.end.getTime()
    : true;

  if (topRound && bottomRound) return "rounded-lg";
  if (topRound) return "rounded-t-lg rounded-b-none";
  if (bottomRound) return "rounded-b-lg rounded-t-none";
  return "rounded-none";
}

/**
 * Computes the layout (column index and total columns) for overlapping events.
 */
export function computeEventLayout(
  events: CalendarEvent[],
  movingEventId: string | null
): Record<string, { index: number; total: number }> {
  const layout: Record<string, { index: number; total: number }> = {};
  if (!events || events.length === 0) return layout;

  // Sort events by start time
  const sortedEvents = [...events].sort(
    (a, b) => a.start.getTime() - b.start.getTime()
  );

  // Build adjacency list for overlapping events
  const adj: Record<string, string[]> = {};
  sortedEvents.forEach((e) => (adj[e.id] = []));

  for (let i = 0; i < sortedEvents.length; i++) {
    for (let j = i + 1; j < sortedEvents.length; j++) {
      if (eventOverlaps(sortedEvents[i], sortedEvents[j])) {
        adj[sortedEvents[i].id].push(sortedEvents[j].id);
        adj[sortedEvents[j].id].push(sortedEvents[i].id);
      }
    }
  }

  // Find connected components (groups of overlapping events)
  const groups: CalendarEvent[][] = [];
  const visited = new Set<string>();
  const eventMap = new Map(sortedEvents.map((e) => [e.id, e]));

  for (const event of sortedEvents) {
    if (!visited.has(event.id)) {
      const component: CalendarEvent[] = [];
      const queue = [event.id];
      visited.add(event.id);
      let head = 0;

      while (head < queue.length) {
        const currentId = queue[head++];
        const currentEvent = eventMap.get(currentId);
        if (currentEvent) component.push(currentEvent);

        for (const neighborId of adj[currentId]) {
          if (!visited.has(neighborId)) {
            visited.add(neighborId);
            queue.push(neighborId);
          }
        }
      }
      groups.push(component);
    }
  }

  // Assign columns within each group
  for (const group of groups) {
    const groupSorted = group.sort((a, b) => {
      // Keep moving event on top
      if (movingEventId) {
        if (a.id === movingEventId) return 1;
        if (b.id === movingEventId) return -1;
      }
      // Sort by start time, then by duration (longer first)
      if (a.start.getTime() !== b.start.getTime()) {
        return a.start.getTime() - b.start.getTime();
      }
      const aEnd = a.end ?? new Date(a.start.getTime() + 60 * 60 * 1000);
      const bEnd = b.end ?? new Date(b.start.getTime() + 60 * 60 * 1000);
      return bEnd.getTime() - aEnd.getTime();
    });

    const columns: CalendarEvent[][] = [];
    const eventColumnMap = new Map<string, number>();

    for (const event of groupSorted) {
      let placed = false;
      for (let i = 0; i < columns.length; i++) {
        if (!columns[i].some((e) => eventOverlaps(event, e))) {
          columns[i].push(event);
          eventColumnMap.set(event.id, i);
          placed = true;
          break;
        }
      }
      if (!placed) {
        columns.push([event]);
        eventColumnMap.set(event.id, columns.length - 1);
      }
    }

    const totalColumns = Math.max(columns.length, 1);
    for (const event of group) {
      layout[event.id] = {
        index: eventColumnMap.get(event.id) ?? 0,
        total: totalColumns,
      };
    }
  }

  return layout;
}

/**
 * Formats hour for display (12h or 24h format).
 */
export function formatHour(hour: number, use24Hour: boolean): string {
  if (use24Hour) {
    return `${hour.toString().padStart(2, "0")}:00`;
  }
  if (hour === 0 || hour === 24) return "12am";
  if (hour < 12) return `${hour}am`;
  if (hour === 12) return "12pm";
  return `${hour - 12}pm`;
}

