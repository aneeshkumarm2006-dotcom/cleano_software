// SINGLE SOURCE OF TRUTH for "what has this cleaner earned?" (item 2).
//
// Before this module, three places computed cleaner pay three different ways:
//   • payroll (createPayPeriod)  → computeJobPayout() tier split
//   • My Pay                     → employeePay / participants * payRateMultiplier
//   • My Income (getIncomeData)  → sum of Payout rows on PAID periods only
// so a cleaner's "pending" never matched what they were actually paid, and
// "Jobs completed" only counted jobs that already sat inside a PAID period.
//
// Everything now flows through:
//   • computeJobPayShares() — the per-job pay math (used by payroll AND My Pay)
//   • getCleanerEarnings()  — the aggregate used by My Pay AND My Income
//
// Server-only (imports the db client).

import { db } from "@/db";
import { getCleanerRateInputs } from "./cleaner-rates";
import { computeJobPayout, type CleanerRateInput } from "./pay-tiers";
import {
  currentPayPeriodRange,
  parseBusinessDate,
  type PayPeriodRange,
} from "./pay-period";

export type JobPayType = "PERCENTAGE" | "FLAT" | "HOURLY";

/** Shape every pay calculation needs from a Job row. */
export interface JobPayInput {
  id: string;
  employeeId: string | null;
  cleaners: { id: string }[];
  price: number | null;
  employeePay: number | null;
  payType: string | null;
  hourlyRate: number | null;
  payRateMultiplier: number | null;
  totalTip: number | null;
  jobDate: Date | null;
  startTime: Date | null;
  endTime: Date | null;
  clockInTime: Date | null;
  clockOutTime: Date | null;
  /**
   * Per-cleaner manual pay overrides (JobAssignment.payAmount). Lets admin split
   * a job's pay unevenly — e.g. a $100 FLAT job paid $70 / $30 instead of
   * $50 / $50. A null payAmount means "no override, use the normal rule".
   */
  assignments?: { cleanerId: string; payAmount: number | null }[];
}

/** Prisma select shared by payroll and the earnings aggregate. */
export const JOB_PAY_SELECT = {
  id: true,
  employeeId: true,
  employeePay: true,
  price: true,
  payType: true,
  hourlyRate: true,
  payRateMultiplier: true,
  totalTip: true,
  jobDate: true,
  startTime: true,
  endTime: true,
  clockInTime: true,
  clockOutTime: true,
  cleaners: { select: { id: true } },
  assignments: { select: { cleanerId: true, payAmount: true } },
} as const;

/** Statuses payroll actually pays for. Estimates must use the same set. */
export const PAYABLE_JOB_STATUSES = ["COMPLETED", "PAID"] as const;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Lead + assigned cleaners, de-duplicated. */
export function jobParticipantIds(job: JobPayInput): string[] {
  return Array.from(
    new Set(
      [job.employeeId, ...job.cleaners.map((c) => c.id)].filter(
        (id): id is string => !!id
      )
    )
  );
}

