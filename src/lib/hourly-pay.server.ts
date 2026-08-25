import "server-only";

// The write side of CLEANER hourly pay (AWER round 4, fix 5).
//
// Deliberate sibling of `./hourly-billing.server.ts`, and deliberately NOT the
// same file. Decision D6 keeps the two hourly numbers apart everywhere else in
// the codebase, and this is the pair that most needs it:
//
//   hourly-billing.server.ts   `billedHourlyRate` × hours → what the CUSTOMER pays
//   hourly-pay.server.ts       `hourlyRate`       × hours → what the CLEANER earns
//
// Both are called from the same two places (final clock-out and every admin edit
// of the clock) because both are measurements of the same sessions. They read
// the same per-cleaner minute map (`crewActiveMinutesByCleaner`), so a job can
// never bill six crew hours while paying for three.
//
// The pure rules live in `./cleaner-earnings`; nothing here re-implements them.

import { db } from "@/lib/org-db";
import { getCleanerRateInputs } from "./cleaner-rates";
import {
  JOB_PAY_SELECT,
  computeJobPayShares,
  hourlyClockedHours,
  jobParticipantIds,
  type JobPayInput,
} from "./cleaner-earnings";

/**
 * Pay-period statuses that FREEZE a payout (round-2 decision, restated in the
 * round-4 TODO step 4B.4): an edit landing inside one of these must not rewrite
 * the recorded payout behind the admin's back — they are told instead, and
 * adjust the period deliberately.
 *
 * Exported so `updateClockTimes` warns on exactly the set this refuses to write
 * under, rather than keeping a second copy of the list.
 */
export const LOCKED_PAY_PERIOD_STATUSES = [
  "PENDING_APPROVAL",
  "APPROVED",
  "PAID",
] as const;

export interface HourlyPayResult {
  /** False when the job was skipped — every reason below says which. */
  changed: boolean;
  reason?:
    | "NOT_FOUND"
    | "ARCHIVED"
    | "NOT_HOURLY"
    | "MANUAL"
    | "NO_CLOCK"
    | "PAYROLL_LOCKED"
    | "UNCHANGED";
  /** The team total that was (or would have been) written. */
  employeePay?: number;
  /** Total crew hours behind it, for the caller's log line. */
  hours?: number;
  /** Set with PAYROLL_LOCKED, so the caller can name the period's state. */
  payPeriodStatus?: string;
}

/**
 * Recompute an HOURLY job's `employeePay` from the clock and store it.
 *
 * `Job.employeePay` is the crew's TEAM TOTAL, and on an hourly job it used to be
 * frozen at save time from the SCHEDULED window — `hourlyRate × (endTime −
 * startTime)`, computed once and never revisited, so a crew that stayed two
 * hours late was paid for hours nobody worked. This makes the clock the record:
 * the column becomes Σ of what `computeJobPayShares` actually hands each cleaner
 * (their own sessions × the rate, or their manual override), so the stored figure
 * the jobs list, invoices and the labour-cost metric read agrees to the cent with
 * what payroll pays.
 *
 * Safe to call on ANY job — every guard is inside, so the call sites need no
 * condition of their own.
 *
 * ## What it will not do
 *
 *   * touch a job whose `employeePayIsManual` is set. That flag means an admin
 *     (or the BookingKoala CSV) stated the crew's pay outright, and D2 says a
 *     stated figure is an order, not a suggestion.
 *   * touch a job whose date sits in a pay period that is already pending
 *     approval, approved or paid. The Payout rows for such a period are frozen;
 *     silently moving the job's figure underneath them would make the payroll
 *     an admin approved stop matching the jobs it was built from.
 *   * write anything when the job has no work sessions. Nothing was clocked, so
 *     the save-time estimate is still the best answer and stays.
 */
export async function snapshotHourlyEmployeePay(
  jobId: string
): Promise<HourlyPayResult> {
  if (!jobId) return { changed: false, reason: "NOT_FOUND" };

  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { ...JOB_PAY_SELECT, deletedAt: true },
  });
  if (!job) return { changed: false, reason: "NOT_FOUND" };
  if (job.deletedAt) return { changed: false, reason: "ARCHIVED" };

  const input = job as unknown as JobPayInput;
  if ((input.payType ?? "PERCENTAGE") !== "HOURLY") {
    return { changed: false, reason: "NOT_HOURLY" };
  }
  if (input.employeePayIsManual === true) {
    return { changed: false, reason: "MANUAL" };
  }

  const rates = await getCleanerRateInputs([
    job.employeeId,
    ...job.cleaners.map((c) => c.id),
  ]);
  const participantIds = jobParticipantIds(input, rates);
  if (participantIds.length === 0) return { changed: false, reason: "NO_CLOCK" };

  // The same call `computeJobPayShares` makes. Null ⇒ nothing clocked (or no
  // rate to multiply by), so there is no measurement to store.
  const clock = hourlyClockedHours(input, participantIds);
  if (!clock) return { changed: false, reason: "NO_CLOCK" };

  const jobDay = job.jobDate ?? job.startTime;
  const locked = jobDay
    ? await db.payPeriod.findFirst({
        where: {
          status: { in: [...LOCKED_PAY_PERIOD_STATUSES] },
          startDate: { lte: jobDay },
          endDate: { gte: jobDay },
        },
        select: { status: true },
      })
    : null;
  if (locked) {
    return {
      changed: false,
      reason: "PAYROLL_LOCKED",
      payPeriodStatus: locked.status,
    };
  }

  // Summed from the SHARES rather than from `clock` alone, so a per-cleaner
  // manual override (JobAssignment.payAmount) is inside the stored team total
  // exactly as it is inside the payout. Re-reading `employeePay` afterwards can
  // never disagree with what the crew is paid.
  const shares = computeJobPayShares(input, rates);
  let total = 0;
  let hours = 0;
  let overrides = 0;
  for (const share of shares.values()) {
    total += share.base;
    hours += share.hours;
    if (share.basis === "MANUAL_CLEANER") overrides += 1;
  }
  const employeePay = Math.round(total * 100) / 100;
  const crewHours = Math.round(hours * 100) / 100;

  const previous = job.employeePay;
  if (previous !== null && Math.abs(previous - employeePay) < 0.005) {
    return { changed: false, reason: "UNCHANGED", employeePay, hours: crewHours };
  }

  await db.job.update({
    where: { id: jobId },
    data: { employeePay },
  });
  // Money moved without an admin touching anything, so it belongs in the job's
  // Activity tab beside the clock entry that caused it.
  await db.jobLog
    .create({
      data: {
        jobId,
        userId: null,
        action: "UPDATED",
        field: "employeePay",
        oldValue: previous === null ? null : previous.toFixed(2),
        newValue: employeePay.toFixed(2),
        description:
          `Cleaner pay recalculated from the clock: ${crewHours}h across the crew ` +
          `at $${clock.rate.toFixed(2)}/h → $${employeePay.toFixed(2)}` +
          (overrides > 0
            ? `, including ${overrides} manual per-cleaner amount${overrides === 1 ? "" : "s"}.`
            : "."),
      },
    })
    .catch((e) => console.error("hourly-pay log", e));

  return { changed: true, employeePay, hours: crewHours };
}
