// My pay, for the phone (packages/api/src/v1/pay.ts): the balance, the live
// week, the year so far, the payout history, the withdrawals, one pay period
// and its jobs.
//
// Every figure comes from the web's own computations, never a copy:
//   - getCleanerEarnings (lib/cleaner-earnings.ts), the aggregate My pay and
//     My income use;
//   - readBalance (./balance.ts), the withdrawable balance the withdrawal
//     request checks against;
//   - computePayoutTotals / computeJobPayShares, the numbers payroll pays.
// Dollars become integer cents once, after the web's helpers have summed.
//
// SCOPE: the caller's own money only. The employee is the session's person,
// never a value from the request; a payout or job that isn't theirs is 404.
import "server-only";

import type {
  PayPeriodDetailResponse,
  PayPeriodSummary,
  PayResponse,
  PayoutsResponse,
  Withdrawal,
  WithdrawalResponse,
  WithdrawalsResponse,
} from "@bookmops/api/v1";
import { computePayoutTotals } from "@bookmops/core/pay";
import { jobTypeLabel } from "@bookmops/core/services";
import type { Prisma } from "@prisma/client";

import {
  JOB_PAY_SELECT,
  computeJobPayShares,
  getCleanerEarnings,
  jobEffectiveDate,
  type CleanerPeriodSummary,
  type JobPayInput,
} from "@/lib/cleaner-earnings";
import { getCleanerRateInputs } from "@/lib/cleaner-rates";
import { getCleanerRatingSummary } from "@/lib/cleaner-rating.server";
import { db } from "@/lib/org-db";
import { payPeriodJobsWhere } from "@/lib/pay-period.server";
import { getServiceCatalogWithLabels } from "@/lib/service-catalog.server";
import { storeDateKey, storeParts } from "@/lib/timezone";
import {
  WITHDRAWAL_FEE_BASIS_POINTS,
  WITHDRAWAL_MINIMUM_CENTS,
  WITHDRAWAL_TIMING,
  toCents,
} from "@/lib/withdrawal-rules";

import type { Actor } from "../actor";
import { jobArea } from "../jobs/area";
import { decodeCursor, encodeCursor } from "../jobs/list";
import { failure, notFound, ok, type Result } from "../result";
import { readBalance } from "./balance";

export const PAY_PAGE_SIZE = 20;

const badCursor = () => failure(400, "VALIDATION_FAILED", "That page link isn't valid. Refresh and try again.");

/** Hours as the web prints them: two decimals at most. */
const hours2 = (h: number) => Math.round((Number(h) || 0) * 100) / 100;

function periodFromEarnings(p: CleanerPeriodSummary): PayPeriodSummary {
  return {
    id: p.payoutId ?? "current",
    startDate: storeDateKey(p.startDate),
    endDate: storeDateKey(p.endDate),
    status: p.status,
    isLive: p.isLive,
    baseCents: toCents(p.baseAmount),
    adjustmentsCents: toCents(p.adjustments),
    deductionsCents: toCents(p.deductions),
    reimbursementsCents: toCents(p.reimbursements),
    finalCents: toCents(p.finalAmount),
    jobCount: p.jobCount,
    hours: hours2(p.totalHours),
    paidAt: p.paidAt ? p.paidAt.toISOString() : null,
  };
}

const PAYOUT_SELECT = {
  id: true,
  baseAmount: true,
  adjustments: true,
  deductions: true,
  reimbursements: true,
  jobCount: true,
  totalHours: true,
  payPeriod: { select: { startDate: true, endDate: true, status: true, paidAt: true } },
} satisfies Prisma.PayoutSelect;

type PayoutRow = Prisma.PayoutGetPayload<{ select: typeof PAYOUT_SELECT }>;

function periodFromPayout(p: PayoutRow): PayPeriodSummary {
  return {
    id: p.id,
    startDate: storeDateKey(p.payPeriod.startDate),
    endDate: storeDateKey(p.payPeriod.endDate),
    // An open enum on the wire: a status v1 never named (REJECTED) reaches the
    // app as UNKNOWN, never as a parse failure.
    status: p.payPeriod.status as PayPeriodSummary["status"],
    isLive: false,
    baseCents: toCents(p.baseAmount),
    adjustmentsCents: toCents(p.adjustments),
    deductionsCents: toCents(p.deductions),
    reimbursementsCents: toCents(p.reimbursements),
    // Through the canonical helper, never the stored column: a legacy row
    // can't show a negative figure (fix list item 1).
    finalCents: toCents(computePayoutTotals(p).final),
    jobCount: p.jobCount,
    hours: hours2(p.totalHours),
    paidAt: p.payPeriod.paidAt ? p.payPeriod.paidAt.toISOString() : null,
  };
}

