import { db } from "@/lib/org-db";
import { requireAdmin } from "@/lib/page-guards";
import { EMPLOYEE_ROLES } from "@/lib/metrics";
import TimeTrackingClient from "./TimeTrackingClient";

/**
 * Centralised admin view of employee clock-in / clock-out activity
 * (awer_fixes.pdf item 12). Per-job clock detail also lives on the job page;
 * this is the cross-employee view that was missing.
 */
export default async function TimeTrackingPage() {
  await requireAdmin();

  const cleaners = await db.user.findMany({
    where: { role: { in: [...EMPLOYEE_ROLES] }, deletedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <TimeTrackingClient cleaners={cleaners} />
    </div>
  );
}
