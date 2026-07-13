import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { jobRevenue, getEmployeeCounts } from "@/lib/metrics";
import {
  dateKeyFromStoredDate,
  dateKeyToStoredDate,
  dateKeyTz,
} from "@/lib/availability";
import EmployeesPageClient from "./EmployeesPageClient";
import AvailabilityOverview from "./AvailabilityOverview";

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
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  // Admin only - OWNER or ADMIN
  const userRole = (session.user as any).role;
  if (userRole !== "OWNER" && userRole !== "ADMIN") {
    redirect("/admin/dashboard");
  }

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
      jobs: true,
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
      completedJobsCount: completedJobs.length,
      activeJobsCount: activeJobs.length,
      totalRevenue,
      unpaidJobs,
      // Last login / last active — shown on the profile AND in this list.
      lastSeenAt: emp.lastSeenAt ? emp.lastSeenAt.toISOString() : null,
    };
  });

  // All-cleaners availability overview (one batched query; active view only).
  const cleanerRows = employees.filter(
    (e) => e.role === "EMPLOYEE" || e.role === "FIELD_LEAD"
  );
  const availabilitySlots = archived
    ? []
    : await db.employeeAvailability.findMany({
        where: { employeeId: { in: cleanerRows.map((e) => e.id) } },
        select: {
          employeeId: true,
          day: true,
          startTime: true,
          endTime: true,
          isAvailable: true,
        },
      });
  // Upcoming one-off time off (vacation / appointment / sick day). These beat the
  // weekly rule, so the overview has to show them or the table lies.
  const today = dateKeyToStoredDate(dateKeyTz(new Date()));
  const timeOff =
    archived || !today
      ? []
      : await db.availabilityException.findMany({
          where: {
            employeeId: { in: cleanerRows.map((e) => e.id) },
            date: { gte: today },
          },
          orderBy: { date: "asc" },
          select: { employeeId: true, date: true, reason: true },
        });

  const availabilityRows = archived
    ? []
    : cleanerRows.map((e) => ({
        employeeId: e.id,
        employeeName: e.name,
        slots: availabilitySlots
          .filter((s) => s.employeeId === e.id)
          .map((s) => ({
            day: s.day as string,
            startTime: s.startTime,
            endTime: s.endTime,
            isAvailable: s.isAvailable,
          })),
        timeOff: timeOff
          .filter((t) => t.employeeId === e.id)
          .map((t) => ({
            date: dateKeyFromStoredDate(t.date),
            reason: t.reason,
          })),
      }));

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
      {!archived && <AvailabilityOverview rows={availabilityRows} />}
    </div>
  );
}
