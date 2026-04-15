import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import PayoutsPageClient from "./PayoutsPageClient";

export default async function PayoutsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const role = (session.user as any).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    redirect("/dashboard");
  }

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

  const data = periods.map((p) => ({
    id: p.id,
    startDate: p.startDate.toISOString(),
    endDate: p.endDate.toISOString(),
    status: p.status,
    notes: p.notes,
    approvedAt: p.approvedAt ? p.approvedAt.toISOString() : null,
    approvedBy: p.approvedBy ? { id: p.approvedBy.id, name: p.approvedBy.name } : null,
    paidAt: p.paidAt ? p.paidAt.toISOString() : null,
    totalFinal: p.payouts.reduce((sum, pay) => sum + pay.finalAmount, 0),
    employeeCount: p.payouts.length,
    payouts: p.payouts.map((pay) => ({
      id: pay.id,
      employeeId: pay.employeeId,
      employeeName: pay.employee.name,
      employeeEmail: pay.employee.email,
      baseAmount: pay.baseAmount,
      adjustments: pay.adjustments,
      deductions: pay.deductions,
      reimbursements: pay.reimbursements,
      finalAmount: pay.finalAmount,
      jobCount: pay.jobCount,
      totalHours: pay.totalHours,
      notes: pay.notes,
    })),
  }));

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <PayoutsPageClient initialPeriods={data} />
    </div>
  );
}
