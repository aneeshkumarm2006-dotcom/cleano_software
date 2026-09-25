"use server";

import { db } from "@/lib/org-db";
import { requireOwnerAdmin } from "@/lib/action-guards";
import {
  JOB_PAY_SELECT,
  computeJobPayShares,
  jobParticipantIds,
  type JobPayInput,
} from "@/lib/cleaner-earnings";
import { getCleanerRateInputs } from "@/lib/cleaner-rates";
import { payPeriodJobsWhere } from "@/lib/pay-period.server";

/**
 * One job inside one cleaner's payout, with the components kept apart.
 *
 * Sept 10, item 9: "admin should not have to open every job one by one just to
 * understand payroll totals."
 */
export interface PayoutJobRow {
  jobId: string;
  jobNumber: number;
  clientName: string;
  /** ISO. The money date, which is `jobDate` when the job has one. */
  date: string | null;
  serviceType: string;
  /** THIS cleaner's hours, not the job's. */
  hours: number;
  /** The work, before the customer's pass-throughs. */
  base: number;
  tip: number;
  parking: number;
  total: number;
  /** Which rule produced `base`: a tier split, an hourly settle, a manual total. */
  basisLabel: string;
}

export type PayoutBreakdownResult =
  | { success: true; rows: PayoutJobRow[]; total: number }
  | { success: false; error: string };

/**
 * Every job behind one payout row, computed the way payroll computed it.
 *
 * Deliberately RECOMPUTED rather than stored. `Payout` keeps only totals, and
 * adding four columns per job to carry a breakdown would be a second copy of
 * numbers that already have one source. The window comes from
 * `payPeriodJobsWhere` and the money from `computeJobPayShares` — the same two
 * functions the generator used — so the rows add up to the figure above them
 * by construction rather than by luck.
 *
 * A DRAFT period recomputes live, so an edit elsewhere shows here immediately.
 * A period that has been approved or paid was generated from these same
 * functions; where an admin has since hand-edited a payout, the stored total
 * wins on the row above and these lines explain the work, not the adjustment.
 */
export async function getPayoutJobBreakdown(
  payoutId: string
): Promise<PayoutBreakdownResult> {
  // Payroll is money and this is a whole team's earnings: owners and admins
  // only, and never trusting a client-supplied employee id — it is read from
  // the payout row itself.
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { success: false, error: "Not authorized" };

  if (typeof payoutId !== "string" || !payoutId || payoutId.length > 64) {
    return { success: false, error: "Payout not found" };
  }

  try {
    const payout = await db.payout.findUnique({
      where: { id: payoutId },
      select: {
        employeeId: true,
        payPeriod: { select: { startDate: true, endDate: true } },
      },
    });
    if (!payout?.payPeriod) return { success: false, error: "Payout not found" };

    const jobs = (await db.job.findMany({
      where: payPeriodJobsWhere(
        payout.payPeriod.startDate,
        payout.payPeriod.endDate
      ),
      select: { ...JOB_PAY_SELECT, jobNumber: true, clientName: true, jobType: true },
      orderBy: { jobDate: "asc" },
    })) as unknown as (JobPayInput & {
      jobNumber: number;
      clientName: string;
      jobType: string;
    })[];

    const rates = await getCleanerRateInputs(
      jobs.flatMap((j) => [j.employeeId, ...j.cleaners.map((c) => c.id)])
    );

    const rows: PayoutJobRow[] = [];
    let total = 0;

    for (const job of jobs) {
      if (jobParticipantIds(job, rates).length === 0) continue;
      const share = computeJobPayShares(job, rates).get(payout.employeeId);
      if (!share) continue;

      rows.push({
        jobId: job.id,
        jobNumber: job.jobNumber,
        clientName: job.clientName,
        date: (job.jobDate ?? job.startTime)?.toISOString() ?? null,
        serviceType: job.jobType,
        hours: Math.round(share.hours * 100) / 100,
        base: share.base,
        tip: share.tip,
        parking: share.parking,
        total: share.total,
        basisLabel: share.basisLabel,
      });
      total += share.total;
    }

    return { success: true, rows, total: Math.round(total * 100) / 100 };
  } catch (e) {
    console.error("[getPayoutJobBreakdown]", e);
    return { success: false, error: "Could not load the breakdown" };
  }
}
