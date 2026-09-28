"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import type { TaxSummary } from "./generateTaxSummary.types";

const DEFAULT_TAX_RATE = 0.25;
const TAX_SETTING_KEY = "income.estimatedTaxRate";

interface GenerateInput {
  employeeId?: string;
  year?: number;
}

export async function generateTaxSummary(
  input: GenerateInput = {}
): Promise<
  { success: true; summary: TaxSummary } | { success: false; error: string }
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

    const employee = await db.user.findUnique({
      where: { id: targetEmployeeId },
    });
    if (!employee) {
      return { success: false, error: "Employee not found" };
    }

    const year = input.year ?? new Date().getFullYear();
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year + 1, 0, 1);

    let taxRate = DEFAULT_TAX_RATE;
    const taxSetting = await db.appSetting.findFirst({
      where: { key: TAX_SETTING_KEY },
    });
    if (taxSetting && typeof taxSetting.value === "number") {
      taxRate = taxSetting.value as number;
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
      orderBy: { payPeriod: { startDate: "asc" } },
    });

    const netIncome = payouts.reduce((s, p) => s + p.finalAmount, 0);
    const totalDeductions = payouts.reduce((s, p) => s + p.deductions, 0);
    const totalAdjustments = payouts.reduce((s, p) => s + p.adjustments, 0);
    const totalReimbursements = payouts.reduce(
      (s, p) => s + p.reimbursements,
      0
    );
    // Gross is earnings before deductions: finalAmount already nets out
    // deductions, so add them back. Keeps gross/net consistent (gross −
    // deductions = net) and reflects adjustments/reimbursements.
    const grossIncome = netIncome + totalDeductions;
    const totalHours = payouts.reduce((s, p) => s + p.totalHours, 0);
    const jobsCompleted = payouts.reduce((s, p) => s + p.jobCount, 0);
    const estimatedTaxes = Math.max(0, netIncome * taxRate);

    const documentNumber = `TAX-${year}-${targetEmployeeId.slice(-6).toUpperCase()}`;

    return {
      success: true,
      summary: {
        documentNumber,
        generatedAt: new Date().toISOString(),
        year,
        employee: {
          id: employee.id,
          name: employee.name,
          email: employee.email,
          phone: employee.phone,
        },
        grossIncome,
        netIncome,
        totalDeductions,
        totalAdjustments,
        totalReimbursements,
        estimatedTaxes,
        estimatedTaxRate: taxRate,
        totalHours,
        jobsCompleted,
        payPeriods: payouts.map((p) => ({
          payoutId: p.id,
          periodStart: p.payPeriod.startDate.toISOString(),
          periodEnd: p.payPeriod.endDate.toISOString(),
          paidAt: p.payPeriod.paidAt
            ? p.payPeriod.paidAt.toISOString()
            : null,
          baseAmount: p.baseAmount,
          adjustments: p.adjustments,
          deductions: p.deductions,
          reimbursements: p.reimbursements,
          finalAmount: p.finalAmount,
          jobCount: p.jobCount,
          totalHours: p.totalHours,
        })),
      },
    };
  } catch (error) {
    console.error("Error generating tax summary:", error);
    return { success: false, error: "Failed to generate tax summary" };
  }
}
