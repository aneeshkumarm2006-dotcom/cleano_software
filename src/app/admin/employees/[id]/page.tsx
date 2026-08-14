import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import EmployeeDetailView from "./EmployeeDetailView";
import { jobRevenue } from "@/lib/metrics";
import { getEmployeeAvgRating } from "../../actions/setEmployeeRating";
import { getFieldLeadWeeklyBonus } from "@/lib/field-lead-bonus.server";
import { getStrikeSummary, STRIKE_WINDOW_DAYS } from "@/lib/strikes";
import { VOID_CHEQUE_KIND } from "@/lib/employee-files";
import { cleanerRestockThreshold } from "@/lib/inventory-thresholds";
import { projectUsage } from "@/lib/inventory-forecast";
import { loadPerJobAverages } from "@/lib/inventory-forecast.server";
import {
  addStoreDays,
  getStoreMinuteOfDay,
  startOfStoreDay,
  storeWeekday,
} from "@/lib/timezone";

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
        // Archived jobs stay out of this cleaner's stats, job history and
        // product-usage totals (new fix list item 1).
        where: { deletedAt: null },
        include: {
          productUsage: {
            include: {
              product: true,
            },
          },
          // Attributed revenue is the ACTIVE subtotal (fix 3), so the add-on
          // rows have to travel with the job.
          addOns: { select: { name: true, price: true, quantity: true } },
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
  // Canonical revenue attributed to this employee: completed+paid only,
  // discount/refund applied, tax excluded, soft-deleted excluded. Matches the
  // Employees list + Dashboard/Analytics (was COMPLETED-only raw price).
  const totalRevenue = employee.jobs
    .filter(
      (j) =>
        j.deletedAt === null &&
        j.paymentReceived &&
        (j.status === "COMPLETED" || j.status === "PAID")
    )
    .reduce((sum, j) => sum + jobRevenue(j), 0);
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

  // Forecast for this employee — upcoming jobs × measured per-job usage, vs
  // what is currently in their kit.
  const upcomingEmployeeJobs = await db.job.count({
    where: {
      deletedAt: null,
      OR: [
        { employeeId: employee.id },
        { cleaners: { some: { id: employee.id } } },
      ],
      status: { in: ["CREATED", "SCHEDULED", "IN_PROGRESS"] },
      jobDate: { gte: new Date() },
    },
  });

  // Same source as the Inventory page's forecast, through the same helper, so
  // the two cannot disagree about what a product costs per job (item 14).
  const avgPerJob = await loadPerJobAverages();

  const forecast = employee.assignedProducts.map((ep) => {
    const averagePerJob = avgPerJob.get(ep.productId) ?? 0;
    const projectedUsage = projectUsage(averagePerJob, upcomingEmployeeJobs);
    const deficit = Math.max(0, projectedUsage - ep.quantity);
    // This block used to read `rule?.refillThreshold` directly, bypassing
    // cleanerRestockThreshold() — so it disagreed with every other low-stock
    // surface, and would have silently read 0 once rules went away.
    const refillThreshold = cleanerRestockThreshold({
      cleanerRestockThreshold: ep.product.cleanerRestockThreshold,
    });
    return {
      productId: ep.productId,
      productName: ep.product.name,
      unit: ep.product.unit,
      currentQuantity: ep.quantity,
      averagePerJob: Math.round(averagePerJob * 100) / 100,
      refillThreshold,
      projectedUsage,
      deficit,
      needsRefill: deficit > 0 || ep.quantity <= refillThreshold,
    };
  });

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
      // Availability slots are store wall-clock ("09:00"–"17:00"), so the job
      // must be projected into the store timezone before comparison. On the
      // host (UTC) getDay()/getHours() read 4-5 hours late, which flagged
      // evening jobs against the wrong weekday's availability (Q9).
      const dayKey = DAY_BY_INDEX[storeWeekday(start)];
      const slotsForDay = availabilitySlots.filter((s) => s.day === dayKey);
      if (slotsForDay.length === 0) return null;

      const startMin = getStoreMinuteOfDay(start);
      const endMin = getStoreMinuteOfDay(end);

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
  // Excluded ratings drop out of the count, the average and the pay tier
  // (item 5) — they stay visible on the job they belong to.
  const ratingCount = await db.employeeRating.count({
    where: { employeeId: id, excludedAt: null },
  });
  const recentRatingRows = await db.employeeRating.findMany({
    where: { employeeId: id, excludedAt: null },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { job: { select: { clientName: true } } },
  });
  const recentRatings = recentRatingRows.map((r) => ({
    id: r.id,
    rating: r.rating,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
    editedAt: r.editedAt?.toISOString() ?? null,
    clientName: r.job?.clientName ?? null,
  }));

  // Field Lead group: list of possible leads (for assignment) + this cleaner's
  // current lead, and — if this cleaner IS a Field Lead — their weekly bonus.
  const fieldLeadOptions = await db.user.findMany({
    where: { cleanerTier: "FIELD_LEAD", id: { not: id } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  let weeklyBonus: {
    groupRevenue: number;
    groupAvgRating: number | null;
    bonusRate: number;
    bonusAmount: number;
    memberCount: number;
  } | null = null;
  if (employee.cleanerTier === "FIELD_LEAD") {
    // Store-timezone start of the 7-day window (today plus the 6 days before).
    const weekStart = addStoreDays(startOfStoreDay(now), -6);
    const b = await getFieldLeadWeeklyBonus(id, weekStart, now);
    weeklyBonus = {
      groupRevenue: b.groupRevenue,
      groupAvgRating: b.groupAvgRating,
      bonusRate: b.bonusRate,
      bonusAmount: b.bonusAmount,
      memberCount: Math.max(0, b.groupMemberIds.length - 1),
    };
  }

  // Equipment / refill requests from this cleaner (managed from this page).
  const requestRows = await db.inventoryRequest.findMany({
    where: { employeeId: id },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 30,
    include: {
      product: { select: { name: true, unit: true } },
      kitTemplate: { select: { name: true } },
    },
  });
  const inventoryRequests = requestRows.map((r) => ({
    id: r.id,
    itemName: r.product?.name ?? r.kitTemplate?.name ?? "Unknown item",
    isKit: !!r.kitId,
    quantity: r.quantity,
    unit: r.product?.unit ?? null,
    reason: r.reason,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  }));

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

  // Payroll paperwork this employee uploaded (awerfixes.pdf item 16). METADATA
  // ONLY — the file is reachable exclusively through `getEmployeeFileUrl`,
  // which re-checks OWNER/ADMIN and logs the access. Serialising a URL into
  // this page's props would hand out an unlogged copy of exactly what decision
  // 7 set out to control.
  const voidChequeRow = await db.employeeFile.findFirst({
    where: { employeeId: id, kind: VOID_CHEQUE_KIND },
    orderBy: { uploadedAt: "desc" },
    select: { id: true, fileName: true, mimeType: true, uploadedAt: true },
  });
  const voidCheque = voidChequeRow
    ? {
        id: voidChequeRow.id,
        fileName: voidChequeRow.fileName,
        mimeType: voidChequeRow.mimeType,
        uploadedAt: voidChequeRow.uploadedAt.toISOString(),
      }
    : null;

  return (
    <EmployeeDetailView
      employee={{
        id: employee.id,
        name: employee.name,
        email: employee.email,
        phone: employee.phone,
        role: employee.role as "OWNER" | "ADMIN" | "EMPLOYEE",
        lastSeenAt: employee.lastSeenAt?.toISOString() ?? null,
      }}
      starRating={starRating}
      cleanerTier={employee.cleanerTier}
      allowedServiceCategories={employee.allowedServiceCategories}
      ratingCount={ratingCount}
      recentRatings={recentRatings}
      fieldLeadId={employee.fieldLeadId}
      fieldLeadOptions={fieldLeadOptions}
      weeklyBonus={weeklyBonus}
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
      inventoryRequests={inventoryRequests}
      kitTemplates={kitTemplates}
      forecast={forecast}
      upcomingJobCount={upcomingEmployeeJobs}
      strikes={strikes}
      strikeSummary={strikeSummary}
      strikeWindowDays={STRIKE_WINDOW_DAYS}
      voidCheque={voidCheque}
    />
  );
}
