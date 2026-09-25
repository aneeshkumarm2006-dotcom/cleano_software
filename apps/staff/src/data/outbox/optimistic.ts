// What the screen shows the moment a tap is recorded, before (or without) the
// server hearing about it. The server's answer replaces this when it arrives.
import type { ChecklistResponse, ClockStateResponse } from "@bookmops/api/v1";
import type { QueryClient } from "@tanstack/react-query";

import { clockKeys } from "../queries/clock";
import type { OutboxAction } from "./store";

export function applyOptimistic(qc: QueryClient, action: OutboxAction): void {
  if (action.kind === "checklist") {
    qc.setQueryData<ChecklistResponse>(clockKeys.checklist(action.jobId), (prev) =>
      prev ? { items: prev.items.map((i) => (i.id === action.itemId ? { ...i, done: action.done } : i)) } : prev,
    );
    return;
  }

  qc.setQueryData<ClockStateResponse>(clockKeys.clock(action.jobId), (prev) => {
    if (!prev) return prev;
    const at = action.kind === "clockOut" ? action.body.occurredAt : action.event.occurredAt;
    switch (action.kind) {
      case "clockIn":
        return { ...prev, state: "CLOCKED_IN", clockedInAt: prev.clockedInAt ?? at, clockedOutAt: null };
      case "startBreak":
        return { ...prev, state: "ON_BREAK", breaks: [...prev.breaks, { startedAt: at, endedAt: null }] };
      case "endBreak":
        return {
          ...prev,
          state: "CLOCKED_IN",
          breaks: prev.breaks.map((b) => (b.endedAt ? b : { ...b, endedAt: at })),
        };
      case "clockOut":
        return {
          ...prev,
          state: "CLOCKED_OUT",
          clockedOutAt: at,
          breaks: prev.breaks.map((b) => (b.endedAt ? b : { ...b, endedAt: at })),
        };
    }
  });
}
