import { CalendarEvent } from "./types";
import { eventEnd, eventOverlaps } from "./utils";

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Minimum event height in pixels.
 *
 * Was 15, which is below the height of the one line a card must show. At the
 * lowest zoom (56px/hour) a 15-minute job is 14px — floored to 15 it painted a
 * coloured sliver with no name in it, which is half of "it's hard to click on"
 * (Q2 §4). 26px is the height at which `.cal-ev-in`'s 10px of vertical padding
 * plus the 12.5px client-name line actually fit.
 */
export const MIN_EVENT_HEIGHT = 26;

/** Minimum block height in pixels */
export const MIN_BLOCK_HEIGHT = 10;

/** Drag threshold in pixels - movement beyond this starts a drag selection */
export const DRAG_THRESHOLD = 5;

/**
 * Narrowest lane a booking card may be squeezed into, in pixels.
 *
 * The old layout divided a column into n equal lanes with no floor, so ten
 * overlapping jobs became ten 12px slivers in a week column — the client's
 * "especially when the jobs are stacked up on one another" (Q2 §4). Below this
 * width a lane stops being a card: the name is fully clipped and the target is
 * smaller than a fingertip. Columns wider than 2 × this get a lane budget and
 * the surplus collapses into a "+N more" chip; narrower ones (a 96px phone
 * column) keep the cascade fallback, which is the better of the two at that
 * size.
 */
export const MIN_LANE_PX = 72;

// ============================================================================
// TYPES
// ============================================================================

export interface EventPosition {
  top: number;
  height: number;
  left: string;
  width: string;
  /** Paint order for cascade-overlapped events (later starts on top). */
  zIndex?: number;
}

