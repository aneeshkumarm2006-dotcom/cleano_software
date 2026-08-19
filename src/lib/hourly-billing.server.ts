import "server-only";

// The write side of customer-side hourly billing (Stage 8, step 8.5).
//
// Two jobs, both idempotent:
//   snapshotBilledActualHours()  measure worked time → `Job.billedActualHours`
//   recomputeJobMoneyColumns()   re-derive subtotal/gst/qst/total from whatever
//                                the money columns now say
//
// Pure rules live in `./hourly-billing`; the arithmetic lives in
// `./job-money`. Nothing here re-implements either.

import { db } from "@/db";
import { billableActualHours, isHourlyBilled } from "./hourly-billing";
import {
  computeJobMoney,
  passThroughTotal,
  resolvePassThroughBilling,
} from "./job-money";
import { getTaxRates } from "./tax.server";

/** Every column the recompute reads. Kept beside the function that needs it. */
const MONEY_SELECT = {
  id: true,
  price: true,
  discountAmount: true,
  subtotalAmount: true,
  gstAmount: true,
  qstAmount: true,
  totalAmount: true,
  bookingSource: true,
  pricingMode: true,
  isCashJob: true,
  taxExempt: true,
  totalTip: true,
  parking: true,
  paymentReceived: true,
  stripePaymentIntentId: true,
  billingType: true,
  billedHourlyRate: true,
  billedEstimatedHours: true,
  billedActualHours: true,
  addOns: { select: { name: true, price: true, quantity: true } },
} as const;

export interface RecomputeResult {
  /** False when the job was skipped — not hourly, gone, or already settled. */
  changed: boolean;
  reason?: "NOT_FOUND" | "NOT_HOURLY" | "SETTLED" | "NO_HOURS" | "UNCHANGED";
  billedActualHours?: number;
  subtotalAmount?: number;
  totalAmount?: number;
}

/**
 * Re-derive `subtotalAmount` / `gstAmount` / `qstAmount` / `totalAmount` — and
 * `price`, which mirrors the hourly service line — from the job's current
 * money columns.
 *
 * `Job.price` is kept equal to the derived hourly amount ON PURPOSE. Roughly
 * fifteen reporting queries (analytics, exports, the dashboard, the invoice
 * builder) call `activeSubtotal` with a `select` that predates Stage 8 and
 * therefore has no hourly columns; `computeJobMoney` falls back to `price` for
 * those, so keeping the mirror in sync is what makes every one of them print
 * the right figure without being individually rewritten. `computeJobMoney` is
 * still the authority — the column is downstream of it, never the other way.
 *
 * Under FINAL_PRICE this is a no-op by construction: that branch reads the
 * stored subtotal straight back, so an admin's override survives untouched.
 * Which is the PDF's "unless admin manually overrides the price".
 */
async function recomputeMoneyFor(
  job: {
    id: string;
    totalAmount: number | null;
    paymentReceived: boolean;
    stripePaymentIntentId: string | null;
  } & Parameters<typeof computeJobMoney>[0] & {
      totalTip: number | null;
      parking: number | null;
    }
): Promise<{ subtotalAmount: number; totalAmount: number }> {
  const money = computeJobMoney(job, await getTaxRates());
  // D3 — tips and parking ride on the card when it hasn't been taken yet, and
  // are flagged for separate collection when it has. Same helper both save
  // paths use, so a recompute can't re-open a balance a save would not have.
  const billing = resolvePassThroughBilling({
    taxedTotal: money.totalAmount,
    passThrough: passThroughTotal(job),
    settled: job.paymentReceived || job.stripePaymentIntentId != null,
    storedTotal: job.totalAmount,
  });

  // The mirror is written ONLY when the hourly line is the active service line.
  //
  // Two exclusions, both load-bearing:
  //   * no hourly line at all → this is a flat job, and its admin-typed price
  //     is none of this function's business;
  //   * FINAL_PRICE → `price` is the admin's override total, not a base line.
  //     Writing rate × hours over it would destroy the override AND make the
  //     next save's `priceRetyped` check re-author it to the derived figure —
  //     i.e. a clock-out would silently undo a manual price. `computeJobMoney`
  //     already ignores the hourly line in that mode; this keeps the column
  //     agreeing with it.
  const writesMirror =
    money.hourlyServiceAmount !== null && money.pricingMode !== "FINAL_PRICE";

  await db.job.update({
    where: { id: job.id },
    data: {
      ...(writesMirror ? { price: money.hourlyServiceAmount as number } : {}),
      subtotalAmount: money.subtotalAmount,
      gstAmount: money.gstAmount,
      qstAmount: money.qstAmount,
      totalAmount: billing.totalAmount,
    },
  });

  return { subtotalAmount: money.subtotalAmount, totalAmount: billing.totalAmount };
}

