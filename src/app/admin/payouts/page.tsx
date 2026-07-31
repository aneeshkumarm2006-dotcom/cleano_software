import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import PayoutsPageClient from "./PayoutsPageClient";
import { computePayoutTotals, summarisePayouts } from "@/lib/payout-math";

export default async function PayoutsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const role = (session.user as any).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    redirect("/admin/dashboard");
  }

  // Cleaner withdrawal requests, reviewed alongside payroll (new fix list
  // item 3) — this is where the payment method actually gets chosen.
  const withdrawalRows = await db.withdrawal.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { employee: { select: { name: true, email: true } } },
  });

  const withdrawals = withdrawalRows.map((w) => ({
    id: w.id,
    employeeName: w.employee?.name ?? "Unknown cleaner",
    employeeEmail: w.employee?.email ?? null,
    amount: w.amount,
    status: w.status,
    paymentMethod: w.paymentMethod,
    notes: w.notes,
    createdAt: w.createdAt.toISOString(),
    processedAt: w.processedAt ? w.processedAt.toISOString() : null,
  }));

  const periods = await db.payPeriod.findMany({
    orderBy: { startDate: "desc" },
    include: {
      approvedBy: { select: { id: true, name: true } },
      payouts: {
        include: {
          employee: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });

  // Totals are RECOMPUTED from the four components through the canonical helper
  // rather than trusted from the stored column, so periods written before the
  // $0 floor landed (the -$40 draft the client reported) display correctly
  // without waiting on a data repair. Writes are clamped in updatePayout.
  const data = periods.map((p) => {
    const rollup = summarisePayouts(p.payouts);
    return {
      id: p.id,
      startDate: p.startDate.toISOString(),
      endDate: p.endDate.toISOString(),
      status: p.status,
      notes: p.notes,
      approvedAt: p.approvedAt ? p.approvedAt.toISOString() : null,
      approvedBy: p.approvedBy ? { id: p.approvedBy.id, name: p.approvedBy.name } : null,
      paidAt: p.paidAt ? p.paidAt.toISOString() : null,
      totalFinal: rollup.totalFinal,
      totalShortfall: rollup.totalShortfall,
      shortfallCount: rollup.shortfallCount,
      employeeCount: p.payouts.length,
      payouts: p.payouts.map((pay) => {
        const totals = computePayoutTotals(pay);
        return {
          id: pay.id,
          employeeId: pay.employeeId,
          employeeName: pay.employee.name,
          employeeEmail: pay.employee.email,
          baseAmount: pay.baseAmount,
          adjustments: pay.adjustments,
          deductions: pay.deductions,
          reimbursements: pay.reimbursements,
          finalAmount: totals.final,
          shortfall: totals.shortfall,
          jobCount: pay.jobCount,
          totalHours: pay.totalHours,
          notes: pay.notes,
        };
      }),
    };
  });

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <PayoutsPageClient initialPeriods={data} withdrawals={withdrawals} />
    </div>
  );
}