/** Where one event sits among the events it overlaps. */
export interface EventLayout {
  index: number;
  total: number;
  /**
   * True when the lane budget ran out before this event. It is not rendered;
   * the group's "+N more" chip stands in for it. See `overflowGroups`.
   */
  hidden?: boolean;
  /** Id of the earliest event in this overlap group — the overflow chip's key. */
  groupKey?: string;
  /**
   * Measured pixel width of the column being laid out. When present, lane
   * widths are judged in pixels rather than percent, which is what lets the
   * cascade fallback stay reserved for genuinely narrow columns.
   */
  columnWidth?: number;
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
 *
 * Browser-local by design — see the note on `format` in ./utils.ts. Events
 * reaching this module are floating store wall-clock (getJobsForDay →
 * toBusinessWallClock), so `setHours` / `getHours` here already yield store
 * time for every viewer. Pinning them to STORE_TZ would convert twice.
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
  layout: EventLayout
): EventPosition | null {
  const { start: visibleStart, end: visibleEnd } = getVisibleTimeBounds(
    day,
    officeHours
  );
  // Zero-length ends count as absent — see `eventEnd` in ./utils for why half
  // the live jobs have one and what it was doing to this grid.
  const end = eventEnd(event);

  // Skip events outside visible time range
  if (
    event.start.getTime() >= visibleEnd.getTime() ||
    end.getTime() <= visibleStart.getTime()
  ) {
    return null;
  }

  // Clip event to visible boundaries
  const segStart = new Date(
    Math.max(event.start.getTime(), visibleStart.getTime())
  );
  const segEnd = new Date(
    Math.min(end.getTime(), visibleEnd.getTime())
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
  const lanePct = availableWidth / layout.total;

  // Equal lane division turns into unreadable slivers when many events
  // overlap (esp. narrow mobile columns). Below a minimum lane width,
  // switch to a cascade: every event keeps MIN_LANE_PCT width and staggers
  // across the column, later starts painting on top (Apple-calendar style).
  //
  // When the caller measured the column (`columnWidth`), that judgement is
  // made in PIXELS instead — `computeEventLayout` has already capped `total`
  // to lanes of at least MIN_LANE_PX, so equal lanes are known to be readable
  // and the cascade would only re-stack cards that already fit. The percent
  // rule survives as the fallback for the first paint, before measurement, and
  // for columns too narrow to budget (see `resolveLaneCap`).
  const MIN_LANE_PCT = 45;
  const lanePx = layout.columnWidth
    ? (lanePct / 100) * layout.columnWidth
    : null;
  const tooNarrow =
    lanePx != null ? lanePx < MIN_LANE_PX : lanePct < MIN_LANE_PCT;
  if (tooNarrow) {
    const step = layout.total > 1 ? (100 - MIN_LANE_PCT) / (layout.total - 1) : 0;
    return {
      top,
      height,
      left: `${layout.index * step}%`,
      width: `${MIN_LANE_PCT}%`,
      // Cap below the sticky hour gutter (z 31) and drag preview (z 30).
      zIndex: Math.min(22 + layout.index, 29),
    };
  }

  const width = `${lanePct}%`;
  const left = `${layout.index * lanePct + layout.index * gapWidth}%`;

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
 * How many lanes a column of `columnWidth` pixels can hold at a readable width.
 *
 * Returns `undefined` — meaning "don't cap, use the cascade" — when the column
 * hasn't been measured yet, or is too narrow to hold even two lanes. One lane
 * is not a budget: capping to it would stack every overlapping job on top of
 * the same card. A phone's 96px column takes that branch and keeps the
 * behaviour it has today.
 */
export function resolveLaneCap(
  columnWidth: number | null | undefined
): number | undefined {
  if (!columnWidth || columnWidth <= 0) return undefined;
  const capacity = Math.floor(columnWidth / MIN_LANE_PX);
  return capacity >= 2 ? capacity : undefined;
}

/**
 * The "+N more" chips a column needs: one per overlap group that ran out of
 * lanes, carrying the events it stands in for (earliest first) and the top of
 * the earliest one, so the chip can be pinned beside it.
 */
export interface OverflowGroup {
  key: string;
  top: number;
  events: CalendarEvent[];
}

export function overflowGroups(
  events: CalendarEvent[],
  layoutMap: Record<string, EventLayout>,
  day: Date,
  officeHours: OfficeHours | null,
  zoomLevel: number
): OverflowGroup[] {
  const byGroup = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const l = layoutMap[event.id];
    if (!l?.hidden) continue;
    const key = l.groupKey ?? event.id;
    const list = byGroup.get(key);
    if (list) list.push(event);
    else byGroup.set(key, [event]);
  }

  const groups: OverflowGroup[] = [];
  for (const [key, list] of byGroup) {
    const sorted = [...list].sort(
      (a, b) => a.start.getTime() - b.start.getTime()
    );
    // Position from the earliest hidden event, reusing the same clipping the
    // cards go through — an event scrolled out of office hours returns null
    // and takes its chip with it.
    const anchor = calculateEventPosition(sorted[0], day, officeHours, zoomLevel, {
      index: 0,
      total: 1,
    });
    if (!anchor) continue;
    groups.push({ key, top: anchor.top, events: sorted });
  }
  return groups;
}

/**
 * Computes the layout (column index and total columns) for overlapping events.
 *
 * `maxLanes` caps how many events a group renders side by side; the surplus is
 * flagged `hidden` and belongs to a "+N more" chip (see `overflowGroups`).
 * Pass `undefined` for the uncapped behaviour.
 */
export function computeEventLayout(
  events: CalendarEvent[],
  movingEventId: string | null,
  maxLanes?: number
): Record<string, EventLayout> {
  const layout: Record<string, EventLayout> = {};
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
      const aEnd = eventEnd(a);
      const bEnd = eventEnd(b);
      if (aEnd.getTime() !== bEnd.getTime()) {
        return bEnd.getTime() - aEnd.getTime();
      }
      // Same start AND same end — extremely common now that half the live jobs
      // are drawn as the same 1-hour default block. Falling through to an
      // unstable tie made lane assignment (and therefore which jobs land behind
      // the "+N more" chip) reshuffle on every render; id keeps it steady.
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
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

    const laneCount = Math.max(columns.length, 1);
    // Cap the lanes, don't shrink them. Everything past the budget keeps its
    // real column index for sorting but is not painted — the group's "+N more"
    // chip is its stand-in, and the drawer opens from there just as it does
    // from a card.
    const totalColumns =
      maxLanes && maxLanes > 0 ? Math.min(laneCount, maxLanes) : laneCount;
    const groupKey = groupSorted[0]?.id;
    for (const event of group) {
      const index = eventColumnMap.get(event.id) ?? 0;
      layout[event.id] = {
        index: Math.min(index, totalColumns - 1),
        total: totalColumns,
        hidden: index >= totalColumns,
        groupKey,
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

