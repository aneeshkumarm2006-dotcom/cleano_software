import { db } from "@/db";
import { requireCleaner } from "@/lib/page-guards";
import MyPayClient from "./MyPayClient";
import { getEmployeeAvgRating } from "@/app/admin/actions/setEmployeeRating";
import { getCleanerEarnings } from "@/lib/cleaner-earnings";

export default async function MyPayPage() {
  const session = await requireCleaner();
  const userId = session.user.id;
  const now = new Date();
  const year = now.getFullYear();

  // All money figures come from the ONE shared computation (src/lib/cleaner-earnings.ts)
  // that payroll and My Income also use — My Pay no longer invents its own math.
  const [earnings, payouts, withdrawals, starRating, ragWashes, ragCreditSetting] =
    await Promise.all([
      getCleanerEarnings(userId, year, now),
      db.payout.findMany({
        where: { employeeId: userId },
        include: { payPeriod: true },
        orderBy: { payPeriod: { startDate: "desc" } },
      }),
      db.withdrawal.findMany({
        where: { employeeId: userId },
        orderBy: { createdAt: "desc" },
      }),
      getEmployeeAvgRating(userId),
      db.ragWash.findMany({
        where: { employeeId: userId },
        orderBy: { washDate: "desc" },
      }),
      db.appSetting.findUnique({ where: { key: "payroll.ragCreditPerRag" } }),
    ]);

  // Reserved = withdrawals not rejected
  const reservedTotal = withdrawals
    .filter(
      (w) =>
        w.status === "PENDING" ||
        w.status === "APPROVED" ||
        w.status === "COMPLETED"
    )
    .reduce((sum, w) => sum + w.amount, 0);

  const availableBalance = Math.max(0, earnings.walletBalance - reservedTotal);

  // Rag credit rate (default $0.50 per rag)
  const ragCreditRate =
    typeof (ragCreditSetting?.value as Record<string, unknown> | null)?.rate === "number"
      ? (ragCreditSetting!.value as Record<string, unknown>).rate as number
      : 0.5;

  const allTimeRags = ragWashes.reduce((s, w) => s + w.ragCount, 0);
  const allTimeCredit = Math.round(allTimeRags * ragCreditRate * 100) / 100;

  // Rag washes inside the period that CONTAINS today (never a stale draft).
  const currentPeriodStart = earnings.currentPeriod?.startDate ?? null;
  const currentPeriodEnd = earnings.currentPeriod?.endDate ?? null;

  const periodRagWashes = ragWashes.filter((w) => {
    if (!currentPeriodStart || !currentPeriodEnd) return false;
    return w.washDate >= currentPeriodStart && w.washDate <= currentPeriodEnd;
  });
  const periodRags = periodRagWashes.reduce((s, w) => s + w.ragCount, 0);
  const periodCredit = Math.round(periodRags * ragCreditRate * 100) / 100;

  const ragData = {
    allTimeRags,
    allTimeCredit,
    periodRags,
    periodCredit,
    creditRate: ragCreditRate,
    recentWashes: ragWashes.slice(0, 5).map((w) => ({
      id: w.id,
      washDate: w.washDate.toISOString(),
      ragCount: w.ragCount,
      notes: w.notes,
    })),
  };

  // Serialize Dates to strings for client component
  const serializePayout = (p: (typeof payouts)[number]) => ({
    id: p.id,
    baseAmount: p.baseAmount,
    adjustments: p.adjustments,
    deductions: p.deductions,
    reimbursements: p.reimbursements,
    finalAmount: p.finalAmount,
    jobCount: p.jobCount,
    totalHours: p.totalHours,
    payPeriod: {
      startDate: p.payPeriod.startDate.toISOString(),
      endDate: p.payPeriod.endDate.toISOString(),
      status: p.payPeriod.status,
      paidAt: p.payPeriod.paidAt ? p.payPeriod.paidAt.toISOString() : null,
    },
  });

  const currentPeriod = earnings.currentPeriod
    ? {
        startDate: earnings.currentPeriod.startDate.toISOString(),
        endDate: earnings.currentPeriod.endDate.toISOString(),
        status: earnings.currentPeriod.status,
        isLive: earnings.currentPeriod.isLive,
        baseAmount: earnings.currentPeriod.baseAmount,
        adjustments: earnings.currentPeriod.adjustments,
        deductions: earnings.currentPeriod.deductions,
        reimbursements: earnings.currentPeriod.reimbursements,
        finalAmount: earnings.currentPeriod.finalAmount,
        jobCount: earnings.currentPeriod.jobCount,
        totalHours: earnings.currentPeriod.totalHours,
      }
    : null;

  return (
    <MyPayClient
      payouts={payouts.map(serializePayout)}
      withdrawals={withdrawals.map((w) => ({
        id: w.id,
        amount: w.amount,
        status: w.status,
        paymentMethod: w.paymentMethod,
        createdAt: w.createdAt.toISOString(),
        processedAt: w.processedAt ? w.processedAt.toISOString() : null,
        notes: w.notes,
      }))}
      walletBalance={earnings.walletBalance}
      pendingAmount={earnings.pendingAmount}
      unprocessedEarnings={earnings.unprocessedEarnings}
      earnedYTD={earnings.earnedYTD}
      paidYTD={earnings.paidYTD}
      grossYTD={earnings.grossYTD}
      deductionsYTD={earnings.deductionsYTD}
      adjustmentsYTD={earnings.adjustmentsYTD}
      reimbursementsYTD={earnings.reimbursementsYTD}
      hoursYTD={earnings.totalHoursYTD}
      jobsCompletedYTD={earnings.jobsCompletedYTD}
      availableBalance={availableBalance}
      currentPeriod={currentPeriod}
      year={year}
      starRating={starRating}
      ragData={ragData}
    />
  );
}
