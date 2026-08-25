// Single source of truth for cross-page admin metrics. Before this, Dashboard,
// Analytics, Jobs, Clients, and Employees each computed "revenue" and
// "employee count" with different predicates, so the same date range showed
// different numbers per page. Every page must now use these helpers.
//
// The PURE predicates (jobRevenue, isRevenueJob, scheduled-value, EMPLOYEE_ROLES)
// live in ./metrics-shared so client components can apply the identical rule to
// a client-side filtered list. They are re-exported here — server code keeps
// importing from "@/lib/metrics" and the two definitions can never drift.
import "server-only";
import { db } from "@/lib/org-db";
import type { Prisma } from "@prisma/client";
import {
  jobRevenue,
  jobScheduledValue,
  COMPLETED_STATUSES,
  EMPLOYEE_ROLES,
  REVENUE_STATUSES,
} from "./metrics-shared";
import { INACTIVE_JOB_STATUSES, ON_HOLD_STATUS } from "./job-hold";

export * from "./metrics-shared";

// ── Total Revenue ───────────────────────────────────────────────────────────
// Spec: completed AND paid jobs only; excludes taxes; applies discounts;
// subtracts refunds; includes paid cash jobs; excludes cancelled + unpaid.
// The revenue date basis is startTime (non-nullable, reliable) so a given date
// filter yields the same number everywhere.
//
// KEEP IN LOCKSTEP with isRevenueJob() in ./metrics-shared — this is the SQL
// form of the same predicate.

export type DateRange = { from?: Date; to?: Date };

/**
 * The Job columns `jobRevenue` / `jobScheduledValue` read (fix 3).
 *
 * Spread into any `select` that feeds a revenue reducer:
 *
 *   select: { ...ACTIVE_VALUE_SELECT, id: true, startTime: true }
 *
 * `RevenueJobShape` requires every one of these, so forgetting the spread is a
 * type error rather than a dashboard silently reverting to the bare
 * `Job.price`. The `addOns` join is the only non-scalar in here and it is the
 * whole point of the fix — without it an add-on job under-reports by exactly
 * its add-ons.
 */
export const ACTIVE_VALUE_SELECT = {
  price: true,
  discountAmount: true,
  subtotalAmount: true,
  bookingSource: true,
  pricingMode: true,
  addOns: { select: { name: true, price: true, quantity: true } },
} satisfies Prisma.JobSelect;

export function revenueWhere(range?: DateRange): Prisma.JobWhereInput {
  const where: Prisma.JobWhereInput = {
    deletedAt: null,
    paymentReceived: true,
    status: { in: ["COMPLETED", "PAID"] },
  };
  if (range?.from || range?.to) {
    where.startTime = {
      ...(range.from ? { gte: range.from } : {}),
      ...(range.to ? { lt: range.to } : {}),
    };
  }
  return where;
}

export async function getTotalRevenue(range?: DateRange): Promise<number> {
  const jobs = await db.job.findMany({
    where: revenueWhere(range),
    select: { ...ACTIVE_VALUE_SELECT, refundedAmount: true },
  });
  return jobs.reduce((sum, j) => sum + jobRevenue(j), 0);
}

// ── Scheduled (booked, not yet realized) value ───────────────────────────────
// The SQL form of isScheduledValueJob() in ./metrics-shared, which the Jobs page
// applies client-side to its filtered list. KEEP THE TWO IN LOCKSTEP — the
// Dashboard and the Jobs page must never quote different booked-value numbers
// (client feedback item 10).
//
// Prisma's `NOT: { a, b }` negates the CONJUNCTION, so this reads exactly as the
// predicate does: live, not cancelled, and not already counted as revenue.

export function scheduledValueWhere(range?: DateRange): Prisma.JobWhereInput {
  const where: Prisma.JobWhereInput = {
    deletedAt: null,
    status: { not: "CANCELLED" },
    NOT: { paymentReceived: true, status: { in: [...REVENUE_STATUSES] } },
  };
  if (range?.from || range?.to) {
    where.startTime = {
      ...(range.from ? { gte: range.from } : {}),
      ...(range.to ? { lt: range.to } : {}),
    };
  }
  return where;
}

export async function getScheduledValue(range?: DateRange): Promise<number> {
  const jobs = await db.job.findMany({
    where: scheduledValueWhere(range),
    select: ACTIVE_VALUE_SELECT,
  });
  return jobs.reduce((sum, j) => sum + jobScheduledValue(j), 0);
}

// ── Completed job count ─────────────────────────────────────────────────────
// The Dashboard used to count `status: "COMPLETED"` while the Jobs page counted
// COMPLETED ∪ PAID, so the same data read 62 on one page and 84 on the other
// (client feedback item 27 — 62 was in fact the pending-payment count). Both now
// route through jobStatusWhere("completed").
export async function getCompletedJobCount(now: Date = new Date()): Promise<number> {
  return db.job.count({ where: jobStatusWhere("completed", now) });
}

