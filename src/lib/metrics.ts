// Single source of truth for cross-page admin metrics. Before this, Dashboard,
// Analytics, Jobs, Clients, and Employees each computed "revenue" and
// "employee count" with different predicates, so the same date range showed
// different numbers per page. Every page must now use these helpers.
import "server-only";
import { db } from "@/db";
import type { Prisma } from "@prisma/client";

// ── Total Revenue ───────────────────────────────────────────────────────────
// Spec: completed AND paid jobs only; excludes taxes; applies discounts;
// subtracts refunds; includes paid cash jobs; excludes cancelled + unpaid.
// The revenue date basis is startTime (non-nullable, reliable) so a given date
// filter yields the same number everywhere.

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

// Per-job realized revenue: pre-tax price, less discount, less refunds.
export function jobRevenue(j: {
  price: number | null;
  discountAmount: number | null;
  refundedAmount: number | null;
}): number {
  return Math.max(
    0,
    (j.price ?? 0) - (j.discountAmount ?? 0) - (j.refundedAmount ?? 0)
  );
}

export async function getTotalRevenue(range?: DateRange): Promise<number> {
  const jobs = await db.job.findMany({
    where: revenueWhere(range),
    select: { price: true, discountAmount: true, refundedAmount: true },
  });
  return jobs.reduce((sum, j) => sum + jobRevenue(j), 0);
}

// ── Employee count ──────────────────────────────────────────────────────────
// Spec: one count across Dashboard, Analytics, Employees. Active cleaner /
// employee profiles only. Exclude clients (imported CLIENT-role logins),
// archived (soft-deleted) users. Inactive shown separately.

// Field staff — the people who actually clean or manage crews. Excludes CLIENT
// (imported customers) and the office OWNER/ADMIN (counted separately).
export const EMPLOYEE_ROLES = ["OPS_MANAGER", "FIELD_LEAD", "EMPLOYEE"] as const;

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
