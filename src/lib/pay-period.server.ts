// Pay-period generation core, shared by the admin action (createPayPeriod) and
// the Monday cron that auto-advances payroll. Kept OUT of the "use server"
// action file on purpose: every export in a "use server" module is a callable
// server action, and this function performs no auth of its own — the caller is
// responsible for that (the action gates on ADMIN/OWNER; the cron gates on
// CRON_SECRET).
import "server-only";
import { db } from "@/lib/org-db";
import { getCleanerRateInputs } from "@/lib/cleaner-rates";
import { getFieldLeadWeeklyBonus } from "@/lib/field-lead-bonus.server";
import { formatPayPeriodRange, type PayPeriodRange } from "@/lib/pay-period";
import { computePayoutTotals } from "@/lib/payout-math";
import {
  JOB_PAY_SELECT,
  PAYABLE_JOB_STATUSES,
  computeJobPayShares,
  jobParticipantIds,
  type JobPayInput,
} from "@/lib/cleaner-earnings";

export type GeneratePayPeriodResult =
  | { success: true; payPeriodId: string; periodLabel: string }
  | { success: false; error: string; alreadyExists?: boolean };

/**
 * Build the DRAFT pay period (and its payouts) for one Mon–Sun week.
 *
 * Idempotent: an existing non-CANCELLED period for the week is left alone and
 * reported via `alreadyExists`, so a cron re-run never double-pays a job.
 */
export async function generatePayPeriodForWeek(
  week: PayPeriodRange,
  notes: string | null = null
): Promise<GeneratePayPeriodResult> {
  const startDate = week.start;
  const rangeEnd = week.end;

  // Fail closed on overlap: one live period per week. CANCELLED doesn't block.
  const overlapping = await db.payPeriod.findFirst({
    where: {
      status: { not: "CANCELLED" },
      startDate: { lte: rangeEnd },
      endDate: { gte: startDate },
    },
    select: { id: true, status: true },
  });
  if (overlapping) {
    return {
      success: false,
      alreadyExists: true,
      error: `A pay period already exists for ${formatPayPeriodRange(
        week
      )} (${overlapping.status.toLowerCase()}).`,
    };
  }

  const employees = await db.user.findMany({
    where: { role: { in: ["EMPLOYEE", "ADMIN", "OWNER"] } },
    select: { id: true },
  });

  const jobs = await db.job.findMany({
    where: {
      deletedAt: null,
      status: { in: [...PAYABLE_JOB_STATUSES] },
      OR: [
        { jobDate: { gte: startDate, lte: rangeEnd } },
        {
          AND: [
            { jobDate: null },
            { startTime: { gte: startDate, lte: rangeEnd } },
          ],
        },
      ],
    },
    select: JOB_PAY_SELECT,
  });

  const rateInputs = await getCleanerRateInputs(
    jobs.flatMap((j) => [j.employeeId, ...j.cleaners.map((c) => c.id)])
  );

  const payoutMap = new Map<
    string,
    { base: number; jobCount: number; hours: number }
  >();
  for (const emp of employees) {
    payoutMap.set(emp.id, { base: 0, jobCount: 0, hours: 0 });
  }

  for (const job of jobs) {
    const input = job as unknown as JobPayInput;
    if (jobParticipantIds(input, rateInputs).length === 0) continue;
    // Same function My Pay uses, so a cleaner's "pending" equals their payout.
    const shares = computeJobPayShares(input, rateInputs);
    for (const [pid, share] of shares) {
      if (!payoutMap.has(pid)) {
        payoutMap.set(pid, { base: 0, jobCount: 0, hours: 0 });
      }
      const entry = payoutMap.get(pid)!;
      // `share.total` is base + tip + PARKING (Stage 4b.1/4b.4). Parking joined
      // tips inside the total rather than becoming a fourth Payout column on
      // purpose: `computePayoutTotals` and every statement, receipt and My Pay
      // surface already treat `baseAmount` as "what the work plus the customer's
      // pass-throughs came to", so tips set the precedent and parking follows it
      // without a schema change or a payout-math change.
      entry.base += share.total;
      entry.jobCount += 1;
      entry.hours += share.hours;
    }
  }

  // Field Lead weekly group-revenue bonus (2% / 3% by group avg rating).
  const fieldLeads = await db.user.findMany({
    where: { cleanerTier: "FIELD_LEAD" },
    select: { id: true },
  });
  for (const fl of fieldLeads) {
    const bonus = await getFieldLeadWeeklyBonus(fl.id, startDate, rangeEnd);
    if (bonus.bonusAmount <= 0) continue;
    if (!payoutMap.has(fl.id)) {
      payoutMap.set(fl.id, { base: 0, jobCount: 0, hours: 0 });
    }
    payoutMap.get(fl.id)!.base += bonus.bonusAmount;
  }

  const payPeriod = await db.payPeriod.create({
    data: {
      startDate,
      endDate: rangeEnd,
      notes,
      status: "DRAFT",
      payouts: {
        create: Array.from(payoutMap.entries())
          .filter(([, v]) => v.jobCount > 0 || v.base > 0)
          .map(([employeeId, v]) => {
            const baseAmount = Number(v.base.toFixed(2));
            // A freshly generated period has no adjustments/deductions yet, but
            // route it through the canonical helper anyway so a negative base
            // (e.g. a negative per-cleaner override) can never be written as a
            // negative payout. See src/lib/payout-math.ts.
            const { final } = computePayoutTotals({
              baseAmount,
              adjustments: 0,
              deductions: 0,
              reimbursements: 0,
            });
            return {
              employeeId,
              baseAmount,
              finalAmount: final,
              jobCount: v.jobCount,
              totalHours: Number(v.hours.toFixed(2)),
            };
          }),
      },
    },
  });

  return {
    success: true,
    payPeriodId: payPeriod.id,
    periodLabel: formatPayPeriodRange(week),
  };
}
