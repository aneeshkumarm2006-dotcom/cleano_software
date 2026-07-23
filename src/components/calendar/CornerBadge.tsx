import React from "react";
import { AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { CalendarEvent } from "./types";
import { cornerBadge, errorReason, hasMissingEquipment } from "./status-meta";

/**
 * Top-left corner badge on a booking card/chip:
 *   • error (red ⚠)  — cleaner missing equipment OR a customer reschedule ask
 *   • "R" (blue)     — Routine
 *   • "I" (yellow)   — Important
 * Error always wins. Renders nothing when there's no label.
 */
export const CornerBadge: React.FC<{ event: CalendarEvent }> = ({ event }) => {
  const router = useRouter();
  const kind = cornerBadge(event);
  if (!kind) return null;

  if (kind === "error") {
    // A missing-equipment error links DIRECTLY to that cleaner's inventory
    // (item 6) — one click from the calendar, without opening the job modal.
    const meta = event.metadata as
      | { cleaners?: { id: string }[]; employeeId?: string }
      | undefined;
    const cleanerId = meta?.cleaners?.[0]?.id || meta?.employeeId;
    if (hasMissingEquipment(event) && cleanerId) {
      return (
        <button
          type="button"
          className="cal-badge cal-badge-error"
          title={`${errorReason(event)} — open cleaner inventory`}
          onClick={(e) => {
            e.stopPropagation(); // don't also open the job modal
            router.push(`/admin/employees/${cleanerId}?tab=products`);
          }}
          style={{ cursor: "pointer", border: "none" }}>
          <AlertTriangle size={10} strokeWidth={2.6} />
        </button>
      );
    }
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
