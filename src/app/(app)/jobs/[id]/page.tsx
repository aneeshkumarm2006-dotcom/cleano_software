import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import JobDetailView from "./JobDetailView";

export default async function JobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const search = await searchParams;
  const logsPage = Number(search.logsPage) || 1;
  const logsPerPage = 10;

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  const job = await db.job.findUnique({
    where: { id },
    include: {
      employee: true,
      cleaners: true,
      productUsage: {
        include: {
          product: true,
        },
      },
      _count: {
        select: { logs: true },
      },
    },
  });

  if (!job) {
    redirect("/jobs");
  }

  // Check if user has access to view this job
  if (
    job.employeeId !== session.user.id &&
    (session.user as any).role !== "OWNER" &&
    (session.user as any).role !== "ADMIN"
  ) {
    redirect("/jobs");
  }

  // Fetch all users for the cleaner selector
  const users = await db.user.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
    },
  });

  // Fetch paginated logs separately
  const totalLogs = job._count.logs;
  const logs = await db.jobLog.findMany({
    where: { jobId: id },
    include: {
      user: true,
    },
    orderBy: {
      createdAt: "desc",
    },
    skip: (logsPage - 1) * logsPerPage,
    take: logsPerPage,
  });

  // Calculate total cost of products used
  const totalProductCost = job.productUsage.reduce((sum, usage) => {
    return sum + usage.quantity * usage.product.costPerUnit;
  }, 0);

  // Check if user is admin
  const isAdmin =
    (session.user as any).role === "OWNER" ||
    (session.user as any).role === "ADMIN";

  // Server action to delete job
  async function deleteJob() {
    "use server";

    await db.job.delete({
      where: { id },
    });

    revalidatePath("/jobs");
    redirect("/jobs");
  }

  // Transform data for client component
  const jobData = {
    id: job.id,
    clientName: job.clientName,
    location: job.location,
    description: job.description,
    jobType: job.jobType,
    jobDate: job.jobDate?.toISOString() || null,
    startTime: job.startTime.toISOString(),
    endTime: job.endTime?.toISOString() || null,
    clockInTime: job.clockInTime?.toISOString() || null,
    clockOutTime: job.clockOutTime?.toISOString() || null,
    status: job.status,
    price: job.price,
    employeePay: job.employeePay,
    totalTip: job.totalTip,
    parking: job.parking,
    paymentReceived: job.paymentReceived,
    invoiceSent: job.invoiceSent,
    notes: job.notes,
    employee: {
      id: job.employee.id,
      name: job.employee.name,
    },
    cleaners: job.cleaners.map((c) => ({ id: c.id, name: c.name })),
  };

  const productUsageData = job.productUsage.map((usage) => ({
    id: usage.id,
    quantity: usage.quantity,
    notes: usage.notes,
    product: {
      id: usage.product.id,
      name: usage.product.name,
      unit: usage.product.unit,
      costPerUnit: usage.product.costPerUnit,
    },
  }));

  const logsData = logs.map((log) => ({
    id: log.id,
    action: log.action,
    field: log.field,
    oldValue: log.oldValue,
    newValue: log.newValue,
    description: log.description,
    createdAt: log.createdAt.toISOString(),
    user: log.user ? { id: log.user.id, name: log.user.name } : null,
  }));

  return (
    <JobDetailView
      job={jobData}
      productUsage={productUsageData}
      logs={logsData}
      totalLogs={totalLogs}
      logsPage={logsPage}
      logsPerPage={logsPerPage}
      totalProductCost={totalProductCost}
      isAdmin={isAdmin}
      onDeleteJob={deleteJob}
      users={users}
    />
  );
}