/**
 * Measure this job's worked time and stamp it on `billedActualHours`, then
 * re-price the job from it.
 *
 * Called from the final clock-out and from every admin edit of the clock — i.e.
 * from every place the session rows change, because the sessions ARE the
 * measurement. An admin who types a different figure into the job modal
 * afterwards keeps it until more work is recorded against the job, at which
 * point the sessions win again: they are the record of what happened.
 *
 * Safe to call on ANY job. It returns immediately unless `billingType` is
 * HOURLY, so the four call sites need no condition of their own.
 *
 * ## What it will not do
 *
 *   * touch a job whose customer has already paid — re-pricing a settled job
 *     would open a balance nobody agreed to. The hours are still recorded, so
 *     the admin can see the discrepancy and act on it; the money is not moved.
 *   * write zero hours. "No sessions" means the work was never clocked, which
 *     is not the same as "this job took no time", and blanking a figure an
 *     admin typed on that basis would be wrong.
 */
export async function snapshotBilledActualHours(
  jobId: string
): Promise<RecomputeResult> {
  if (!jobId) return { changed: false, reason: "NOT_FOUND" };

  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      ...MONEY_SELECT,
      workSessions: {
        select: { cleanerId: true, startedAt: true, endedAt: true },
      },
      breaks: { select: { cleanerId: true, startedAt: true, endedAt: true } },
      clockInTime: true,
      clockOutTime: true,
    },
  });
  if (!job) return { changed: false, reason: "NOT_FOUND" };
  if (!isHourlyBilled(job)) return { changed: false, reason: "NOT_HOURLY" };

  // Legacy jobs have no session rows — their clock pair IS the one session, the
  // same fallback `sessionsForCleaner` applies everywhere else.
  //
  // It counts ONCE even on a two-person job, and deliberately: round 4's rule is
  // total CREW hours, but a single job-level pair carries no per-cleaner data to
  // expand into crew hours, and inventing "× crew size" from a column that was
  // never a per-cleaner record would bill a customer for hours nobody clocked.
  // The pair is one record of work, so it counts as one. Every job clocked since
  // JobWorkSession landed has real per-cleaner rows and gets the crew sum.
  const sessions =
    job.workSessions.length > 0
      ? job.workSessions
      : job.clockInTime
        ? [{ cleanerId: null, startedAt: job.clockInTime, endedAt: job.clockOutTime }]
        : [];

  const hours = billableActualHours(sessions, job.breaks);
  if (hours <= 0) return { changed: false, reason: "NO_HOURS" };

  const settled = job.paymentReceived || job.stripePaymentIntentId != null;
  if (settled) {
    // Record the measurement, move no money.
    if (job.billedActualHours !== hours) {
      await db.job.update({
        where: { id: job.id },
        data: { billedActualHours: hours },
      });
    }
    return { changed: true, reason: "SETTLED", billedActualHours: hours };
  }

  if (job.billedActualHours === hours) {
    return { changed: false, reason: "UNCHANGED", billedActualHours: hours };
  }

  await db.job.update({
    where: { id: job.id },
    data: { billedActualHours: hours },
  });
  const money = await recomputeMoneyFor({ ...job, billedActualHours: hours });

  return {
    changed: true,
    billedActualHours: hours,
    subtotalAmount: money.subtotalAmount,
    totalAmount: money.totalAmount,
  };
}

/**
 * Re-derive an hourly job's stored money columns without touching its hours.
 *
 * The escape hatch for anything that edits the rate or the hours OUTSIDE the
 * two save paths (which recompute inline). Same settled/FLAT guards.
 */
export async function recomputeHourlyJobMoney(
  jobId: string
): Promise<RecomputeResult> {
  if (!jobId) return { changed: false, reason: "NOT_FOUND" };
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: MONEY_SELECT,
  });
  if (!job) return { changed: false, reason: "NOT_FOUND" };
  if (!isHourlyBilled(job)) return { changed: false, reason: "NOT_HOURLY" };
  if (job.paymentReceived || job.stripePaymentIntentId != null) {
    return { changed: false, reason: "SETTLED" };
  }
  const money = await recomputeMoneyFor(job);
  return {
    changed: true,
    subtotalAmount: money.subtotalAmount,
    totalAmount: money.totalAmount,
  };
}