/** GET /api/v1/pay */
export async function payOverviewFor(actor: Actor, now: Date): Promise<Result<PayResponse>> {
  // The COMPANY's year, not the server's.
  const year = storeParts(now).year;
  const [earnings, balance, rating] = await Promise.all([
    getCleanerEarnings(actor.userId, year, now),
    readBalance(actor.userId),
    getCleanerRatingSummary(actor.userId),
  ]);

  return ok({
    balance: {
      availableCents: balance.availableCents,
      pendingCents: toCents(earnings.pendingAmount),
      unprocessedCents: toCents(earnings.unprocessedEarnings),
    },
    currentPeriod: earnings.currentPeriod ? periodFromEarnings(earnings.currentPeriod) : null,
    yearToDate: {
      year,
      earnedCents: toCents(earnings.earnedYTD),
      paidCents: toCents(earnings.paidYTD),
      jobsCompleted: earnings.jobsCompletedYTD,
      hours: hours2(earnings.totalHoursYTD),
    },
    rating: { average: rating.average, count: rating.count },
    withdrawal: {
      feeBasisPoints: WITHDRAWAL_FEE_BASIS_POINTS,
      minimumCents: WITHDRAWAL_MINIMUM_CENTS,
      timing: WITHDRAWAL_TIMING,
    },
  });
}

/** GET /api/v1/pay/payouts — newest first, by the period's start. */
export async function payoutsFor(actor: Actor, rawCursor: string | undefined): Promise<Result<PayoutsResponse>> {
  const cursor = decodeCursor(rawCursor);
  if (cursor === "invalid") return badCursor();

  const where: Prisma.PayoutWhereInput = { employeeId: actor.userId };
  if (cursor) {
    const at = new Date(cursor.s);
    where.OR = [
      { payPeriod: { startDate: { lt: at } } },
      { payPeriod: { startDate: at }, id: { lt: cursor.id } },
    ];
  }
  const rows = await db.payout.findMany({
    where,
    orderBy: [{ payPeriod: { startDate: "desc" } }, { id: "desc" }],
    take: PAY_PAGE_SIZE + 1,
    select: PAYOUT_SELECT,
  });
  const more = rows.length > PAY_PAGE_SIZE;
  const page = more ? rows.slice(0, PAY_PAGE_SIZE) : rows;
  const last = page[page.length - 1];
  return ok({
    items: page.map(periodFromPayout),
    nextCursor: more && last ? encodeCursor({ s: last.payPeriod.startDate.toISOString(), id: last.id }) : null,
  });
}

const WITHDRAWAL_SELECT = {
  id: true,
  amount: true,
  status: true,
  createdAt: true,
  processedAt: true,
  notes: true,
} satisfies Prisma.WithdrawalSelect;

/** A stored withdrawal, as the phone reads it back. The fee isn't stored, so it's null. */
export function withdrawalOut(w: Prisma.WithdrawalGetPayload<{ select: typeof WITHDRAWAL_SELECT }>): Withdrawal {
  const cents = toCents(w.amount);
  return {
    id: w.id,
    amountCents: cents,
    feeCents: null,
    netCents: cents,
    status: w.status,
    requestedAt: w.createdAt.toISOString(),
    processedAt: w.processedAt ? w.processedAt.toISOString() : null,
    note: w.notes,
  };
}

/**
 * A replayed POST /api/v1/pay/withdrawals, rebuilt from the stored row
 * rather than a 30-day copy of the answer (the idempotency record keeps only
 * the id). The row stores the net; the amount asked for is in the replayed
 * request, whose body is byte-for-byte the original's (the key's hash
 * matched), so the fee is exactly what was taken the first time: asked − net.
 * Status and processedAt are as they are now; the balance is today's.
 */
