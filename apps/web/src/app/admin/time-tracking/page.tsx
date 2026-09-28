import { db } from "@/lib/org-db";
import { requireAdmin } from "@/lib/page-guards";
import { EMPLOYEE_ROLES } from "@/lib/metrics";
import TimeTrackingClient from "./TimeTrackingClient";
import StaleClocksPanel from "../notifications/StaleClocksPanel";
import { listStaleClocksForAdmin } from "../actions/closeStaleClock";

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

  // Clocks nobody closed, at the top of the page whose whole job this is.
  // They shipped on Notifications, which is a record of things that have
  // already happened; a clock still running is work in progress, and the
  // person who can end it is the one standing on this page.
  const staleClocks = await listStaleClocksForAdmin();

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <StaleClocksPanel rows={staleClocks} />
      <TimeTrackingClient cleaners={cleaners} />
    </div>
  );
}
