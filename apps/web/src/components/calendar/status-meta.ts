// Premium calendar status palette — ported from the Cleano design handoff.
// Maps a job's DB status (with paid derived from paymentReceived) to a
// label + accent color + tint, shared across Month / Week / Day / List views.
import { CalendarEvent } from "./types";
import { propertyTypeShortLabel } from "@/lib/property-type";
import { HOLD_LABEL } from "@/lib/job-hold";

export interface StatusMeta {
  key: string;
  label: string;
  color: string;
  tint: string;
}

export const STATUS_META: Record<string, StatusMeta> = {
  // Round 4, fix 6 — this calendar was already the ONE screen calling CREATED
  // "On hold"; the other three called it "Unconfirmed", "Created" and "Booking
  // created". The wording won and is now shared from src/lib/job-hold.ts, and
  // the colour moved from slate to the amber every other surface uses for a
  // hold: grey read as "inert", which is exactly the wrong signal for the one
  // status that needs somebody to do something.
  CREATED: { key: "created", label: HOLD_LABEL, color: "#d97706", tint: "rgba(217,119,6,0.11)" },
  // Active-but-unassigned bookings render pink so dispatch can spot the gap.
  UNASSIGNED: { key: "unassigned", label: "Unassigned", color: "#db2777", tint: "rgba(219,39,119,0.11)" },
  // Assigned (a cleaner is on the job) renders dark blue.
  ASSIGNED: { key: "assigned", label: "Assigned", color: "#1d4ed8", tint: "rgba(29,78,216,0.10)" },
  IN_PROGRESS: { key: "inprogress", label: "In progress", color: "#d97706", tint: "rgba(217,119,6,0.11)" },
  COMPLETED: { key: "completed", label: "Completed", color: "#059669", tint: "rgba(5,150,105,0.11)" },
  PAID: { key: "paid", label: "Paid", color: "#15803d", tint: "rgba(21,128,61,0.11)" },
  CANCELLED: { key: "cancelled", label: "Cancelled", color: "#dc2626", tint: "rgba(220,38,38,0.08)" },
};

/**
 * Status chips shown in the calendar legend, in display order.
 *
 * Round 4, fix 6: On hold was MISSING from this list while being one of the six
 * colours the grid actually paints — so the one status an admin has to act on
 * was the one the legend never explained. It leads, because it is the only chip
 * here that means "somebody in this office owes this booking a decision".
 */
export const STATUS_LEGEND: StatusMeta[] = [
  STATUS_META.CREATED,
  STATUS_META.UNASSIGNED,
  STATUS_META.ASSIGNED,
  STATUS_META.PAID,
  STATUS_META.CANCELLED,
];

/** Does this event have at least one cleaner / primary employee on it? */
function isAssigned(event: CalendarEvent): boolean {
  const cleaners = event.metadata?.cleaners;
  if (Array.isArray(cleaners) && cleaners.length > 0) return true;
  return !!event.metadata?.employeeId;
}

/**
 * Effective status meta for an event. The calendar palette is assignment-first:
 *   • on hold (CREATED) → amber — nothing is agreed yet, so nothing else about
 *     this booking is the headline
 *   • paid (paymentReceived, or status PAID) → green
 *   • cancelled → red
 *   • otherwise → dark blue if a cleaner is assigned, pink if not
 *
 * Round 4, fix 6 moved the hold ABOVE "paid always wins". It is a rare
 * collision — a held job is one nobody has priced or dated, so there is
 * usually nothing to pay — but when it happens the honest card is the one that
 * says the booking is not agreed. It also keeps this palette in step with
 * `simpleJobStatus`, which now returns ON_HOLD ahead of PAID for the same
 * reason: four screens disagreeing about this enum is the bug being fixed.
 */
export function statusMeta(event: CalendarEvent): StatusMeta {
  const s = (event.metadata?.status as string | undefined) ?? "SCHEDULED";
  if (s === "CREATED") return STATUS_META.CREATED;
  if (event.metadata?.paymentReceived || s === "PAID") return STATUS_META.PAID;
  if (s === "CANCELLED") return STATUS_META.CANCELLED;
  return isAssigned(event) ? STATUS_META.ASSIGNED : STATUS_META.UNASSIGNED;
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

// Spec item 17: cards show the BOOKING price, not cleaner pay — this calendar
// is admin-only (cleaners get CleanerCalendarClient), so no redaction concern.
export function priceLabel(event: CalendarEvent): string | null {
  const p = event.metadata?.price;
  if (p == null) return null;
  return `$${Number(p).toFixed(0)}`;
}

/**
 * "Hourly · 4h" for a job billed by the hour, else null (Stage 8 / PDF #8).
 *
 * Deliberately carries no rate. `billedHourlyRate` is a price and is redacted
 * from viewers who may not see money; the TYPE and the HOURS are scheduling
 * facts a field lead needs, so this label is safe for every calendar audience.
 */
export function hourlyLabel(event: CalendarEvent): string | null {
  if (event.metadata?.billingType !== "HOURLY") return null;
  const h = event.metadata?.billedHours;
  const hours = Number(h);
  return Number.isFinite(hours) && hours > 0
    ? `Hourly · ${Math.round(hours * 100) / 100}h`
    : "Hourly";
}

/**
 * "Apt" / "House" for a job whose property type is recorded, else null
 * (Stage 9 / PDF #11).
 *
 * Null — not "Unknown" — for the unrecorded case, which is every job booked
 * before the column existed. A calendar full of "Unknown" tags would be noise
 * that says nothing; a missing tag already says the same thing quietly.
 *
 * Carries no money, so like `hourlyLabel` above it is safe for every calendar
 * audience including a field lead's group view.
 */
export function propertyLabel(event: CalendarEvent): string | null {
  return propertyTypeShortLabel(event.metadata?.propertyType);
}

// First name(s) of the assigned crew for compact card display.
export function cleanerLabel(event: CalendarEvent): string | null {
  const cleaners = event.metadata?.cleaners as
    | Array<{ name?: string | null }>
    | undefined;
  const names = (cleaners ?? [])
    .map((c) => (c.name ?? "").trim().split(/\s+/)[0])
    .filter(Boolean);
  if (names.length === 0) return null;
  if (names.length <= 2) return names.join(" & ");
  return `${names[0]} +${names.length - 1}`;
}

/** Short trailing locality from a full address ("…, Verdun" → "Verdun"). */
export function shortLocation(event: CalendarEvent): string | null {
  const loc = event.metadata?.location as string | undefined;
  if (!loc) return null;
  const parts = loc.split(",");
  return parts[parts.length - 1].trim();
}
