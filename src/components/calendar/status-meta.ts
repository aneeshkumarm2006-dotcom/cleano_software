// Premium calendar status palette — ported from the Cleano design handoff.
// Maps a job's DB status (with paid derived from paymentReceived) to a
// label + accent color + tint, shared across Month / Week / Day / List views.
import { CalendarEvent } from "./types";

export interface StatusMeta {
  key: string;
  label: string;
  color: string;
  tint: string;
}

export const STATUS_META: Record<string, StatusMeta> = {
  CREATED: { key: "created", label: "Created", color: "#64748b", tint: "rgba(100,116,139,0.10)" },
  SCHEDULED: { key: "scheduled", label: "Scheduled", color: "#008C9C", tint: "rgba(0,140,156,0.09)" },
  IN_PROGRESS: { key: "inprogress", label: "In progress", color: "#d97706", tint: "rgba(217,119,6,0.11)" },
  COMPLETED: { key: "completed", label: "Completed", color: "#059669", tint: "rgba(5,150,105,0.11)" },
  PAID: { key: "paid", label: "Paid", color: "#15803d", tint: "rgba(21,128,61,0.11)" },
  CANCELLED: { key: "cancelled", label: "Cancelled", color: "#dc2626", tint: "rgba(220,38,38,0.08)" },
};

/** Status chips shown in the calendar legend, in display order. */
export const STATUS_LEGEND: StatusMeta[] = [
  STATUS_META.SCHEDULED,
  STATUS_META.IN_PROGRESS,
  STATUS_META.COMPLETED,
  STATUS_META.PAID,
  STATUS_META.CANCELLED,
];

/** Effective status meta for an event (paid derives from paymentReceived). */
export function statusMeta(event: CalendarEvent): StatusMeta {
  const s = (event.metadata?.status as string | undefined) ?? "SCHEDULED";
  if (s === "COMPLETED" && event.metadata?.paymentReceived) return STATUS_META.PAID;
  return STATUS_META[s] ?? STATUS_META.SCHEDULED;
}

/** Unconfirmed jobs render faded (dashed). */
export function isUnconfirmed(event: CalendarEvent): boolean {
  return event.metadata?.status === "CREATED";
}

export function isCancelled(event: CalendarEvent): boolean {
  return event.metadata?.status === "CANCELLED";
}

export function hasMissingEquipment(event: CalendarEvent): boolean {
  const me = event.metadata?.missingEquipment;
  return Array.isArray(me) && me.length > 0;
}

/** Customer asked to move the booking — pending an admin decision. */
export function hasRescheduleRequest(event: CalendarEvent): boolean {
  return !!event.metadata?.rescheduleRequestedAt;
}

/** Either thing the ops manager must act on: missing kit or a reschedule ask. */
export function hasError(event: CalendarEvent): boolean {
  return hasMissingEquipment(event) || hasRescheduleRequest(event);
}

/** Why the error badge is showing (for the tooltip). */
export function errorReason(event: CalendarEvent): string {
  const parts: string[] = [];
  if (hasMissingEquipment(event)) parts.push("Cleaner is missing equipment");
  if (hasRescheduleRequest(event))
    parts.push("Customer requested a time/date change");
  return parts.join(" · ");
}

export type CornerBadgeKind = "error" | "routine" | "important";

/**
 * The single top-left corner badge for a booking. An error (missing equipment
 * or reschedule request) always wins; otherwise the resolved priority label.
 */
export function cornerBadge(event: CalendarEvent): CornerBadgeKind | null {
  if (hasError(event)) return "error";
  const pl = event.metadata?.priorityLabel as string | undefined;
  if (pl === "ROUTINE") return "routine";
  if (pl === "IMPORTANT") return "important";
  return null;
}

/** Cleaner pay for the card foot (employeePay from metadata). */
export function payLabel(event: CalendarEvent): string | null {
  const p = event.metadata?.employeePay;
  if (p == null) return null;
  return `$${Number(p).toFixed(0)}`;
}

/** Short trailing locality from a full address ("…, Verdun" → "Verdun"). */
export function shortLocation(event: CalendarEvent): string | null {
  const loc = event.metadata?.location as string | undefined;
  if (!loc) return null;
  const parts = loc.split(",");
  return parts[parts.length - 1].trim();
}
