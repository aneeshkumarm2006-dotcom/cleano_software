import { db } from "@/db";
import { requireCleaner } from "@/lib/page-guards";
import MyPayClient from "./MyPayClient";
import { getEmployeeAvgRating } from "@/app/admin/actions/setEmployeeRating";

export default async function MyPayPage() {
  const session = await requireCleaner();
  const userId = session.user.id;

  const [payouts, withdrawals, starRating, ragWashes, ragCreditSetting, completedJobs, allPayPeriods, userRecord] = await Promise.all([
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
    // Fetch completed jobs for this cleaner to compute unprocessed earnings
    db.job.findMany({
      where: {
        status: { in: ["COMPLETED", "IN_PROGRESS"] },
        clockOutTime: { not: null },
        employeePay: { gt: 0 },
        OR: [
          { employeeId: userId },
          { cleaners: { some: { id: userId } } },
        ],
      },
      select: {
        id: true,
        jobDate: true,
        startTime: true,
        employeeId: true,
        employeePay: true,
        totalTip: true,
        payRateMultiplier: true,
        cleaners: { select: { id: true } },
      },
    }),
    db.payPeriod.findMany({
      where: { payouts: { some: { employeeId: userId } } },
      select: { startDate: true, endDate: true },
    }),
    db.user.findUnique({
      where: { id: userId },
      select: { payMultiplier: true },
    }),
  ]);

  const currentPayout =
    payouts.find(
      (p) => p.payPeriod.status === "DRAFT" || p.payPeriod.status === "APPROVED"
    ) ?? null;

  const paidPayouts = payouts.filter((p) => p.payPeriod.status === "PAID");
  const walletBalance = paidPayouts.reduce((sum, p) => sum + p.finalAmount, 0);
  const pendingFromPayPeriods = payouts
    .filter(
      (p) =>
        p.payPeriod.status === "DRAFT" || p.payPeriod.status === "APPROVED"
    )
    .reduce((sum, p) => sum + p.finalAmount, 0);

  // Earnings from completed jobs not yet covered by any pay period
  const empMultiplier = userRecord?.payMultiplier ?? 1;
  const unprocessedEarnings = completedJobs
    .filter((job) => {
      const jobDate = new Date(job.jobDate ?? job.startTime);
      return !allPayPeriods.some((pp) => {
        const rangeEnd = new Date(pp.endDate);
        rangeEnd.setHours(23, 59, 59, 999);
        return jobDate >= pp.startDate && jobDate <= rangeEnd;
      });
    })
    .reduce((sum, job) => {
      const participants = Array.from(
        new Set([job.employeeId, ...job.cleaners.map((c) => c.id)].filter(Boolean))
      );
      if (participants.length === 0) return sum;
      const basePay = ((job.employeePay ?? 0) + (job.totalTip ?? 0)) * (job.payRateMultiplier ?? 1);
      return sum + (basePay / participants.length) * empMultiplier;
    }, 0);

  const pendingAmount = pendingFromPayPeriods + unprocessedEarnings;

  // Reserved = withdrawals not rejected
  const reservedTotal = withdrawals
    .filter(
      (w) =>
        w.status === "PENDING" ||
        w.status === "APPROVED" ||
        w.status === "COMPLETED"
    )
    .reduce((sum, w) => sum + w.amount, 0);

  const availableBalance = Math.max(0, walletBalance - reservedTotal);

  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const paidThisYear = paidPayouts
    .filter((p) => p.payPeriod.paidAt && p.payPeriod.paidAt >= yearStart)
    .reduce((sum, p) => sum + p.finalAmount, 0);
  const totalHoursYear = paidPayouts
    .filter((p) => p.payPeriod.paidAt && p.payPeriod.paidAt >= yearStart)
    .reduce((sum, p) => sum + p.totalHours, 0);

  // Rag credit rate (default $0.50 per rag)
  const ragCreditRate =
    typeof (ragCreditSetting?.value as Record<string, unknown> | null)?.rate === "number"
      ? (ragCreditSetting!.value as Record<string, unknown>).rate as number
      : 0.5;

  const allTimeRags = ragWashes.reduce((s, w) => s + w.ragCount, 0);
  const allTimeCredit = Math.round(allTimeRags * ragCreditRate * 100) / 100;

  // Rag washes during the current pay period
  const currentPeriodStart = currentPayout
    ? new Date(currentPayout.payPeriod.startDate)
    : null;
  const currentPeriodEnd = currentPayout
    ? new Date(currentPayout.payPeriod.endDate)
    : null;

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
      walletBalance={walletBalance}
      pendingAmount={pendingAmount}
      unprocessedEarnings={unprocessedEarnings}
      paidThisYear={paidThisYear}
      totalHoursYear={totalHoursYear}
      availableBalance={availableBalance}
      currentPayout={currentPayout ? serializePayout(currentPayout) : null}
      year={now.getFullYear()}
      starRating={starRating}
      ragData={ragData}
    />
  );
}
