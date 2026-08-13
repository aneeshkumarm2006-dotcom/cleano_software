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
 *
 * Never a `<button>`. In the month grid the whole chip IS a button
 * (`button.cal-chip`), and a nested `<button>` is invalid HTML — React logged
 * "In HTML, <button> cannot be a descendant of <button>. This will cause a
 * hydration error." on every month render. The one interactive variant is a
 * `role="button"` span with its own Enter/Space handling, which is valid inside
 * a button and behaves identically everywhere the badge is used (the day/week
 * `EventCard` host is a plain div).
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
      const openInventory = () =>
        router.push(`/admin/employees/${cleanerId}?tab=products`);
      return (
        <span
          role="button"
          tabIndex={0}
          className="cal-badge cal-badge-error"
          title={`${errorReason(event)} — open cleaner inventory`}
          onClick={(e) => {
            e.stopPropagation(); // don't also open the job modal
            openInventory();
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault(); // Space must not scroll or re-fire the chip
            e.stopPropagation();
            openInventory();
          }}
          style={{ cursor: "pointer" }}>
          <AlertTriangle size={10} strokeWidth={2.6} />
        </span>
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
