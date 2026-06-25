import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import EmployeeDetailView from "./EmployeeDetailView";
import { getEmployeeAvgRating } from "../../actions/setEmployeeRating";
import { getStrikeSummary, STRIKE_WINDOW_DAYS } from "@/lib/strikes";

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
    redirect("/admin/dashboard");
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
      availabilities: {
        orderBy: { day: "asc" },
      },
    },
  });

  if (!employee) {
    redirect("/admin/employees");
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

  // Active kit templates for starter kit assignment
  const kitTemplatesRaw = await db.kitTemplate.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    include: {
      items: {
        include: { product: true },
      },
    },
  });

  const kitTemplates = kitTemplatesRaw.map((k) => ({
    id: k.id,
    name: k.name,
    description: k.description,
    items: k.items.map((it) => ({
      productId: it.productId,
      productName: it.product.name,
      quantity: it.quantity,
      unit: it.product.unit,
      warehouseStock: it.product.stockLevel,
    })),
  }));

  // Forecast for this employee — upcoming jobs × usagePerJob vs currentQuantity
  const upcomingEmployeeJobs = await db.job.count({
    where: {
      OR: [
        { employeeId: employee.id },
        { cleaners: { some: { id: employee.id } } },
      ],
      status: { in: ["CREATED", "SCHEDULED", "IN_PROGRESS"] },
      jobDate: { gte: new Date() },
    },
  });

  const inventoryRulesForForecast = await db.inventoryRule.findMany({
    include: { product: true },
  });

  const forecast = employee.assignedProducts
    .map((ep) => {
      const rule = inventoryRulesForForecast.find(
        (r) => r.productId === ep.productId
      );
      const usagePerJob = rule?.usagePerJob || 0;
      const projectedUsage = usagePerJob * upcomingEmployeeJobs;
      const deficit = Math.max(0, projectedUsage - ep.quantity);
      return {
        productId: ep.productId,
        productName: ep.product.name,
        unit: ep.product.unit,
        currentQuantity: ep.quantity,
        usagePerJob,
        refillThreshold: rule?.refillThreshold || 0,
        projectedUsage,
        deficit,
        needsRefill: deficit > 0 || ep.quantity <= (rule?.refillThreshold || 0),
      };
    })
    .filter((f) => f.usagePerJob > 0);

  const DAY_BY_INDEX = [
    "SUNDAY",
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
  ] as const;

  function toMin(t: string) {
    const [h, m] = t.split(":").map((p) => parseInt(p, 10));
    return h * 60 + m;
  }

  const availabilitySlots = employee.availabilities.map((a) => ({
    id: a.id,
    day: a.day,
    startTime: a.startTime,
    endTime: a.endTime,
    isAvailable: a.isAvailable,
    isRecurring: a.isRecurring,
  }));

  const upcomingForConflicts = employee.jobs.filter((j) => {
    if (!["CREATED", "SCHEDULED", "IN_PROGRESS"].includes(j.status)) return false;
    return new Date(j.startTime) >= now;
  });

  const conflicts = upcomingForConflicts
    .map((j) => {
      const start = new Date(j.startTime);
      const end = j.endTime ? new Date(j.endTime) : new Date(start.getTime() + 60 * 60 * 1000);
      const dayKey = DAY_BY_INDEX[start.getDay()];
      const slotsForDay = availabilitySlots.filter((s) => s.day === dayKey);
      if (slotsForDay.length === 0) return null;

      const startMin = start.getHours() * 60 + start.getMinutes();
      const endMin = end.getHours() * 60 + end.getMinutes();

      const blocked = slotsForDay.some(
        (s) =>
          !s.isAvailable && startMin < toMin(s.endTime) && endMin > toMin(s.startTime)
      );
      const covered = slotsForDay.some(
        (s) =>
          s.isAvailable && startMin >= toMin(s.startTime) && endMin <= toMin(s.endTime)
      );

      if (blocked || !covered) {
        return {
          jobId: j.id,
          clientName: j.clientName,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          reason: blocked ? "Marked unavailable" : "Outside availability hours",
        };
      }
      return null;
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const starRating = await getEmployeeAvgRating(id);

  // Accountability strikes (rolling 30-day window).
  const strikeRows = await db.cleanerStrike.findMany({
    where: { cleanerId: id },
    orderBy: { createdAt: "desc" },
    take: 60,
    include: { job: { select: { jobNumber: true } } },
  });
  const strikeSummary = await getStrikeSummary(id);
  const strikes = strikeRows.map((s) => ({
    id: s.id,
    reasonCode: s.reasonCode,
    reason: s.reason,
    // Effective status: an ACTIVE strike past its window reads as EXPIRED.
    status:
      s.status === "ACTIVE" && s.expiresAt <= now
        ? ("EXPIRED" as const)
        : s.status,
    isAuto: s.isAuto,
    adminNote: s.adminNote,
    jobNumber: s.job?.jobNumber ?? null,
    createdAt: s.createdAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    excusedAt: s.excusedAt?.toISOString() ?? null,
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
      starRating={starRating}
      availability={availabilitySlots}
      availabilityConflicts={conflicts}
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
      kitTemplates={kitTemplates}
      forecast={forecast}
      upcomingJobCount={upcomingEmployeeJobs}
      strikes={strikes}
      strikeSummary={strikeSummary}
      strikeWindowDays={STRIKE_WINDOW_DAYS}
    />
  );
}
