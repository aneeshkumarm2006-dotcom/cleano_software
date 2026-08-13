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
import { db } from "@/db";
import type { Prisma } from "@prisma/client";
import {
  jobRevenue,
  jobScheduledValue,
  EMPLOYEE_ROLES,
  REVENUE_STATUSES,
} from "./metrics-shared";

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
    select: { price: true, discountAmount: true, refundedAmount: true },
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
    select: { price: true, discountAmount: true },
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
      return {
        deletedAt: null,
        status: { in: ["CREATED", "SCHEDULED", "IN_PROGRESS"] },
        startTime: { gte: now },
      };
    case "completed":
      return { deletedAt: null, status: { in: ["COMPLETED", "PAID"] } };
    case "cancelled":
      return { deletedAt: null, status: "CANCELLED" };
    case "overdue":
      return {
        deletedAt: null,
        status: "COMPLETED",
        paymentReceived: false,
      };
    case "free":
      return { deletedAt: null, OR: [{ price: null }, { price: 0 }] };
  }
}
