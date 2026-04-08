import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import EmployeeDetailView from "./EmployeeDetailView";

export default async function EmployeePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  const userRole = (session.user as any).role;
  if (userRole !== "OWNER" && userRole !== "ADMIN") {
    redirect("/dashboard");
  }

  const employee = await db.user.findUnique({
    where: { id },
    include: {
      jobs: {
        include: {
          productUsage: {
            include: {
              product: true,
            },
          },
        },
        orderBy: {
          startTime: "desc",
        },
      },
      assignedProducts: {
        include: {
          product: true,
        },
      },
    },
  });

  if (!employee) {
    redirect("/employees");
  }

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Calculate stats
  const completedJobs = employee.jobs.filter((j) => j.status === "COMPLETED");
  const totalRevenue = completedJobs.reduce(
    (sum, j) => sum + (j.price || 0),
    0
  );
  const totalPaid = completedJobs.reduce(
    (sum, j) => sum + (j.employeePay || 0),
    0
  );
  const totalTips = completedJobs.reduce(
    (sum, j) => sum + (j.totalTip || 0),
    0
  );
  const unpaidJobs = completedJobs.filter((j) => !j.paymentReceived).length;

  // Upcoming jobs (in progress, future start time)
  const upcomingJobs = employee.jobs
    .filter((j) => j.status === "IN_PROGRESS" && new Date(j.startTime) > now)
    .slice(0, 5)
    .map((j) => ({
      id: j.id,
      clientName: j.clientName,
      jobType: j.jobType,
      startTime: j.startTime.toISOString(),
      price: j.price,
      status: j.status,
      paymentReceived: j.paymentReceived,
    }));

  // Recent jobs (completed in last 30 days)
  const recentJobs = employee.jobs
    .filter(
      (j) => j.status === "COMPLETED" && new Date(j.startTime) > thirtyDaysAgo
    )
    .slice(0, 5)
    .map((j) => ({
      id: j.id,
      clientName: j.clientName,
      jobType: j.jobType,
      startTime: j.startTime.toISOString(),
      price: j.price,
      status: j.status,
      paymentReceived: j.paymentReceived,
    }));

  // Top products used
  const productUsageMap = new Map<
    string,
    { name: string; quantity: number; unit: string }
  >();
  employee.jobs.forEach((job) => {
    job.productUsage.forEach((usage) => {
      const existing = productUsageMap.get(usage.product.id);
      if (existing) {
        existing.quantity += usage.quantity;
      } else {
        productUsageMap.set(usage.product.id, {
          name: usage.product.name,
          quantity: usage.quantity,
          unit: usage.product.unit,
        });
      }
    });
  });

  const topProducts = Array.from(productUsageMap.values())
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 5);

  // Assigned products
  const assignedProducts = employee.assignedProducts.map((p) => ({
    id: p.id,
    productId: p.product.id,
    productName: p.product.name,
    quantity: p.quantity,
    unit: p.product.unit,
    costPerUnit: p.product.costPerUnit,
  }));

  return (
    <EmployeeDetailView
      employee={{
        id: employee.id,
        name: employee.name,
        email: employee.email,
        phone: employee.phone,
        role: employee.role as "OWNER" | "ADMIN" | "EMPLOYEE",
      }}
      stats={{
        completedJobsCount: completedJobs.length,
        totalRevenue,
        totalPaid,
        totalTips,
        unpaidJobs,
      }}
      upcomingJobs={upcomingJobs}
      recentJobs={recentJobs}
      topProducts={topProducts}
      assignedProducts={assignedProducts}
    />
  );
}
