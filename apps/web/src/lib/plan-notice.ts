/**
 * When to remind a company that its Bookmops plan needs paying.
 *
 * Reminders, never a lockout (decided 2026-09-30): an ended trial or a failed
 * payment keeps every feature working. The owner and admins see a banner, and
 * a popup once a day, until they pay — the way HubSpot handles it. Cleaners
 * and customers never see any of it; the company's work goes on.
 *
 * Pure, so the rule can be checked without a database.
 */

/**
 * Only companies created from this date are reminded. Paid plans open on
 * October 10; every workspace before this was set up by us (the launch
 * customers, the demo, test tenants) and must never be told to pay by a popup.
 */
export const BILLING_REMINDERS_FROM = new Date("2026-10-01T00:00:00Z");

/** Days before a trial ends that the "ending soon" banner starts. */
export const TRIAL_ENDING_DAYS = 5;

export type PlanNoticeKind = "TRIAL_ENDING" | "TRIAL_ENDED" | "PAYMENT_FAILED" | "PLAN_ENDED";

export interface PlanNotice {
  kind: PlanNoticeKind;
  /** TRIAL_ENDING only: whole days left, at least 1. */
  daysLeft?: number;
  /** Whether it also earns the daily popup, not just the banner. */
  popup: boolean;
}

export interface PlanNoticeInput {
  orgCreatedAt: Date;
  status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED";
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
}

export function planNoticeFor(input: PlanNoticeInput, now: Date = new Date()): PlanNotice | null {
  if (input.orgCreatedAt < BILLING_REMINDERS_FROM) return null;

  switch (input.status) {
    case "ACTIVE":
      return null;
    case "PAST_DUE":
      return { kind: "PAYMENT_FAILED", popup: true };
    case "CANCELED":
      // Cancelled but paid up to the period end: nothing to say until it runs out.
      if (input.currentPeriodEnd && input.currentPeriodEnd > now) return null;
      return { kind: "PLAN_ENDED", popup: true };
    case "TRIALING": {
      if (!input.trialEndsAt) return null;
      if (input.trialEndsAt <= now) return { kind: "TRIAL_ENDED", popup: true };
      const daysLeft = Math.ceil((input.trialEndsAt.getTime() - now.getTime()) / 86_400_000);
      return daysLeft <= TRIAL_ENDING_DAYS ? { kind: "TRIAL_ENDING", daysLeft, popup: false } : null;
    }
  }
}
