import type { StrikeReason } from "@prisma/client";

/** Rolling window: a strike counts as active for this many days after it's
 *  applied, then it automatically rolls off. */
export const STRIKE_WINDOW_DAYS = 30;

/** Active-strike count at which the cleaner is flagged for admin review. */
export const STRIKE_THRESHOLD = 3;

/** Human-readable labels for each strike reason (admin + cleaner UI). */
export const STRIKE_REASON_LABELS: Record<StrikeReason, string> = {
  LATE_45: "45+ minutes late without approved notice",
  NO_SHOW: "No-show",
  LOW_RATINGS_CONSECUTIVE: "Two consecutive ratings below 3 stars",
  REFUND_COMPLAINT: "Complaint resulting in a half or full refund",
  LATE_CANCEL: "Cancelled a confirmed shift < 24h before start",
  JOB_ABANDONMENT: "Left a job before completion without approval",
  FALSIFIED_CLOCK: "Falsified or incorrect clock-in / clock-out",
  CHECKLIST_FAILURE: "Repeated failure to complete checklist / photos",
  UNAPPROVED_PERSON: "Brought an unapproved person / shared job access",
  MISCONDUCT: "Unprofessional conduct, privacy breach, or off-channel contact",
  MANUAL: "Manual strike",
};

export type StrikeLevel = "OK" | "WARNING" | "REVIEW";

export function strikeLevel(activeCount: number): StrikeLevel {
  if (activeCount >= STRIKE_THRESHOLD) return "REVIEW";
  if (activeCount >= 1) return "WARNING";
  return "OK";
}
