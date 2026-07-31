import { requireAdmin } from "@/lib/page-guards";
import { db } from "@/db";
import WashPayoutsPageClient from "./WashPayoutsPageClient";
import { isOverProjection } from "@/lib/wash";

export default async function WashPayoutsPage() {
  await requireAdmin();

  const [cleaners, payouts, flaggedJobs] = await Promise.all([
    db.user.findMany({
      where: { role: "EMPLOYEE" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        ragCredits: true,
        padCredits: true,
      },
    }),
    db.washPayout.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { employee: { select: { id: true, name: true } } },
    }),
    db.job.findMany({
      where: {
        // Archived jobs are out of the payout review queue (item 1).
        deletedAt: null,
        status: "COMPLETED",
        washCreditsAwarded: true,
        washActualRags: { not: null },
        // Hide jobs a manager has already reviewed.
        washReviewOverrideAt: null,
      },
      orderBy: { clockOutTime: "desc" },
      take: 50,
      select: {
        id: true,
        jobNumber: true,
        clientName: true,
        clockOutTime: true,
        washProjectedRags: true,
        washCappedRags: true,
        washActualRags: true,
        employee: { select: { id: true, name: true } },
      },
    }),
  ]);

  const flagged = flaggedJobs.filter((j) =>
    isOverProjection(j.washActualRags, j.washProjectedRags)
  );

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <div style={{ display: "flex", gap: 0, marginBottom: 24, borderBottom: "1px solid rgba(0,140,156,0.1)" }}>
        <a href="/admin/inventory/rag-wash" style={{ padding: "8px 18px", fontSize: 13, fontWeight: 400, color: "rgba(0,140,156,0.5)", textDecoration: "none", borderBottom: "2px solid transparent", marginBottom: -1, display: "inline-block" }}>Rag Wash</a>
        <a href="/admin/wash-payouts" style={{ padding: "8px 18px", fontSize: 13, fontWeight: 600, color: "#008C9C", textDecoration: "none", borderBottom: "2px solid #008C9C", marginBottom: -1, display: "inline-block" }}>Wash Payouts</a>
      </div>
      <WashPayoutsPageClient
        cleaners={cleaners.map((c) => ({
          id: c.id,
          name: c.name,
          email: c.email,
          ragCredits: c.ragCredits,
          padCredits: c.padCredits,
        }))}
        payouts={payouts.map((p) => ({
          id: p.id,
          employeeId: p.employee.id,
          employeeName: p.employee.name,
          amount: p.amount,
          ragCreditsUsed: p.ragCreditsUsed,
          padCreditsUsed: p.padCreditsUsed,
          status: p.status,
          createdAt: p.createdAt.toISOString(),
        }))}
        flaggedJobs={flagged.map((j) => ({
          id: j.id,
          jobNumber: j.jobNumber,
          clientName: j.clientName,
          clockOutTime: j.clockOutTime?.toISOString() ?? null,
          projectedRags: j.washProjectedRags,
          actualRags: j.washActualRags,
          employeeName: j.employee?.name ?? "—",
        }))}
      />
    </div>
  );
}
