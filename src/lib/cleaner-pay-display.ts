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
 * Cleaner-facing screens must NEVER print the raw `Job.employeePay` column
 * directly: it means two different things (a save-time estimate, or an
 * authoritative manual team total — see `Job.employeePayIsManual`), and reading
 * it raw showed a $112 job as $29.65 instead of the $44.80 the crew is paid.
 * `cleanerJobPay()` resolves which meaning applies and divides it correctly, so
 * payroll, My Pay, the pay modal and these display surfaces (My Jobs list, Job
 * Detail, Home earnings) all quote one number.
 *
 * Returns a Map<jobId, payout> — this cleaner's TOTAL for the job: the work, at
 * their tier rate on the job's active value (base + add-ons, or the override
 * total), plus their even share of the customer-funded tip and parking.
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
