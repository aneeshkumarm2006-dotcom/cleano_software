import "server-only";
import { db } from "@/db";
import { getCleanerRateInputs } from "@/lib/cleaner-rates";
import {
  JOB_PAY_SELECT,
  cleanerJobPay,
  type JobPayInput,
} from "@/lib/cleaner-earnings";

/**
 * The one correct cleaner payout for a set of jobs, keyed by job id.
 *
 * Cleaner-facing screens must NEVER print the raw `Job.employeePay` column: for
 * BookingKoala imports that column holds the provider payment from the CSV (an
 * arbitrary number, ~26% of price), so a $112 job showed $29.65 instead of the
 * $44.80 the tier math (base price × rating rate) actually pays. Payroll, My
 * Pay and the pay modal already compute it correctly via cleanerJobPay(); this
 * gives the remaining display surfaces (My Jobs list, Job Detail, Home
 * earnings) the same number.
 *
 * Returns a Map<jobId, payout> — the tip-inclusive total this cleaner earns.
 */
export async function cleanerPayoutForJobs(
  jobIds: string[],
  cleanerId: string
): Promise<Map<string, number>> {
  const ids = Array.from(new Set(jobIds.filter(Boolean)));
  const out = new Map<string, number>();
  if (ids.length === 0) return out;

  const jobs = (await db.job.findMany({
    where: { id: { in: ids } },
    select: JOB_PAY_SELECT,
  })) as JobPayInput[];

  // Every participant on every job, so multi-cleaner splits are exact.
  const everyone = jobs.flatMap((j) => [
    j.employeeId,
    ...j.cleaners.map((c) => c.id),
  ]);
  const rates = await getCleanerRateInputs(everyone);

  for (const job of jobs) {
    out.set(job.id, cleanerJobPay(job, rates, cleanerId).total);
  }
  return out;
}
