import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import EmployeesPageClient from "./EmployeesPageClient";

type SearchParams = Promise<{
  [key: string]: string | string[] | undefined;
}>;

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
    redirect("/dashboard");
  }

  // Parse search params
  const params = await searchParams;
  const search = (params.search as string) || "";
  const role = (params.role as string) || "all";
  const jobStatus = (params.jobStatus as string) || "all";
  const page = Number(params.page) || 1;
  const rowsPerPage = Number(params.rowsPerPage) || 10;

  // Fetch all employees with their jobs
  const employees = await db.user.findMany({
    include: {
      jobs: true,
    },
    orderBy: {
      name: "asc",
    },
  });

  // Calculate stats for each employee
  const employeesData = employees.map((emp) => {
    const completedJobs = emp.jobs.filter((j) => j.status === "COMPLETED");
    const activeJobs = emp.jobs.filter((j) => j.status === "IN_PROGRESS");
    const totalRevenue = completedJobs.reduce(
      (sum, j) => sum + (j.price || 0),
      0
    );
    const unpaidJobs = completedJobs.filter((j) => !j.paymentReceived).length;

    return {
      id: emp.id,
      name: emp.name,
      email: emp.email,
      phone: emp.phone,
      role: emp.role as "OWNER" | "ADMIN" | "EMPLOYEE",
      completedJobsCount: completedJobs.length,
      activeJobsCount: activeJobs.length,
      totalRevenue,
      unpaidJobs,
    };
  });

  // Calculate overall stats
  const stats = {
    totalEmployees: employees.length,
    admins: employees.filter((e) => e.role === "ADMIN" || e.role === "OWNER")
      .length,
    activeEmployees: employeesData.filter((e) => e.activeJobsCount > 0).length,
    totalRevenue: employeesData.reduce((sum, e) => sum + e.totalRevenue, 0),
  };

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <EmployeesPageClient
        initialEmployees={employeesData}
        initialStats={stats}
        initialSearch={search}
        initialRole={role}
        initialJobStatus={jobStatus}
        initialPage={page}
        initialRowsPerPage={rowsPerPage}
      />
    </div>
  );
}
