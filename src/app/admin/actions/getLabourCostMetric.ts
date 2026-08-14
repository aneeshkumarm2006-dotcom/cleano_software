"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { isAdminRole } from "@/lib/role-routing";
import { JOB_TYPE_VALUES } from "@/lib/job-types";
import { ACTIVE_VALUE_SELECT } from "@/lib/metrics";
import { activeSubtotal } from "@/lib/job-money";
import type { Prisma } from "@prisma/client";

export interface LabourFilters {
  /** ISO date (inclusive). */
  dateFrom?: string | null;
  dateTo?: string | null;
  serviceType?: string | null;
  cleanerId?: string | null;
  area?: string | null;
}

export interface LabourMetric {
  labourPercentage: number | null;
  totals: {
    serviceRevenue: number;
    labourCost: number;
    taxAmount: number;
    tipAmount: number;
    transportation: number;
    discountAmount: number;
    refundAmount: number;
    jobCount: number;
  };
  options: {
    cleaners: { id: string; name: string }[];
    serviceTypes: string[];
  };
}

/**
 * Labour cost as a % of collected service revenue, over completed/paid jobs.
 *
 * Definitions (consistent with the finance model):
 *   serviceRevenue = subtotal (pre-tax, post-discount) − refunds; tips, taxes
 *                    and transportation are tracked but excluded from revenue.
 *   labourCost     = cleaner payout (employeePay).
 *   labourPercentage = labourCost / serviceRevenue × 100.
 *
 * `tipAmount` and `transportation` are already outside both terms, so decision
 * D3 (tips and parking are customer-funded pass-throughs, never company revenue
 * and never a company expense) changes no arithmetic here — the tiles simply
 * name them as pass-throughs now rather than as company costs.
 */
export async function getLabourCostMetric(
  filters: LabourFilters = {}
): Promise<{ success: false; error: string } | ({ success: true } & LabourMetric)> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { success: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (!isAdminRole(role)) return { success: false, error: "Not authorized" };

  const where: Prisma.JobWhereInput = {
    // Archived jobs are out of the active reporting set (new fix list item 1)
    // — the same rule the dashboard, analytics and revenue metrics follow.
    deletedAt: null,
    status: { in: ["COMPLETED", "PAID"] },
  };

  // Date range on jobDate, falling back to startTime for older rows.
  const from = filters.dateFrom ? new Date(filters.dateFrom) : null;
  const to = filters.dateTo ? new Date(`${filters.dateTo}T23:59:59.999`) : null;
  if (from || to) {
    const range: Prisma.DateTimeFilter = {};
    if (from) range.gte = from;
    if (to) range.lte = to;
    where.OR = [{ jobDate: range }, { AND: [{ jobDate: null }, { startTime: range }] }];
  }
  if (filters.serviceType) where.jobType = filters.serviceType;
  if (filters.area) where.location = { contains: filters.area, mode: "insensitive" };
  if (filters.cleanerId) {
    where.AND = [
      ...((where.AND as Prisma.JobWhereInput[]) ?? []),
      {
        OR: [
          { employeeId: filters.cleanerId },
          { cleaners: { some: { id: filters.cleanerId } } },
        ],
      },
    ];
  }

  const [jobs, cleaners, serviceTypeRows] = await Promise.all([
    db.job.findMany({
      where,
      select: {
        // Fix 3 item 3.7 — the labour-% denominator has to be the SAME basis
        // the revenue tiles use, or the percentage compares a cost against a
        // revenue figure nothing else on the site quotes. `ACTIVE_VALUE_SELECT`
        // is that basis's column list.
        ...ACTIVE_VALUE_SELECT,
        employeePay: true,
        gstAmount: true,
        qstAmount: true,
        tipAmount: true,
        totalTip: true,
        parking: true,
        refundedAmount: true,
      },
    }),
    db.user.findMany({
      where: { role: { in: ["EMPLOYEE", "FIELD_LEAD", "OPS_MANAGER"] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.job.findMany({
      // The filter list is built from live jobs only (item 1).
      where: { jobType: { not: null }, deletedAt: null },
      select: { jobType: true },
      distinct: ["jobType"],
    }),
  ]);

  // Always offer the canonical service types so the filter is usable even with
  // no jobs yet, plus any custom/legacy types actually present in the data.
  const serviceTypes = Array.from(
    new Set([
      ...JOB_TYPE_VALUES,
      ...serviceTypeRows.map((r) => r.jobType).filter((t): t is string => !!t),
    ])
  );

  const totals = jobs.reduce(
    (acc, j) => {
      // `subtotalAmount > 0 ? subtotalAmount : price` was a fallback chain, not
      // a definition: only 7 of 472 live rows carry a stored subtotal, so in
      // practice this read the bare base price and every add-on was missing
      // from the denominator. `activeSubtotal` answers the same question
      // properly — stored override total, or base + add-ons.
      const gross = activeSubtotal(j);
      const refund = j.refundedAmount ?? 0;
      acc.serviceRevenue += Math.max(0, gross - refund);
      acc.labourCost += j.employeePay ?? 0;
      acc.taxAmount += (j.gstAmount ?? 0) + (j.qstAmount ?? 0);
      acc.tipAmount += j.tipAmount || j.totalTip || 0;
      acc.transportation += j.parking ?? 0;
      acc.discountAmount += j.discountAmount ?? 0;
      acc.refundAmount += refund;
      acc.jobCount += 1;
      return acc;
    },
    {
      serviceRevenue: 0,
      labourCost: 0,
      taxAmount: 0,
      tipAmount: 0,
      transportation: 0,
      discountAmount: 0,
      refundAmount: 0,
      jobCount: 0,
    }
  );

  const labourPercentage =
    totals.serviceRevenue > 0
      ? Math.round((totals.labourCost / totals.serviceRevenue) * 1000) / 10
      : null;

  return {
    success: true,
    labourPercentage,
    totals,
    options: {
      cleaners,
      serviceTypes,
    },
  };
}
