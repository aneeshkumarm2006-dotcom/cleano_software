/**
 * What each plan costs and what it allows.
 *
 * Prices are placeholders agreed with Prem and are meant to be changed; the
 * limits are not decoration -- they are enforced, so a Starter workspace really
 * cannot add a sixth cleaner.
 */
import type { OrgPlan } from "@prisma/client";

export const TRIAL_DAYS = 30;

/**
 * Months charged on an annual plan. Two free is the usual shape and it is a
 * placeholder like every price here: the annual discount is one of the pricing
 * decisions still to be made, and this is the single line that changes it.
 */
export const ANNUAL_MONTHS_CHARGED = 10;

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

export type BillingIntervalKey = "MONTHLY" | "ANNUAL";

/**
 * What a plan costs for one billing period, in whole dollars.
 *
 * Derived from monthlyUsd rather than stored separately, so an annual price can
 * never quietly disagree with the monthly one it is meant to discount. NULL
 * stays NULL: a quoted tier has no listed price on either cycle.
 */
export function priceFor(plan: OrgPlan, interval: BillingIntervalKey): number | null {
  const monthly = PLANS[plan].monthlyUsd;
  if (monthly == null) return null;
  return interval === "ANNUAL" ? monthly * ANNUAL_MONTHS_CHARGED : monthly;
}

/** What an annual plan works out to per month, for the "$X/mo billed yearly" line. */
export function effectiveMonthlyFor(plan: OrgPlan, interval: BillingIntervalKey): number | null {
  const total = priceFor(plan, interval);
  if (total == null) return null;
  return interval === "ANNUAL" ? Math.round((total / 12) * 100) / 100 : total;
}

/** Whole months saved by paying yearly. Zero when there is no discount. */
export const ANNUAL_MONTHS_SAVED = 12 - ANNUAL_MONTHS_CHARGED;

export function trialEndFrom(start: Date): Date {
  const end = new Date(start);
  end.setDate(end.getDate() + TRIAL_DAYS);
  return end;
}
