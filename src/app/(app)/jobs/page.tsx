import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import JobsPageClient from "./JobsPageClient";

type SearchParams = Promise<{
  [key: string]: string | string[] | undefined;
}>;

export default async function JobsPage({
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

  // Check user role - admins/owners can see all jobs
  const isAdmin =
    (session.user as any).role === "ADMIN" ||
    (session.user as any).role === "OWNER";

  // Parse search params
  const params = await searchParams;
  const search = (params.search as string) || "";
  const status = (params.status as string) || "all";
  const payment = (params.payment as string) || "all";
  const page = Number(params.page) || 1;
  const rowsPerPage = Number(params.rowsPerPage) || 10;

  // Build where clause for stats
  const baseWhere: any = {};
  if (!isAdmin) {
    baseWhere.employeeId = session.user.id;
  }

  // Fetch all jobs for the user
  const allJobs = await db.job.findMany({
    where: baseWhere,
    include: {
      employee: true,
      cleaners: true,
    },
    orderBy: {
      jobDate: "desc",
    },
  });

  // Fetch all users for the cleaner selector
  const users = await db.user.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
    },
  });

  // Calculate statistics
  const totalRevenue = await db.job.aggregate({
    where: baseWhere,
    _sum: { price: true },
  });

  const completedJobs = await db.job.count({
    where: { ...baseWhere, status: "COMPLETED" },
  });

  const pendingPaymentCount = await db.job.count({
    where: { ...baseWhere, paymentReceived: false, status: "COMPLETED" },
  });

  const totalJobsCount = allJobs.length;

  // Transform jobs for the client
  const jobsData = allJobs.map((job) => ({
    id: job.id,
    clientName: job.clientName,
    location: job.location,
    description: job.description,
    jobType: job.jobType,
    jobDate: job.jobDate?.toISOString() || null,
    startTime: job.startTime.toISOString(),
    endTime: job.endTime?.toISOString() || null,
    status: job.status,
    price: job.price,
    employeePay: job.employeePay,
    totalTip: job.totalTip,
    parking: job.parking,
    notes: job.notes,
    paymentReceived: job.paymentReceived,
    invoiceSent: job.invoiceSent,
    cleaners: job.cleaners.map((c) => ({ id: c.id, name: c.name })),
  }));

  const stats = {
    totalJobs: totalJobsCount,
    completedJobs,
    totalRevenue: totalRevenue._sum.price || 0,
    pendingPayment: pendingPaymentCount,
  };

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <JobsPageClient
        initialJobs={jobsData}
        initialStats={stats}
        initialSearch={search}
        initialStatus={status}
        initialPayment={payment}
        initialPage={page}
        initialRowsPerPage={rowsPerPage}
        users={users}
      />
    </div>
  );
}
