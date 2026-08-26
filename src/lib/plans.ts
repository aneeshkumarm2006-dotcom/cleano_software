/**
 * What each plan costs and what it allows.
 *
 * Prices are placeholders agreed with Prem and are meant to be changed; the
 * limits are not decoration -- they are enforced, so a Starter workspace really
 * cannot add a sixth cleaner.
 */
import type { OrgPlan } from "@prisma/client";

export const TRIAL_DAYS = 30;

export interface PlanDef {
  label: string;
  /** NULL means "talk to us" — the Organization tier is quoted, not listed. */
  monthlyUsd: number | null;
  /** NULL means no cap. */
  maxCleaners: number | null;
  /** Shown on the pricing page, in order. */
  highlights: string[];
  /** Can a company sign themselves up onto this, or must they ask? */
  selfServe: boolean;
}

export const PLANS: Record<OrgPlan, PlanDef> = {
  STARTER: {
    label: "Starter",
    monthlyUsd: 49,
    maxCleaners: 5,
    highlights: [
      "Up to 5 cleaners",
      "Scheduling and job management",
      "Customer booking page",
      "Email notifications",
    ],
    selfServe: true,
  },
  PROFESSIONAL: {
    label: "Professional",
    monthlyUsd: 149,
    maxCleaners: 20,
    highlights: [
      "Up to 20 cleaners",
      "Everything in Starter",
      "Payroll, inventory and reporting",
      "SMS notifications",
      "Recurring bookings and quotes",
    ],
    selfServe: true,
  },
  ORGANIZATION: {
    label: "Organization",
    monthlyUsd: null,
    maxCleaners: null,
    highlights: [
      "Unlimited cleaners",
      "Everything in Professional",
      "Onboarding and data migration",
      "Priority support",
    ],
    selfServe: false,
  },
};

/** The plans a visitor can sign up for without talking to anyone. */
export const SELF_SERVE_PLANS = (Object.keys(PLANS) as OrgPlan[]).filter(
  (p) => PLANS[p].selfServe,
);

/**
 * The cleaner cap in force for a workspace.
 *
 * A seat count sold on the Subscription wins over the plan default, so a
 * negotiated deal does not need its own plan.
 */
export function cleanerLimitFor(plan: OrgPlan, seats: number | null): number | null {
  if (seats != null) return seats;
  return PLANS[plan].maxCleaners;
}

export function trialEndFrom(start: Date): Date {
  const end = new Date(start);
  end.setDate(end.getDate() + TRIAL_DAYS);
  return end;
}
