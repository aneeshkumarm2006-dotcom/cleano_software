"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import type {
  ProviderInvoice,
  ProviderInvoiceLine,
} from "./generateProviderInvoice.types";

interface GenerateInput {
  startDate?: string;
  endDate?: string;
}

export async function generateProviderInvoice(
  input: GenerateInput = {}
): Promise<
  { success: true; invoice: ProviderInvoice } | { success: false; error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return { success: false, error: "Not authenticated" };
  }

  const userId = session.user.id;

  try {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) {
      return { success: false, error: "Employee not found" };
    }

    const where: {
      employeeId: string;
      payPeriod?: { startDate?: { gte?: Date }; endDate?: { lte?: Date } };
    } = { employeeId: userId };

    const start = input.startDate ? new Date(input.startDate) : null;
    const end = input.endDate ? new Date(input.endDate) : null;

    if (start || end) {
      where.payPeriod = {};
      if (start) where.payPeriod.startDate = { gte: start };
      if (end) where.payPeriod.endDate = { lte: end };
    }

    const payouts = await db.payout.findMany({
      where,
      include: { payPeriod: true },
      orderBy: { payPeriod: { startDate: "asc" } },
    });

    const lines: ProviderInvoiceLine[] = payouts.map((p) => ({
      payoutId: p.id,
      periodStart: p.payPeriod.startDate.toISOString(),
      periodEnd: p.payPeriod.endDate.toISOString(),
      jobCount: p.jobCount,
      totalHours: p.totalHours,
      baseAmount: p.baseAmount,
      adjustments: p.adjustments,
      deductions: p.deductions,
      reimbursements: p.reimbursements,
      finalAmount: p.finalAmount,
      status: p.payPeriod.status,
      paidAt: p.payPeriod.paidAt ? p.payPeriod.paidAt.toISOString() : null,
    }));

    const subtotal = lines.reduce((sum, l) => sum + l.finalAmount, 0);
    const totalHours = lines.reduce((sum, l) => sum + l.totalHours, 0);
    const totalJobs = lines.reduce((sum, l) => sum + l.jobCount, 0);

    const periodFrom = lines.length ? lines[0].periodStart : null;
    const periodTo = lines.length ? lines[lines.length - 1].periodEnd : null;

    const invoiceNumber = `PROV-${userId.slice(-6).toUpperCase()}-${Date.now()
      .toString()
      .slice(-6)}`;

    return {
      success: true,
      invoice: {
        invoiceNumber,
        generatedAt: new Date().toISOString(),
        employee: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
        },
        periodFrom,
        periodTo,
        lines,
        subtotal,
        totalHours,
        totalJobs,
      },
    };
  } catch (error) {
    console.error("Error generating provider invoice:", error);
    return { success: false, error: "Failed to generate invoice" };
  }
}
