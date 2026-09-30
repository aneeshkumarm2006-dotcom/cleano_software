/**
 * What each plan costs and what it allows.
 *
 * Prices set 2026-09-30, in USD, against the market: BookingKoala $27-$197/mo,
 * ZenMaid $19-$49 plus $4-$24 per cleaner (about $200-$300/mo for a real crew),
 * Jobber $49 for one user or $199 for five, Launch27 $75/$150/$299 with 15% off
 * yearly and a 14-day trial. Ours are flat per crew size with no per-cleaner
 * fee, a longer trial with no card, and a better yearly discount. The limits
 * are not decoration -- they are enforced, so a Starter workspace really cannot
 * add a sixth cleaner.
 */
import type { OrgPlan } from "@prisma/client";

export const TRIAL_DAYS = 30;

/** Months charged on an annual plan: two free (about 17% off). */
export const ANNUAL_MONTHS_CHARGED = 10;

/**
 * The launch offer: a yearly plan bought before `endsAt` charges nine months
 * instead of ten (three free). The price is written onto the Stripe
 * subscription when it is bought (billing.ts uses price_data), so it renews at
 * that price — a founding customer keeps it — while a later plan change is
 * priced fresh.
 */
export const LAUNCH_OFFER = {
  endsAt: new Date("2027-01-01T00:00:00Z"),
  annualMonthsCharged: 9,
  /** Shown where the offer is. */
  label: "Launch offer: 3 months free when you pay yearly, until December 31",
} as const;

export function launchOfferActive(now: Date = new Date()): boolean {
  return now < LAUNCH_OFFER.endsAt;
}

/** Months charged for a year bought now. */
export function annualMonthsCharged(now: Date = new Date()): number {
  return launchOfferActive(now) ? LAUNCH_OFFER.annualMonthsCharged : ANNUAL_MONTHS_CHARGED;
}

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
export function priceFor(plan: OrgPlan, interval: BillingIntervalKey, now: Date = new Date()): number | null {
  const monthly = PLANS[plan].monthlyUsd;
  if (monthly == null) return null;
  return interval === "ANNUAL" ? monthly * annualMonthsCharged(now) : monthly;
}

/** What an annual plan works out to per month, for the "$X/mo billed yearly" line. */
export function effectiveMonthlyFor(plan: OrgPlan, interval: BillingIntervalKey, now: Date = new Date()): number | null {
  const total = priceFor(plan, interval, now);
  if (total == null) return null;
  return interval === "ANNUAL" ? Math.round((total / 12) * 100) / 100 : total;
}

/** Whole months saved by paying yearly, launch offer included. */
export function annualMonthsSaved(now: Date = new Date()): number {
  return 12 - annualMonthsCharged(now);
}

export function trialEndFrom(start: Date): Date {
  const end = new Date(start);
  end.setDate(end.getDate() + TRIAL_DAYS);
  return end;
}