export async function withdrawalReplayFor(
  actor: Actor,
  withdrawalId: string,
  askedCents: number,
): Promise<Result<WithdrawalResponse>> {
  const row = await db.withdrawal.findFirst({
    where: { id: withdrawalId, employeeId: actor.userId },
    select: WITHDRAWAL_SELECT,
  });
  if (!row) return notFound("We couldn't find that withdrawal.");
  const out = withdrawalOut(row);
  const balance = await readBalance(actor.userId);
  const netCents = out.netCents ?? out.amountCents;
  return ok({
    withdrawal: { ...out, feeCents: Math.max(0, askedCents - netCents) },
    availableCents: balance.availableCents,
  });
}

/** GET /api/v1/pay/withdrawals — newest first. Never the payment method. */
export async function withdrawalsFor(
  actor: Actor,
  rawCursor: string | undefined,
): Promise<Result<WithdrawalsResponse>> {
  const cursor = decodeCursor(rawCursor);
  if (cursor === "invalid") return badCursor();

  const where: Prisma.WithdrawalWhereInput = { employeeId: actor.userId };
  if (cursor) {
    const at = new Date(cursor.s);
    where.OR = [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: cursor.id } }];
  }
  const rows = await db.withdrawal.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAY_PAGE_SIZE + 1,
    select: WITHDRAWAL_SELECT,
  });
  const more = rows.length > PAY_PAGE_SIZE;
  const page = more ? rows.slice(0, PAY_PAGE_SIZE) : rows;
  const last = page[page.length - 1];
  return ok({
    items: page.map(withdrawalOut),
    nextCursor: more && last ? encodeCursor({ s: last.createdAt.toISOString(), id: last.id }) : null,
  });
}

/**
 * GET /api/v1/pay/periods/:id — `id` is one of the caller's payout ids, or
 * "current" for the period containing today. Jobs are the caller's
 * COMPLETED/PAID jobs payroll counts in that window (payPeriodJobsWhere), each
 * at computeJobPayShares' figure for the caller.
 */
export async function payPeriodFor(
  actor: Actor,
  id: string,
  now: Date,
): Promise<Result<PayPeriodDetailResponse>> {
  let period: PayPeriodSummary;
  let start: Date;
  let end: Date;

  if (id === "current") {
    const earnings = await getCleanerEarnings(actor.userId, storeParts(now).year, now);
    if (!earnings.currentPeriod) return notFound("We couldn't find that pay period.");
    period = periodFromEarnings(earnings.currentPeriod);
    start = earnings.currentPeriod.startDate;
    end = earnings.currentPeriod.endDate;
  } else {
    // Scoped to the caller in the query: someone else's payout id is not found.
    const payout = await db.payout.findFirst({
      where: { id, employeeId: actor.userId },
      select: PAYOUT_SELECT,
    });
    if (!payout) return notFound("We couldn't find that pay period.");
    period = periodFromPayout(payout);
    start = payout.payPeriod.startDate;
    end = payout.payPeriod.endDate;
  }

  const window = payPeriodJobsWhere(start, end);
  const jobs = await db.job.findMany({
    where: {
      AND: [window, { OR: [{ employeeId: actor.userId }, { cleaners: { some: { id: actor.userId } } }] }],
    },
    select: { ...JOB_PAY_SELECT, jobType: true, location: true, clientAddress: { select: { city: true } } },
  });

  const [rates, { labels }] = await Promise.all([
    getCleanerRateInputs(jobs.flatMap((j) => [j.employeeId, ...j.cleaners.map((c) => c.id)])),
    getServiceCatalogWithLabels(),
  ]);

  const lines: PayPeriodDetailResponse["jobs"] = [];
  for (const job of jobs) {
    const input = job as unknown as JobPayInput;
    const share = computeJobPayShares(input, rates).get(actor.userId);
    // Not a participant payroll pays (e.g. a cancelled assignment): no line.
    if (!share) continue;
    const date = jobEffectiveDate(input) ?? job.startTime;
    lines.push({
      jobId: job.id,
      date: date.toISOString(),
      area: jobArea(job),
      service: jobTypeLabel(job.jobType, labels) || "Cleaning",
      hours: hours2(share.hours),
      totalCents: toCents(share.total),
    });
  }
  lines.sort((a, b) => a.date.localeCompare(b.date) || a.jobId.localeCompare(b.jobId));

  return ok({ period, jobs: lines });
}
