import React from "react";
import { AlertTriangle } from "lucide-react";
import { CalendarEvent } from "./types";
import { cornerBadge, errorReason } from "./status-meta";

/**
 * Top-left corner badge on a booking card/chip:
 *   • error (red ⚠)  — cleaner missing equipment OR a customer reschedule ask
 *   • "R" (blue)     — Routine
 *   • "I" (yellow)   — Important
 * Error always wins. Renders nothing when there's no label.
 */
export const CornerBadge: React.FC<{ event: CalendarEvent }> = ({ event }) => {
  const kind = cornerBadge(event);
  if (!kind) return null;

  if (kind === "error") {
    return (
      <span className="cal-badge cal-badge-error" title={errorReason(event)}>
        <AlertTriangle size={10} strokeWidth={2.6} />
      </span>
    );
  }
  if (kind === "important") {
    return (
      <span className="cal-badge cal-badge-important" title="Important booking">
        I
      </span>
    );
  }
  return (
    <span className="cal-badge cal-badge-routine" title="Routine booking">
      R
    </span>
  );
};

export default CornerBadge;
