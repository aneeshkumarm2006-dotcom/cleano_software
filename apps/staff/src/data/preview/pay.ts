// Sample pay data for development builds, held in memory so a withdrawal
// really comes off the balance and shows up in the list. Never bundled into a
// release (see ./jobs.ts).
import { ApiError } from "@bookmops/api/client";
import type {
  JobPayResponse,
  PayPeriodDetailResponse,
  PayPeriodSummary,
  PayResponse,
  Withdrawal,
  WithdrawalResponse,
} from "@bookmops/api/v1";

import type { DataSource } from "../source";
import { delay } from "./delay";

const FEE_BPS = 500;
const MINIMUM_CENTS = 1000;

/** A date `days` from today as "YYYY-MM-DD". */
function day(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
/** An instant `days` from now. */
function instant(days: number, hour = 12): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

/** Monday of this week, as an offset in days from today. */
const monday = -((new Date().getDay() + 6) % 7);

function period(
  id: string,
  weeksAgo: number,
  status: PayPeriodSummary["status"],
  finalCents: number,
  jobCount: number,
  hours: number,
  extra: Partial<PayPeriodSummary> = {},
): PayPeriodSummary {
  const start = monday - weeksAgo * 7;
  return {
    id,
    startDate: day(start),
    endDate: day(start + 6),
    status,
    isLive: false,
    baseCents: finalCents,
    adjustmentsCents: 0,
    deductionsCents: 0,
    reimbursementsCents: 0,
    finalCents,
    jobCount,
    hours,
    paidAt: status === "PAID" ? instant(start + 9) : null,
    ...extra,
  };
}

const CURRENT: PayPeriodSummary = {
  ...period("current", 0, "OPEN", 50450, 7, 20.5),
  isLive: true,
};

const PAYOUTS: PayPeriodSummary[] = [
  period("po-4", 1, "APPROVED", 12000, 2, 4),
  period("po-3", 2, "PAID", 67200, 9, 26, {
    baseCents: 65200,
    adjustmentsCents: 2500,
    deductionsCents: 1500,
    reimbursementsCents: 1000,
  }),
  period("po-2", 3, "PAID", 59400, 8, 24.5),
  period("po-1", 4, "PAID", 61850, 8, 25),
];

/** What the PAID payouts put in the wallet. */
const paidCents = PAYOUTS.filter((p) => p.status === "PAID").reduce((s, p) => s + p.finalCents, 0);

const withdrawals: Withdrawal[] = [
  {
    id: "w-2",
    amountCents: 60000,
    feeCents: 3000,
    netCents: 57000,
    status: "COMPLETED",
    requestedAt: instant(monday - 8, 16),
    processedAt: instant(monday - 8, 18),
    note: null,
  },
  {
    id: "w-1",
    amountCents: 90000,
    feeCents: 4500,
    netCents: 85500,
    status: "COMPLETED",
    requestedAt: instant(monday - 15, 10),
    processedAt: instant(monday - 15, 13),
    note: "Rent week, thank you!",
  },
];
const replays = new Map<string, WithdrawalResponse>();

/** Paid in, minus every withdrawal the office hasn't declined. The server's own formula. */
function available(): number {
  const reserved = withdrawals.filter((w) => w.status !== "REJECTED").reduce((s, w) => s + w.amountCents, 0);
  return Math.max(0, paidCents - reserved);
}

function summary(): PayResponse {
  return {
    balance: { availableCents: available(), pendingCents: 12000 + 50450, unprocessedCents: 50450 },
    currentPeriod: CURRENT,
    yearToDate: { year: new Date().getFullYear(), earnedCents: 1824000, paidCents: 1761550, jobsCompleted: 241, hours: 612.5 },
    rating: { average: 4.8, count: 186 },
    withdrawal: { feeBasisPoints: FEE_BPS, minimumCents: MINIMUM_CENTS, timing: "Sent within 0–3 hours, during working hours." },
  };
}

const AREAS = ["Le Plateau", "Westmount", "Mile End", "Rosemont", "Verdun", "Outremont"];
const SERVICES = ["Standard clean", "Deep clean", "Move-out clean"];

function periodJobs(p: PayPeriodSummary): PayPeriodDetailResponse["jobs"] {
  if (p.jobCount === 0) return [];
  // Split the period's base across its jobs so the lines add up, as they do for real.
  const each = Math.floor(p.baseCents / p.jobCount);
  const startOffset = Math.round((new Date(p.startDate).getTime() - Date.now()) / 86_400_000);
  return Array.from({ length: p.jobCount }, (_, n) => ({
    jobId: `${p.id}-j${n + 1}`,
    date: instant(startOffset + (n % 6), 9 + (n % 3) * 3),
    area: AREAS[n % AREAS.length],
    service: SERVICES[n % SERVICES.length],
    hours: Math.round((p.hours / p.jobCount) * 10) / 10,
    totalCents: n === 0 ? p.baseCents - each * (p.jobCount - 1) : each,
  }));
}

function findPeriod(id: string): PayPeriodSummary {
  const p = id === "current" ? CURRENT : PAYOUTS.find((x) => x.id === id);
  if (!p) throw new ApiError("We couldn't find that pay period.", 404, "NOT_FOUND", false);
  return p;
}

export const previewPayApi = {
  pay: () => delay(summary()),
  payouts: () => delay({ items: PAYOUTS, nextCursor: null }),
  withdrawals: () => delay({ items: [...withdrawals], nextCursor: null }),
  payPeriod: async (id) => {
    await delay(null, 300);
    const p = findPeriod(id);
    return { period: p, jobs: periodJobs(p) };
  },
  jobPay: async (jobId) => {
    await delay(null, 300);
    const [periodId] = jobId.split("-j");
    const line = periodJobs(findPeriod(periodId)).find((j) => j.jobId === jobId);
    if (!line) throw new ApiError("We couldn't find that job.", 404, "NOT_FOUND", false);
    const tip = line.totalCents > 8000 ? 1000 : 0;
    const res: JobPayResponse = {
      jobId,
      date: line.date,
      area: line.area,
      service: line.service,
      basis: "PERCENTAGE",
      basisLabel: "Percentage — your rate on the job's price",
      hourlyRateCents: null,
      workCents: line.totalCents - tip,
      tipCents: tip,
      parkingCents: 0,
      totalCents: line.totalCents,
      ratingBoost: { state: "APPLIED", multiplier: 1.05, ratingsSoFar: null, ratingsRequired: null, reason: null },
    };
    return res;
  },
  requestWithdrawal: async (body) => {
    await delay(null, 800);
    const replay = replays.get(body.clientEventId);
    if (replay) return replay;
    if (body.amountCents < MINIMUM_CENTS) {
      throw new ApiError("The smallest withdrawal is $10.00.", 400, "AMOUNT_TOO_SMALL", false);
    }
    const balance = available();
    if (body.amountCents > balance) {
      throw new ApiError(`That's more than your available balance ($${(balance / 100).toFixed(2)}).`, 409, "INSUFFICIENT_BALANCE", false);
    }
    const feeCents = Math.round((body.amountCents * FEE_BPS) / 10_000);
    const withdrawal: Withdrawal = {
      id: `w-${withdrawals.length + 1}`,
      amountCents: body.amountCents,
      feeCents,
      netCents: body.amountCents - feeCents,
      status: "PENDING",
      requestedAt: new Date().toISOString(),
      processedAt: null,
      note: body.note ?? null,
    };
    withdrawals.unshift(withdrawal);
    const res = { withdrawal, availableCents: available() };
    replays.set(body.clientEventId, res);
    return res;
  },
} satisfies Pick<DataSource, "pay" | "payouts" | "withdrawals" | "payPeriod" | "jobPay" | "requestWithdrawal">;
