// Sample clock, checklist and kit data for development builds, held in memory
// so clocking in actually starts the timer and ticks actually stick.
import type { ChecklistItem, ClockStateResponse, KitReportItem } from "@bookmops/api/v1";

import { workedMs } from "@/lib/clock-math";

import type { DataSource } from "../source";
import { delay } from "./delay";

const clocks = new Map<string, ClockStateResponse>();
function clockOf(jobId: string): ClockStateResponse {
  let c = clocks.get(jobId);
  if (!c) {
    c = { jobId, state: "NOT_STARTED", clockedInAt: null, clockedOutAt: null, breaks: [], plannedMinutes: 180, pendingReview: false };
    clocks.set(jobId, c);
  }
  return c;
}
function save(c: ClockStateResponse) {
  clocks.set(c.jobId, c);
  return delay(c, 250);
}

const CHECKLIST: Omit<ChecklistItem, "done">[] = [
  { id: "c1", label: "Wipe all counters and backsplash", section: "Kitchen" },
  { id: "c2", label: "Clean the stovetop and oven front", section: "Kitchen" },
  { id: "c3", label: "Inside the microwave", section: "Kitchen" },
  { id: "c4", label: "Main bathroom", section: "Bathrooms" },
  { id: "c5", label: "Second bathroom", section: "Bathrooms" },
  { id: "c6", label: "Bedroom floors", section: "Bedrooms" },
  { id: "c7", label: "Make the beds", section: "Bedrooms" },
  { id: "c8", label: "Dust all reachable surfaces", section: "Living areas" },
  { id: "c9", label: "Vacuum and mop throughout", section: "Living areas" },
];
const checklists = new Map<string, ChecklistItem[]>();
function checklistOf(jobId: string) {
  let c = checklists.get(jobId);
  if (!c) {
    c = CHECKLIST.map((i, n) => ({ ...i, done: n < 3 }));
    checklists.set(jobId, c);
  }
  return c;
}

const KIT: KitReportItem[] = [
  { productId: "k1", name: "All-purpose cleaner", unit: "bottle", kind: "LEVEL", quantity: 1 },
  { productId: "k2", name: "Glass cleaner", unit: "bottle", kind: "LEVEL", quantity: 1 },
  { productId: "k3", name: "Microfibre cloths", unit: "cloths", kind: "COUNT", quantity: 12 },
  { productId: "k4", name: "Scrub sponges", unit: "sponges", kind: "COUNT", quantity: 4 },
  { productId: "k5", name: "Vacuum", unit: "unit", kind: "CONDITION", quantity: 1 },
];

export const previewClockApi = {
  clockState: (jobId) => delay(clockOf(jobId)),
  clockIn: (jobId, e) => {
    const c = clockOf(jobId);
    return save({
      ...c,
      state: "CLOCKED_IN",
      clockedInAt: c.state === "CLOCKED_OUT" ? e.occurredAt : (c.clockedInAt ?? e.occurredAt),
      clockedOutAt: null,
      workedMinutes: undefined,
    });
  },
  startBreak: (jobId, e) => {
    const c = clockOf(jobId);
    return save({ ...c, state: "ON_BREAK", breaks: [...c.breaks, { startedAt: e.occurredAt, endedAt: null }] });
  },
  endBreak: (jobId, e) => {
    const c = clockOf(jobId);
    return save({ ...c, state: "CLOCKED_IN", breaks: c.breaks.map((b) => (b.endedAt ? b : { ...b, endedAt: e.occurredAt })) });
  },
  kitReport: () => delay({ items: KIT }),
  clockOut: async (jobId, body) => {
    const c = clockOf(jobId);
    const closed: ClockStateResponse = {
      ...c,
      state: "CLOCKED_OUT",
      clockedOutAt: body.occurredAt,
      breaks: c.breaks.map((b) => (b.endedAt ? b : { ...b, endedAt: body.occurredAt })),
    };
    // As the server does: a finished shift keeps its times and says what it came to.
    const clock = await save({ ...closed, workedMinutes: Math.round(workedMs(closed, new Date(body.occurredAt)) / 60_000) });
    const restockNeeded = body.report.items.some((i) => i.levelStatus === "LOW" || i.levelStatus === "EMPTY" || i.status === "LOW" || i.status === "EMPTY");
    return { clock, jobCompleted: true, restockNeeded };
  },
  checklist: (jobId) => delay({ items: checklistOf(jobId) }),
  setChecklistItem: (jobId, itemId, done) => {
    const items = checklistOf(jobId).map((i) => (i.id === itemId ? { ...i, done } : i));
    checklists.set(jobId, items);
    return delay(items.find((i) => i.id === itemId)!, 150);
  },
} satisfies Pick<
  DataSource,
  "clockState" | "clockIn" | "startBreak" | "endBreak" | "kitReport" | "clockOut" | "checklist" | "setChecklistItem"
>;