// ── Active job count ────────────────────────────────────────────────────────
// Round 4, fixes 3 + 6. "Total Jobs" on the Dashboard was
// `db.job.count({ where: { deletedAt: null } })` — every row in the table,
// cancellations included — so a cancelled booking still counted as a job the
// business did, and the number could only ever go up. Analytics repeated the
// same thing in memory as `jobs.length`.
//
// A job is ACTIVE when it is neither cancelled (it did not happen) nor on hold
// (nobody has agreed it will). Both remain visible: the Dashboard prints their
// counts beside the total they were removed from, and each has its own bucket
// below — which is the PDF's "cancelled jobs should still be visible in records
// or as a separate stat" and "dashboard should separate on-hold".
//
// KEEP IN LOCKSTEP with `isActiveJob()` in ./metrics-shared — this is the SQL
// form of the same predicate, and Analytics applies the pure one to its
// filtered list.

export function activeJobsWhere(range?: DateRange): Prisma.JobWhereInput {
  const where: Prisma.JobWhereInput = {
    deletedAt: null,
    status: { notIn: [...INACTIVE_JOB_STATUSES] },
  };
  if (range?.from || range?.to) {
    where.startTime = {
      ...(range.from ? { gte: range.from } : {}),
      ...(range.to ? { lt: range.to } : {}),
    };
  }
  return where;
}

export async function getActiveJobCount(range?: DateRange): Promise<number> {
  return db.job.count({ where: activeJobsWhere(range) });
}

// ── Employee count ──────────────────────────────────────────────────────────
// Spec: one count across Dashboard, Analytics, Employees. Active cleaner /
// employee profiles only. Exclude clients (imported CLIENT-role logins),
// archived (soft-deleted) users. Inactive shown separately.
// (EMPLOYEE_ROLES is defined in ./metrics-shared and re-exported above.)

export function employeeWhere(activeOnly = true): Prisma.UserWhereInput {
  return {
    role: { in: [...EMPLOYEE_ROLES] },
    deletedAt: null,
    ...(activeOnly ? { isActive: true } : {}),
  };
}

export async function getEmployeeCounts(): Promise<{
  active: number;
  inactive: number;
}> {
  const base = { role: { in: [...EMPLOYEE_ROLES] }, deletedAt: null };
  const [active, inactive] = await Promise.all([
    db.user.count({ where: { ...base, isActive: true } }),
    db.user.count({ where: { ...base, isActive: false } }),
  ]);
  return { active, inactive };
}

// ── Product (inventory) count ───────────────────────────────────────────────
// Spec: Dashboard product/low-stock/inventory-value tiles must count the same
// records as the Inventory page's active view — soft-deleted products excluded.
export function productWhere(archived = false): Prisma.ProductWhereInput {
  return { deletedAt: archived ? { not: null } : null };
}

// ── Job status classification (canonical) ───────────────────────────────────
// Shared so the Jobs list tabs, Dashboard, and reports bucket jobs identically.
export type JobStatusBucket =
  | "upcoming"
  | "onhold"
  | "completed"
  | "cancelled"
  | "overdue"
  | "free";

export function jobStatusWhere(
  bucket: JobStatusBucket,
  now: Date
): Prisma.JobWhereInput {
  switch (bucket) {
    case "upcoming":
      // Round 4, fix 1 — the SQL twin of `isUpcomingJob`. This was an
      // allow-list of {CREATED, SCHEDULED, IN_PROGRESS}, which meant a future
      // job mis-stamped COMPLETED/PAID belonged to no bucket at all: the
      // completed guard below rightly refuses it and this refused it too, so
      // it vanished from the app entirely. Anything future that isn't
      // cancelled and wasn't genuinely worked is upcoming.
      //
      // Round 4, fix 6 — `not: CANCELLED` became `notIn: [CANCELLED, CREATED]`.
      // On-hold work is not scheduled work (PDF p5), so it leaves this bucket
      // for the `onhold` one below. Nothing is orphaned by that: every future
      // non-cancelled row is in exactly one of upcoming / onhold / completed,
      // which `verify-awer-fixes-4.ts` proves over the whole cross-product.
      return {
        deletedAt: null,
        startTime: { gte: now },
        status: { notIn: [...INACTIVE_JOB_STATUSES] },
        NOT: { status: { in: [...COMPLETED_STATUSES] }, clockOutTime: { not: null } },
      };
    case "onhold":
      // Round 4, fix 6 — the SQL twin of `isOnHoldJob`. No date test on
      // purpose: a hold is a statement about the agreement, not about the
      // calendar, so it survives its own date until an admin releases it.
      return { deletedAt: null, status: ON_HOLD_STATUS };
    case "completed":
      // Round 4, fix 1 — the SQL twin of `isCompletedJob`: stamped done AND
      // not still in the future. `NOT: { a, b }` negates the CONJUNCTION in
      // Prisma, so this reads exactly as `!isFutureJob` does — not future
      // UNLESS (starts later AND never clocked out).
      return {
        deletedAt: null,
        status: { in: [...COMPLETED_STATUSES] },
        NOT: { startTime: { gt: now }, clockOutTime: null },
      };
    case "cancelled":
      return { deletedAt: null, status: "CANCELLED" };
    case "overdue":
      // Overdue ⊂ completed, so it inherits the same date guard (round 4, fix
      // 1): unpaid work we have actually done. A job dated next week that was
      // mis-stamped COMPLETED is not overdue — nobody owes us for it yet.
      return {
        deletedAt: null,
        status: "COMPLETED",
        paymentReceived: false,
        NOT: { startTime: { gt: now }, clockOutTime: null },
      };
    case "free":
      return { deletedAt: null, OR: [{ price: null }, { price: 0 }] };
  }
}