/** Hours worked on the job (clock times win; scheduled times are the fallback). */
export function jobWorkedHours(job: JobPayInput): number {
  const start = job.clockInTime ?? job.startTime;
  const end = job.clockOutTime ?? job.endTime;
  if (!start || !end) return 0;
  return Math.max(
    0,
    (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000
  );
}

/** The instant a job counts against for period/year bucketing. */
export function jobEffectiveDate(job: JobPayInput): Date | null {
  const d = job.jobDate ?? job.startTime;
  return d ? new Date(d) : null;
}

export interface JobPayShare {
  /** Pay before the per-job multiplier and tips. */
  base: number;
  /** Pay after the per-job multiplier (still without tips). */
  afterMultiplier: number;
  /** This cleaner's slice of the job's tips. */
  tip: number;
  /** What the cleaner is actually paid for this job. */
  total: number;
  /** Per-person share of the worked hours. */
  hours: number;
}

/**
 * THE per-job pay calculation. Payroll and every estimate must call this.
 *
 *   • PERCENTAGE — tier/split math from the job price (src/lib/pay-tiers.ts).
 *     Legacy jobs with no price fall back to an even split of employeePay.
 *   • FLAT       — employeePay is the fixed payout the admin promised the
 *     cleaner ("Cleaner is paid the fixed amount you enter in Employee pay"),
 *     so each participant gets it; it is NOT divided by the team.
 *   • HOURLY     — employeePay is hourlyRate x hours for the cleaner, same
 *     per-person semantics as FLAT.
 *
 * Tips are always split evenly across participants; payRateMultiplier applies
 * to base pay only (never to tips).
 */
export function computeJobPayShares(
  job: JobPayInput,
  rates: Map<string, CleanerRateInput>
): Map<string, JobPayShare> {
  const participantIds = jobParticipantIds(job);
  const result = new Map<string, JobPayShare>();
  if (participantIds.length === 0) return result;

  const payType = (job.payType as JobPayType) ?? "PERCENTAGE";
  const multiplier = job.payRateMultiplier ?? 1;
  const tipShare = (job.totalTip || 0) / participantIds.length;
  const perPersonHours = jobWorkedHours(job) / participantIds.length;

  const rateList: CleanerRateInput[] = participantIds.map(
    (id) =>
      rates.get(id) ?? {
        id,
        tier: "STANDARD" as const,
        avgRating: null,
        ratingCount: 0,
      }
  );

  const usePriceModel = (job.price ?? 0) > 0;
  const payout = computeJobPayout(job.price, rateList);
  const tierAmountById = new Map(payout.shares.map((s) => [s.id, s.amount]));

  // Manual per-cleaner overrides (JobAssignment.payAmount). An override always
  // wins for that cleaner.
  const overrideById = new Map<string, number>();
  for (const a of job.assignments ?? []) {
    if (a.payAmount != null && participantIds.includes(a.cleanerId)) {
      overrideById.set(a.cleanerId, a.payAmount);
    }
  }

  // FLAT / HOURLY: `employeePay` is the TEAM TOTAL for the job, divided between
  // the assigned cleaners — NOT paid to each of them (client decision). Anyone
  // with a manual override takes their fixed amount off the top; whoever is left
  // splits the remainder evenly, so the crew can never be paid more than the
  // agreed total.
  const teamTotal = job.employeePay || 0;
  const overriddenParticipants = participantIds.filter((id) =>
    overrideById.has(id)
  );
  const unoverriddenCount =
    participantIds.length - overriddenParticipants.length;
  const overriddenSum = overriddenParticipants.reduce(
    (s, id) => s + (overrideById.get(id) ?? 0),
    0
  );
  const remainderPerPerson =
    unoverriddenCount > 0
      ? Math.max(0, teamTotal - overriddenSum) / unoverriddenCount
      : 0;

  for (const id of participantIds) {
    let base: number;
    const override = overrideById.get(id);
    if (override != null) {
      base = override;
    } else if (payType === "FLAT" || payType === "HOURLY") {
      base = remainderPerPerson;
    } else if (usePriceModel) {
      base = tierAmountById.get(id) ?? 0;
    } else {
      base = teamTotal / participantIds.length;
    }
    const afterMultiplier = base * multiplier;
    result.set(id, {
      base: round2(base),
      afterMultiplier: round2(afterMultiplier),
      tip: round2(tipShare),
      total: round2(afterMultiplier + tipShare),
      hours: perPersonHours,
    });
  }
  return result;
}

/** One cleaner's pay for one job (convenience wrapper). */
export function cleanerJobPay(
  job: JobPayInput,
  rates: Map<string, CleanerRateInput>,
  employeeId: string
): JobPayShare {
  return (
    computeJobPayShares(job, rates).get(employeeId) ?? {
      base: 0,
      afterMultiplier: 0,
      tip: 0,
      total: 0,
      hours: 0,
    }
  );
}

export type PeriodStatus = "OPEN" | "DRAFT" | "APPROVED" | "PAID" | "CANCELLED";

export interface CleanerPeriodSummary {
  startDate: Date;
  endDate: Date;
  /** "OPEN" = the live current week; no PayPeriod row exists for it yet. */
  status: PeriodStatus;
  baseAmount: number;
  adjustments: number;
  deductions: number;
  reimbursements: number;
  finalAmount: number;
  jobCount: number;
  totalHours: number;
  /** True when the figures are computed live from jobs, not from a Payout row. */
  isLive: boolean;
}

export interface CleanerEarnings {
  year: number;
  /** Money owed but not yet paid: open payouts + completed jobs with no period. */
  pendingAmount: number;
  /** The portion of pendingAmount that comes from jobs no pay period covers. */
  unprocessedEarnings: number;
  /** All-time net of PAID payouts (what funds the wallet). */
  walletBalance: number;
  /** PAID payouts for work in `year` (bucketed by the period's END date). */
  paidYTD: number;
  /** paidYTD + everything still pending for work performed in `year`. */
  earnedYTD: number;
  grossYTD: number;
  deductionsYTD: number;
  adjustmentsYTD: number;
  reimbursementsYTD: number;
  paidPayoutCount: number;
  /** ALL completed/paid jobs in `year` — not just the ones inside PAID periods. */
  jobsCompletedYTD: number;
  /** Per-person hours on those jobs. */
  totalHoursYTD: number;
  /** The period that CONTAINS today, live-computed when no PayPeriod row exists. */
  currentPeriod: CleanerPeriodSummary | null;
  currentRange: PayPeriodRange;
}

function yearBounds(year: number): { start: Date; end: Date } {
  const start =
    parseBusinessDate(`${year}-01-01`) ?? new Date(Date.UTC(year, 0, 1));
  const end =
    parseBusinessDate(`${year + 1}-01-01`) ??
    new Date(Date.UTC(year + 1, 0, 1));
  return { start, end };
}

/**
 * Everything My Pay and My Income need, computed once, the same way.
 * Callers are responsible for authorization (employeeId must be the caller or
 * the caller must be an admin).
 */
export async function getCleanerEarnings(
  employeeId: string,
  year: number = new Date().getFullYear(),
  now: Date = new Date()
): Promise<CleanerEarnings> {
  const { start: yearStart, end: yearEnd } = yearBounds(year);
  const currentRange = currentPayPeriodRange(now);

  const [payouts, jobs] = await Promise.all([
    db.payout.findMany({
      where: { employeeId },
      include: { payPeriod: true },
      orderBy: { payPeriod: { startDate: "desc" } },
    }),
    db.job.findMany({
      where: {
        deletedAt: null,
        status: { in: [...PAYABLE_JOB_STATUSES] },
        OR: [{ employeeId }, { cleaners: { some: { id: employeeId } } }],
      },
      select: JOB_PAY_SELECT,
    }),
  ]);

  // Rates for every participant on those jobs — the tier split needs the whole
  // team, not just the viewer.
  const rates = await getCleanerRateInputs(
    jobs.flatMap((j) => [j.employeeId, ...j.cleaners.map((c) => c.id)])
  );

  // ── Payout-derived figures ────────────────────────────────────────────────
  const inYear = (d: Date) => d >= yearStart && d < yearEnd;

  const paidPayouts = payouts.filter((p) => p.payPeriod.status === "PAID");
  const openPayouts = payouts.filter(
    (p) =>
      p.payPeriod.status === "DRAFT" || p.payPeriod.status === "APPROVED"
  );

  // Year buckets follow the WORK (period end date), not paidAt — otherwise
  // December work paid in January lands in the wrong year.
  const paidThisYear = paidPayouts.filter((p) =>
    inYear(new Date(p.payPeriod.endDate))
  );

  const walletBalance = paidPayouts.reduce((s, p) => s + p.finalAmount, 0);
  const paidYTD = paidThisYear.reduce((s, p) => s + p.finalAmount, 0);
  const grossYTD = paidThisYear.reduce((s, p) => s + p.baseAmount, 0);
  const deductionsYTD = paidThisYear.reduce((s, p) => s + p.deductions, 0);
  const adjustmentsYTD = paidThisYear.reduce((s, p) => s + p.adjustments, 0);
  const reimbursementsYTD = paidThisYear.reduce(
    (s, p) => s + p.reimbursements,
    0
  );
  const pendingFromPeriods = openPayouts.reduce(
    (s, p) => s + p.finalAmount,
    0
  );
  const pendingThisYearFromPeriods = openPayouts
    .filter((p) => inYear(new Date(p.payPeriod.endDate)))
    .reduce((s, p) => s + p.finalAmount, 0);

  // ── Job-derived figures ───────────────────────────────────────────────────
  // A job is "processed" once a live pay period the cleaner has a payout in
  // covers its date; anything else is still owed to them. A CANCELLED period
  // pays nothing, so its jobs go back to pending instead of disappearing.
  const coveredRanges = payouts
    .filter((p) => p.payPeriod.status !== "CANCELLED")
    .map((p) => ({
      start: new Date(p.payPeriod.startDate).getTime(),
      end: new Date(p.payPeriod.endDate).getTime(),
    }));
  const isCovered = (d: Date) => {
    const t = d.getTime();
    return coveredRanges.some((r) => t >= r.start && t <= r.end);
  };

  let unprocessedEarnings = 0;
  let unprocessedThisYear = 0;
  let jobsCompletedYTD = 0;
  let totalHoursYTD = 0;
  let liveBase = 0;
  let liveTips = 0;
  let liveJobs = 0;
  let liveHours = 0;

  for (const job of jobs) {
    const share = cleanerJobPay(job as JobPayInput, rates, employeeId);
    const date = jobEffectiveDate(job as JobPayInput);
    if (!date) continue;

    if (inYear(date)) {
      jobsCompletedYTD += 1;
      totalHoursYTD += share.hours;
    }

    if (!isCovered(date)) {
      unprocessedEarnings += share.total;
      if (inYear(date)) unprocessedThisYear += share.total;
    }

    if (
      date >= currentRange.start &&
      date <= currentRange.end
    ) {
      liveBase += share.afterMultiplier;
      liveTips += share.tip;
      liveJobs += 1;
      liveHours += share.hours;
    }
  }

  const pendingAmount = round2(pendingFromPeriods + unprocessedEarnings);
  const earnedYTD = round2(
    paidYTD + pendingThisYearFromPeriods + unprocessedThisYear
  );

  // ── Current period ────────────────────────────────────────────────────────
  // The period that CONTAINS now — never an arbitrary old DRAFT. When payroll
  // hasn't created this week's PayPeriod yet, show the live week instead.
  const currentPayout =
    payouts.find((p) => {
      const s = new Date(p.payPeriod.startDate).getTime();
      const e = new Date(p.payPeriod.endDate).getTime();
      const t = now.getTime();
      return t >= s && t <= e && p.payPeriod.status !== "CANCELLED";
    }) ?? null;

  const currentPeriod: CleanerPeriodSummary | null = currentPayout
    ? {
        startDate: new Date(currentPayout.payPeriod.startDate),
        endDate: new Date(currentPayout.payPeriod.endDate),
        status: currentPayout.payPeriod.status as PeriodStatus,
        baseAmount: currentPayout.baseAmount,
        adjustments: currentPayout.adjustments,
        deductions: currentPayout.deductions,
        reimbursements: currentPayout.reimbursements,
        finalAmount: currentPayout.finalAmount,
        jobCount: currentPayout.jobCount,
        totalHours: currentPayout.totalHours,
        isLive: false,
      }
    : {
        startDate: currentRange.start,
        endDate: currentRange.end,
        status: "OPEN",
        baseAmount: round2(liveBase + liveTips),
        adjustments: 0,
        deductions: 0,
        reimbursements: 0,
        finalAmount: round2(liveBase + liveTips),
        jobCount: liveJobs,
        totalHours: round2(liveHours),
        isLive: true,
      };

  return {
    year,
    pendingAmount,
    unprocessedEarnings: round2(unprocessedEarnings),
    walletBalance: round2(walletBalance),
    paidYTD: round2(paidYTD),
    earnedYTD,
    grossYTD: round2(grossYTD),
    deductionsYTD: round2(deductionsYTD),
    adjustmentsYTD: round2(adjustmentsYTD),
    reimbursementsYTD: round2(reimbursementsYTD),
    paidPayoutCount: paidThisYear.length,
    jobsCompletedYTD,
    totalHoursYTD: round2(totalHoursYTD),
    currentPeriod,
    currentRange,
  };
}
