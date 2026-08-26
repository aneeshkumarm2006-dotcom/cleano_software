"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import type { IncomeData } from "./getIncomeData.types";
import { getCleanerEarnings } from "@/lib/cleaner-earnings";
import { parseBusinessDate } from "@/lib/pay-period";

interface GetInput {
  employeeId?: string;
  year?: number;
  taxRate?: number;
}

const DEFAULT_TAX_RATE = 0.25;

const TAX_SETTING_KEY = "income.estimatedTaxRate";

/**
 * My Income figures.
 *
 * AUTHZ: a user may only read their own income; ADMIN/OWNER may read anyone's.
 *
 * All earnings come from getCleanerEarnings() — the SAME computation My Pay and
 * payroll use — so the two screens can no longer disagree (item 2/6).
 */
export async function getIncomeData(
  input: GetInput = {}
): Promise<
  { success: true; data: IncomeData } | { success: false; error: string }
> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return { success: false, error: "Not authenticated" };
    }

    const role = (session.user as { role?: string }).role;
    const isAdmin = role === "OWNER" || role === "ADMIN";
    const targetEmployeeId = input.employeeId || session.user.id;

    if (!isAdmin && targetEmployeeId !== session.user.id) {
      return { success: false, error: "Not authorized" };
    }

    const now = new Date();
    const currentYear = now.getFullYear();
    // Allow-list the year: an out-of-range value falls back to the current year.
    const year =
      typeof input.year === "number" &&
      Number.isInteger(input.year) &&
      input.year >= 2000 &&
      input.year <= currentYear + 1
        ? input.year
        : currentYear;

    let taxRate = DEFAULT_TAX_RATE;
    if (
      typeof input.taxRate === "number" &&
      input.taxRate >= 0 &&
      input.taxRate < 1
    ) {
      taxRate = input.taxRate;
    } else {
      const setting = await db.appSetting.findFirst({
        where: { key: TAX_SETTING_KEY },
      });
      if (
        typeof setting?.value === "number" &&
        setting.value >= 0 &&
        setting.value < 1
      ) {
        taxRate = setting.value;
      }
    }

    const earnings = await getCleanerEarnings(targetEmployeeId, year, now);

    // Withdrawals stay year-scoped by when they were processed.
    const yearStart =
      parseBusinessDate(`${year}-01-01`) ?? new Date(year, 0, 1);
    const yearEnd =
      parseBusinessDate(`${year + 1}-01-01`) ?? new Date(year + 1, 0, 1);
    const withdrawals = await db.withdrawal.findMany({
      where: {
        employeeId: targetEmployeeId,
        status: "COMPLETED",
        processedAt: { gte: yearStart, lt: yearEnd },
      },
      select: { amount: true },
    });
    const withdrawnYTD = withdrawals.reduce((s, w) => s + w.amount, 0);

    return {
      success: true,
      data: {
        year,
        grossYTD: earnings.grossYTD,
        netYTD: earnings.paidYTD,
        earnedYTD: earnings.earnedYTD,
        deductionsYTD: earnings.deductionsYTD,
        adjustmentsYTD: earnings.adjustmentsYTD,
        reimbursementsYTD: earnings.reimbursementsYTD,
        estimatedTaxes: Math.max(0, earnings.paidYTD * taxRate),
        estimatedTaxRate: taxRate,
        totalHoursYTD: earnings.totalHoursYTD,
        // ALL completed work this year — not just jobs that already sit inside a
        // PAID pay period (item 6).
        jobsCompletedYTD: earnings.jobsCompletedYTD,
        paidPayoutCount: earnings.paidPayoutCount,
        pendingAmount: earnings.pendingAmount,
        withdrawnYTD,
      },
    };
  } catch (error) {
    console.error("Error getting income data:", error);
    return { success: false, error: "Failed to load income data" };
  }
}
