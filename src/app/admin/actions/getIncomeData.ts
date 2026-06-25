"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import type { IncomeData } from "./getIncomeData.types";

interface GetInput {
  employeeId?: string;
  year?: number;
  taxRate?: number;
}

const DEFAULT_TAX_RATE = 0.25;

const TAX_SETTING_KEY = "income.estimatedTaxRate";

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

    const year = input.year ?? new Date().getFullYear();
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year + 1, 0, 1);

    let taxRate = input.taxRate ?? DEFAULT_TAX_RATE;
    if (input.taxRate === undefined) {
      const setting = await db.appSetting.findUnique({
        where: { key: TAX_SETTING_KEY },
      });
      if (setting && typeof setting.value === "number") {
        taxRate = setting.value as number;
      }
    }

    const payouts = await db.payout.findMany({
      where: {
        employeeId: targetEmployeeId,
        payPeriod: {
          paidAt: { gte: yearStart, lt: yearEnd },
          status: "PAID",
        },
      },
      include: { payPeriod: true },
    });

    const pendingPayouts = await db.payout.findMany({
      where: {
        employeeId: targetEmployeeId,
        payPeriod: {
          status: { in: ["DRAFT", "APPROVED"] },
        },
      },
    });

    const grossYTD = payouts.reduce((s, p) => s + p.baseAmount, 0);
    const netYTD = payouts.reduce((s, p) => s + p.finalAmount, 0);
    const deductionsYTD = payouts.reduce((s, p) => s + p.deductions, 0);
    const adjustmentsYTD = payouts.reduce((s, p) => s + p.adjustments, 0);
    const reimbursementsYTD = payouts.reduce(
      (s, p) => s + p.reimbursements,
      0
    );
    const totalHoursYTD = payouts.reduce((s, p) => s + p.totalHours, 0);
    const jobsCompletedYTD = payouts.reduce((s, p) => s + p.jobCount, 0);

    const estimatedTaxes = Math.max(0, netYTD * taxRate);
    const pendingAmount = pendingPayouts.reduce(
      (s, p) => s + p.finalAmount,
      0
    );

    const withdrawals = await db.withdrawal.findMany({
      where: {
        employeeId: targetEmployeeId,
        status: "COMPLETED",
        processedAt: { gte: yearStart, lt: yearEnd },
      },
    });
    const withdrawnYTD = withdrawals.reduce((s, w) => s + w.amount, 0);

    return {
      success: true,
      data: {
        year,
        grossYTD,
        netYTD,
        deductionsYTD,
        adjustmentsYTD,
        reimbursementsYTD,
        estimatedTaxes,
        estimatedTaxRate: taxRate,
        totalHoursYTD,
        jobsCompletedYTD,
        paidPayoutCount: payouts.length,
        pendingAmount,
        withdrawnYTD,
      },
    };
  } catch (error) {
    console.error("Error getting income data:", error);
    return { success: false, error: "Failed to load income data" };
  }
}
