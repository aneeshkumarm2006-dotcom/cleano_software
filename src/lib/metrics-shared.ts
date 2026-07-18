// Client-safe half of src/lib/metrics.ts.
//
// metrics.ts is `import "server-only"` because it talks to the DB. The PURE
// predicates below carry the same canonical definitions but have zero server
// imports, so a client component (e.g. the Jobs list stat cards, which must
// recompute revenue over the CLIENT-side filtered list) can apply the exact
// same rule the server uses. metrics.ts re-exports everything here, so server
// code keeps importing from "@/lib/metrics" and the two can never drift.

import { startOfDayTz } from "./time";

// ── Total Revenue ───────────────────────────────────────────────────────────
// Spec: completed AND paid jobs only; excludes taxes; applies discounts;
// subtracts refunds; includes paid cash jobs; excludes cancelled + unpaid.
export const REVENUE_STATUSES = ["COMPLETED", "PAID"] as const;

/** Fields any revenue predicate needs. Both Prisma rows and job DTOs satisfy it. */
export interface RevenueJobShape {
  deletedAt?: Date | string | null;
  status: string;
  paymentReceived: boolean;
  price: number | null;
  discountAmount?: number | null;
  refundedAmount?: number | null;
}

/**
 * Does this job count toward realized revenue? Mirrors `revenueWhere()` in
 * metrics.ts exactly: not archived, payment received, completed/paid.
 */
export function isRevenueJob(j: RevenueJobShape): boolean {
  if (j.deletedAt) return false;
  if (!j.paymentReceived) return false;
  return (REVENUE_STATUSES as readonly string[]).includes(j.status);
}

/** Per-job realized revenue: pre-tax price, less discount, less refunds. */
export function jobRevenue(j: {
  price: number | null;
  discountAmount?: number | null;
  refundedAmount?: number | null;
}): number {
  return Math.max(
    0,
    (j.price ?? 0) - (j.discountAmount ?? 0) - (j.refundedAmount ?? 0)
  );
}

/** Sum of realized revenue over a list, applying the canonical predicate. */
export function totalRevenueOf(jobs: RevenueJobShape[]): number {
  return jobs.reduce((sum, j) => (isRevenueJob(j) ? sum + jobRevenue(j) : sum), 0);
}

// ── Scheduled (booked, not yet realized) value ───────────────────────────────
// Deliberately NOT revenue: work that is on the books but not completed+paid.
// Surfaced as its own stat so a pipeline of priced-but-unpaid jobs doesn't make
// the page look like it's showing $0.00 "revenue".

/** Booked but not yet realized: live job, not cancelled, not already revenue. */
export function isScheduledValueJob(j: RevenueJobShape): boolean {
  if (j.deletedAt) return false;
  if (j.status === "CANCELLED") return false;
  return !isRevenueJob(j);
}

/** Per-job booked value: price less discount (no refunds — nothing paid yet). */
export function jobScheduledValue(j: {
  price: number | null;
  discountAmount?: number | null;
}): number {
  return Math.max(0, (j.price ?? 0) - (j.discountAmount ?? 0));
}

/** Sum of booked-but-unrealized value over a list. */
export function totalScheduledValueOf(jobs: RevenueJobShape[]): number {
  return jobs.reduce(
    (sum, j) => (isScheduledValueJob(j) ? sum + jobScheduledValue(j) : sum),
    0
  );
}

// ── Employee count ──────────────────────────────────────────────────────────
// Field staff — the people who actually clean or manage crews. Excludes CLIENT
// (imported customers) and the office OWNER/ADMIN (counted separately).
export const EMPLOYEE_ROLES = ["OPS_MANAGER", "FIELD_LEAD", "EMPLOYEE"] as const;

// ── Simplified operational status ───────────────────────────────────────────
// The three main operational statuses per spec: Scheduled (job date still
// ahead), Completed (date passed, payment not received), Paid (payment
// received). Derived, not stored — so a job whose date passed overnight reads
// "Completed" immediately even before the daily sweep updates the DB row, and
// "Paid" can never diverge between the status enum and the paymentReceived
// boolean. IN_PROGRESS (cleaner on site) and CANCELLED pass through untouched.
export type SimpleJobStatus =
  | "SCHEDULED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "PAID"
  | "CANCELLED";

export function simpleJobStatus(
  j: {
    status: string;
    paymentReceived?: boolean | null;
    startTime?: Date | string | null;
  },
  now: Date = new Date()
): SimpleJobStatus {
  if (j.status === "CANCELLED") return "CANCELLED";
  if (j.paymentReceived || j.status === "PAID") return "PAID";
  if (j.status === "IN_PROGRESS") return "IN_PROGRESS";
  if (j.status === "COMPLETED") return "COMPLETED";
  // CREATED / SCHEDULED: the job date has passed (previous business day or
  // earlier) → Completed. Same-day jobs stay Scheduled until clock-out.
  if (j.startTime && new Date(j.startTime) < startOfDayTz(now)) {
    return "COMPLETED";
  }
  return "SCHEDULED";
}
