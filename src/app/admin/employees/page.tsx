import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { requireOwnerAdmin } from "@/lib/page-guards";
import { db } from "@/db";
import { jobRevenue, getEmployeeCounts } from "@/lib/metrics";
import { AVAILABILITY_VIEW_PATH } from "@/lib/availability-view";
import EmployeesPageClient from "./EmployeesPageClient";

type SearchParams = Promise<{
  [key: string]: string | string[] | undefined;
}>;

// Allow bulk CSV import (processed by the importCsv server action) enough time.
export const maxDuration = 60;

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // OWNER/ADMIN only. Same rule as before, now stated through the canonical
  // guard (Stage 7.6) so this page can't drift from `requireOwnerAdmin`'s
  // semantics — notably `homeForRole`, which sends a CLIENT or APPLICANT who
  // guesses this URL to their own area rather than to /admin/dashboard.
  //
  // The nav entry carries `adminOnly: true` to match (src/app/admin/Sidebar.tsx).
  await requireOwnerAdmin();

  // Parse search params
  const params = await searchParams;
  const search = (params.search as string) || "";
  const role = (params.role as string) || "all";
  const jobStatus = (params.jobStatus as string) || "all";
  const page = Number(params.page) || 1;
  const rowsPerPage = Number(params.rowsPerPage) || 10;
  // Archived view lists soft-deleted (deletedAt != null) employees for restore.
  const archived = params.archived === "1" || params.archived === "true";

  // Fetch all employees with their jobs
  // Staff only — never list CLIENT accounts here. Clients live on the Clients
  // page; without this filter every imported customer login showed up as an
  // "Employee" (inflating the count to all users).
  const employees = await db.user.findMany({
    where: {
      role: { not: "CLIENT" },
      // Active view hides soft-deleted rows; archived view shows only them.
      deletedAt: archived ? { not: null } : null,
    },
    include: {
      // `addOns` joins because revenue is the ACTIVE subtotal now, not the bare
      // `Job.price` (fix 3) — without the rows an add-on job under-reports this
      // cleaner's attributed revenue by exactly its add-ons.
      jobs: { include: { addOns: { select: { name: true, price: true, quantity: true } } } },
    },
    orderBy: {
      name: "asc",
    },
  });

  // Field Leads available as bulk-assignment targets (never soft-deleted).
  const fieldLeadRows = await db.user.findMany({
    where: {
      role: { not: "CLIENT" },
      cleanerTier: "FIELD_LEAD",
      deletedAt: null,
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const fieldLeads = fieldLeadRows.map((f) => ({ id: f.id, name: f.name }));

  // Calculate stats for each employee
  const employeesData = employees.map((emp) => {
    const completedJobs = emp.jobs.filter((j) => j.status === "COMPLETED");
    const activeJobs = emp.jobs.filter((j) => j.status === "IN_PROGRESS");
    // Canonical revenue attributed to this employee (employeeId relation):
    // completed+paid only, discount/refund applied, tax excluded, soft-deleted
    // excluded. Was previously COMPLETED-only with raw price.
    const totalRevenue = emp.jobs
      .filter(
        (j) =>
          j.deletedAt === null &&
          j.paymentReceived &&
          (j.status === "COMPLETED" || j.status === "PAID")
      )
      .reduce((sum, j) => sum + jobRevenue(j), 0);
    const unpaidJobs = completedJobs.filter((j) => !j.paymentReceived).length;

    return {
      id: emp.id,
      name: emp.name,
      email: emp.email,
      phone: emp.phone,
      role: emp.role as "OWNER" | "ADMIN" | "EMPLOYEE",
      isActive: emp.isActive,
      cleanerTier: emp.cleanerTier as "TRAINEE" | "STANDARD" | "FIELD_LEAD",
      fieldLeadId: emp.fieldLeadId,
      // Service categories the edit modal pre-fills (awerfixes.pdf item 3).
      allowedServiceCategories: emp.allowedServiceCategories,
      completedJobsCount: completedJobs.length,
      activeJobsCount: activeJobs.length,
      totalRevenue,
      unpaidJobs,
      // Last login / last active — shown on the profile AND in this list.
      lastSeenAt: emp.lastSeenAt ? emp.lastSeenAt.toISOString() : null,
    };
  });

  // The collapsed all-cleaner availability grid that used to live here — and the
  // two batched queries that fed it — was RETIRED in Stage 12 (PDF #12, step
  // 12.6). It answered "what are everyone's weekly hours?" and could say nothing
  // about a specific date, which is the question admins were actually asking;
  // /admin/availability answers both, filtered, and keeping a second grid here
  // would have been two surfaces reading the same two tables and drifting. The
  // link below replaces it.

  // Canonical field-staff headcount (active/inactive) so the headline agrees
  // with Dashboard and Analytics. Admins are surfaced separately below.
  const employeeCounts = await getEmployeeCounts();

  // Calculate overall stats
  const stats = {
    totalEmployees: employeeCounts.active,
    inactiveEmployees: employeeCounts.inactive,
    admins: employees.filter((e) => e.role === "ADMIN" || e.role === "OWNER")
      .length,
    activeEmployees: employeesData.filter((e) => e.activeJobsCount > 0).length,
    totalRevenue: employeesData.reduce((sum, e) => sum + e.totalRevenue, 0),
  };

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8 space-y-6">
      <EmployeesPageClient
        initialEmployees={employeesData}
        initialStats={stats}
        initialSearch={search}
        initialRole={role}
        initialJobStatus={jobStatus}
        initialPage={page}
        initialRowsPerPage={rowsPerPage}
        archived={archived}
        fieldLeads={fieldLeads}
      />
      {!archived && (
        <Link
          href={AVAILABILITY_VIEW_PATH}
          className="dcard flex items-center gap-3 px-5 py-4 hover:bg-black/[0.02]">
          <CalendarClock className="w-4 h-4 text-[#008C9C] shrink-0" />
          <span className="text-sm font-[600] text-gray-800">
            Availability overview
          </span>
          <span className="text-xs text-gray-500">
            Everyone&apos;s hours by week or by day, filtered by service,
            group and date.
          </span>
          <span className="ml-auto text-xs text-[#008C9C]">Open →</span>
        </Link>
      )}
    </div>
  );
}
