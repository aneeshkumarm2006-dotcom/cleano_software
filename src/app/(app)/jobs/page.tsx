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

  const isAdmin =
    (session.user as any).role === "ADMIN" ||
    (session.user as any).role === "OWNER";

  const params = await searchParams;
  const search = (params.search as string) || "";
  const status = (params.status as string) || "all";
  const payment = (params.payment as string) || "all";
  const subTab = (params.subTab as string) || "all";
  const page = Number(params.page) || 1;
  const rowsPerPage = Number(params.rowsPerPage) || 10;

  const baseWhere: any = {};
  if (!isAdmin) {
    baseWhere.employeeId = session.user.id;
  }

  const allJobs = await db.job.findMany({
    where: baseWhere,
    include: {
      employee: true,
      cleaners: true,
      client: true,
      addOns: true,
      productUsage: { include: { product: true } },
    },
    orderBy: {
      jobDate: "desc",
    },
  });

  const users = await db.user.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true },
  });

  const clients = await db.client.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

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

  const jobsData = allJobs.map((job) => {
    const productCost = job.productUsage.reduce(
      (sum, u) => sum + u.quantity * u.product.costPerUnit,
      0
    );
    const revenue = job.price || 0;
    const costs = (job.employeePay || 0) + (job.parking || 0) + productCost;
    const profit = revenue - costs;
    const profitPct = revenue > 0 ? (profit / revenue) * 100 : 0;

    const timeSpentMs =
      job.endTime && job.startTime
        ? new Date(job.endTime).getTime() - new Date(job.startTime).getTime()
        : 0;

    return {
      id: job.id,
      clientName: job.clientName,
      clientId: job.clientId,
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
      paymentType: job.paymentType,
      discountAmount: job.discountAmount,
      bedCount: job.bedCount,
      bathCount: job.bathCount,
      payRateMultiplier: job.payRateMultiplier,
      profit,
      profitPct,
      timeSpentMs,
      cleaners: job.cleaners.map((c) => ({ id: c.id, name: c.name })),
      addOns: job.addOns.map((a) => ({
        id: a.id,
        name: a.name,
        price: a.price,
      })),
    };
  });

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
        initialSubTab={subTab}
        initialPage={page}
        initialRowsPerPage={rowsPerPage}
        users={users}
        clients={clients}
        isAdmin={isAdmin}
      />
    </div>
  );
}
