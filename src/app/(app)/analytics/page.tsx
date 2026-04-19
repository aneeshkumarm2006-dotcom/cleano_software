import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import AnalyticsView from "./AnalyticsView";

export default async function AnalyticsPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  const userWithRole = session.user as typeof session.user & {
    role: "OWNER" | "ADMIN" | "EMPLOYEE";
  };

  if (userWithRole.role === "EMPLOYEE") {
    redirect("/dashboard");
  }

  // Date calculations
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);

  // Fetch all data
  const [
    jobs,
    products,
    employees,
    productUsages,
    budgets,
    targets,
    alerts,
    supplierPrices,
    transactions,
    employeeProducts,
  ] = await Promise.all([
    db.job.findMany({
      include: {
        employee: { select: { id: true, name: true } },
        cleaners: { select: { id: true, name: true } },
        productUsage: {
          include: {
            product: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.product.findMany(),
    db.user.findMany({
      include: {
        cleaningJobs: {
          include: {
            productUsage: {
              include: { product: true },
            },
          },
        },
      },
    }),
    db.jobProductUsage.findMany({
      include: {
        product: true,
        job: true,
      },
    }),
    db.budget.findMany({
      orderBy: [{ period: "desc" }, { category: "asc" }],
    }),
    db.target.findMany({
      orderBy: { periodStart: "desc" },
    }),
    db.alert.findMany({
      where: { isDismissed: false },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.supplierPrice.findMany({
      include: {
        supplier: { select: { id: true, name: true } },
        product: { select: { id: true, name: true } },
      },
    }),
    db.transaction.findMany({
      orderBy: { date: "desc" },
    }),
    db.employeeProduct.findMany({
      include: {
        product: true,
      },
    }),
  ]);

  // === JOB STATS ===
  const completedJobs = jobs.filter(
    (j) => j.status === "COMPLETED" || j.status === "PAID"
  );
  const inProgressJobs = jobs.filter((j) => j.status === "IN_PROGRESS");
  const scheduledJobs = jobs.filter(
    (j) => j.status === "CREATED" || j.status === "SCHEDULED"
  );
  const cancelledJobs = jobs.filter((j) => j.status === "CANCELLED");

  // Average duration (for completed jobs with end time)
  const jobsWithDuration = completedJobs.filter((j) => j.endTime);
  const avgDuration =
    jobsWithDuration.length > 0
      ? jobsWithDuration.reduce((sum, j) => {
          const duration =
            (new Date(j.endTime!).getTime() - new Date(j.startTime).getTime()) /
            (1000 * 60);
          return sum + duration;
        }, 0) / jobsWithDuration.length
      : 0;

  const jobStats = {
    total: jobs.length,
    completed: completedJobs.length,
    inProgress: inProgressJobs.length,
    scheduled: scheduledJobs.length,
    cancelled: cancelledJobs.length,
    avgDuration,
    completionRate:
      jobs.length > 0 ? (completedJobs.length / jobs.length) * 100 : 0,
  };

  // === REVENUE STATS ===
  const totalRevenue = completedJobs.reduce(
    (sum, j) => sum + (j.price || 0),
    0
  );
  const monthlyRevenue = completedJobs
    .filter((j) => new Date(j.createdAt) >= startOfMonth)
    .reduce((sum, j) => sum + (j.price || 0), 0);
  const weeklyRevenue = completedJobs
    .filter((j) => new Date(j.createdAt) >= startOfWeek)
    .reduce((sum, j) => sum + (j.price || 0), 0);
  const avgJobPrice =
    completedJobs.length > 0 ? totalRevenue / completedJobs.length : 0;
  const totalEmployeePay = completedJobs.reduce(
    (sum, j) => sum + (j.employeePay || 0),
    0
  );
  const totalTips = completedJobs.reduce(
    (sum, j) => sum + (j.totalTip || 0),
    0
  );
  const totalParking = completedJobs.reduce(
    (sum, j) => sum + (j.parking || 0),
    0
  );
  const totalProductCost = productUsages.reduce(
    (sum, u) => sum + u.quantity * u.product.costPerUnit,
    0
  );
  const netProfit =
    totalRevenue +
    totalTips -
    totalEmployeePay -
    totalParking -
    totalProductCost;
  const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
  const pendingPaymentJobs = completedJobs.filter((j) => !j.paymentReceived);
  const pendingAmount = pendingPaymentJobs.reduce(
    (sum, j) => sum + (j.price || 0),
    0
  );

  const revenueStats = {
    totalRevenue,
    monthlyRevenue,
    weeklyRevenue,
    avgJobPrice,
    totalEmployeePay,
    totalTips,
    totalParking,
    totalProductCost,
    netProfit,
    profitMargin,
    pendingPayments: pendingPaymentJobs.length,
    pendingAmount,
  };

  // === INVENTORY STATS ===
  const lowStockProducts = products.filter((p) => p.stockLevel <= p.minStock);
  const totalInventoryValue = products.reduce(
    (sum, p) => sum + p.stockLevel * p.costPerUnit,
    0
  );
  const avgUsagePerJob =
    completedJobs.length > 0 ? totalProductCost / completedJobs.length : 0;

  // Calculate in-circulation value from employee products
  const inCirculationValue = employeeProducts.reduce(
    (sum, ep) => sum + ep.quantity * ep.product.costPerUnit,
    0
  );

  const inventoryStats = {
    totalProducts: products.length,
    totalValue: totalInventoryValue,
    lowStockCount: lowStockProducts.length,
    totalUsageCost: totalProductCost,
    avgUsagePerJob,
    inCirculationValue,
  };

  // === EMPLOYEE STATS ===
  const admins = employees.filter(
    (e) => e.role === "ADMIN" || e.role === "OWNER"
  );
  const activeEmployees = employees.filter((e) =>
    e.cleaningJobs.some((j) => j.status === "IN_PROGRESS")
  );
  const avgJobsPerEmployee =
    employees.length > 0
      ? employees.reduce((sum, e) => sum + e.cleaningJobs.length, 0) /
        employees.length
      : 0;
  const topPerformer =
    employees.length > 0
      ? employees.reduce((top, e) =>
          e.cleaningJobs.length > (top?.cleaningJobs.length || 0) ? e : top
        )?.name || null
      : null;

  const employeeStats = {
    totalEmployees: employees.length,
    admins: admins.length,
    activeNow: activeEmployees.length,
    avgJobsPerEmployee,
    topPerformer,
  };

  // === PRODUCT USAGE ===
  const productUsageMap = new Map<
    string,
    { totalUsed: number; usageCount: number; totalCost: number }
  >();
  productUsages.forEach((usage) => {
    const existing = productUsageMap.get(usage.productId) || {
      totalUsed: 0,
      usageCount: 0,
      totalCost: 0,
    };
    productUsageMap.set(usage.productId, {
      totalUsed: existing.totalUsed + usage.quantity,
      usageCount: existing.usageCount + 1,
      totalCost:
        existing.totalCost + usage.quantity * usage.product.costPerUnit,
    });
  });

  const productUsage = products
    .map((p) => {
      const usage = productUsageMap.get(p.id) || {
        totalUsed: 0,
        usageCount: 0,
        totalCost: 0,
      };
      return {
        id: p.id,
        name: p.name,
        unit: p.unit,
        totalUsed: usage.totalUsed,
        usageCount: usage.usageCount,
        totalCost: usage.totalCost,
        stockLevel: p.stockLevel,
        minStock: p.minStock,
      };
    })
    .sort((a, b) => b.totalUsed - a.totalUsed);

  // === EMPLOYEE PERFORMANCE ===
  const employeePerformance = employees
    .map((e) => {
      const empJobs = e.cleaningJobs;
      const completedEmpJobs = empJobs.filter(
        (j) => j.status === "COMPLETED" || j.status === "PAID"
      );
      const totalRevenue = completedEmpJobs.reduce(
        (sum, j) => sum + (j.price || 0),
        0
      );
      const totalPaid = completedEmpJobs.reduce(
        (sum, j) => sum + (j.employeePay || 0),
        0
      );
      const avgJobPrice =
        completedEmpJobs.length > 0
          ? totalRevenue / completedEmpJobs.length
          : 0;
      const completionRate =
        empJobs.length > 0
          ? (completedEmpJobs.length / empJobs.length) * 100
          : 0;

      return {
        id: e.id,
        name: e.name,
        totalJobs: empJobs.length,
        completedJobs: completedEmpJobs.length,
        totalRevenue,
        totalPaid,
        avgJobPrice,
        completionRate,
      };
    })
    .sort((a, b) => b.totalJobs - a.totalJobs);

  // === LOW STOCK PRODUCTS ===
  const lowStockData = lowStockProducts.map((p) => ({
    id: p.id,
    name: p.name,
    stockLevel: p.stockLevel,
    minStock: p.minStock,
    unit: p.unit,
  }));

  // === JOB TYPE BREAKDOWN ===
  const jobTypeMap = new Map<string, { count: number; revenue: number }>();
  completedJobs.forEach((job) => {
    const type = job.jobType || "Unspecified";
    const existing = jobTypeMap.get(type) || { count: 0, revenue: 0 };
    jobTypeMap.set(type, {
      count: existing.count + 1,
      revenue: existing.revenue + (job.price || 0),
    });
  });

  const jobTypeBreakdown = Array.from(jobTypeMap.entries())
    .map(([type, data]) => ({
      type,
      count: data.count,
      revenue: data.revenue,
    }))
    .sort((a, b) => b.count - a.count);

  // === MONTHLY DATA (12 months) ===
  const monthlyDataMap = new Map<
    string,
    { revenue: number; jobs: number; costs: number; period: string }
  >();

  for (let i = 11; i >= 0; i--) {
    const date = new Date();
    date.setMonth(date.getMonth() - i);
    const monthKey = date.toLocaleString("default", {
      month: "short",
      year: "2-digit",
    });
    const period = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    monthlyDataMap.set(monthKey, { revenue: 0, jobs: 0, costs: 0, period });
  }

  completedJobs.forEach((job) => {
    const date = new Date(job.createdAt);
    const monthKey = date.toLocaleString("default", {
      month: "short",
      year: "2-digit",
    });
    if (monthlyDataMap.has(monthKey)) {
      const existing = monthlyDataMap.get(monthKey)!;
      const jobProductCost = job.productUsage.reduce(
        (sum, u) => sum + u.quantity * u.product.costPerUnit,
        0
      );
      monthlyDataMap.set(monthKey, {
        ...existing,
        revenue: existing.revenue + (job.price || 0),
        jobs: existing.jobs + 1,
        costs:
          existing.costs +
          (job.employeePay || 0) +
          (job.parking || 0) +
          jobProductCost,
      });
    }
  });

  const monthlyData = Array.from(monthlyDataMap.entries()).map(
    ([month, data]) => ({
      month,
      revenue: data.revenue,
      jobs: data.jobs,
      expenses: data.costs,
      net: data.revenue - data.costs,
      profit: data.revenue - data.costs,
      period: data.period,
    })
  );

  // === RECENT JOBS ===
  const recentJobs = jobs.slice(0, 10).map((job) => ({
    id: job.id,
    clientName: job.clientName,
    status: job.status,
    price: job.price,
    date: new Date(job.createdAt).toLocaleDateString(),
    employeeName: job.employee.name,
  }));

  // === PAYMENT DATA ===
  const paymentJobs = jobs
    .filter((job) => job.employeePay && job.employeePay > 0)
    .flatMap((job) => {
      const totalPay = job.employeePay || 0;
      const allWorkers = job.cleaners.map((c) => ({ id: c.id, name: c.name }));
      if (allWorkers.length === 0) {
        return [];
      }
      const payPerWorker = totalPay / allWorkers.length;
      return allWorkers.map((worker) => ({
        id: job.id,
        employeeId: worker.id,
        employeeName: worker.name,
        employeePay: payPerWorker,
        status: job.status,
        startTime: job.startTime.toISOString(),
        endTime: job.endTime?.toISOString() || null,
        createdAt: job.createdAt.toISOString(),
        totalWorkers: allWorkers.length,
      }));
    });

  // === BUDGET VS ACTUALS ===
  const budgetVsActuals = budgets.map((budget) => {
    const periodTransactions = transactions.filter((t) => {
      const txPeriod = `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, "0")}`;
      return t.category === budget.category && txPeriod === budget.period;
    });
    const actual = periodTransactions.reduce((sum, t) => sum + t.amount, 0);
    return {
      id: budget.id,
      category: budget.category,
      period: budget.period,
      budgetAmount: budget.amount,
      actualAmount: actual,
      variance: budget.amount - actual,
      percentUsed: budget.amount > 0 ? (actual / budget.amount) * 100 : 0,
    };
  });

  // === TARGETS VS ACTUALS ===
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const currentMonthClients = new Set(
    completedJobs
      .filter((j) => new Date(j.createdAt) >= currentMonth)
      .map((j) => j.clientId || j.clientName)
  );

  const targetsWithActuals = targets.map((target) => {
    let actual = 0;
    const periodStart = new Date(target.periodStart);
    let periodEnd = new Date(periodStart);

    switch (target.period) {
      case "WEEKLY":
        periodEnd.setDate(periodEnd.getDate() + 7);
        break;
      case "MONTHLY":
        periodEnd.setMonth(periodEnd.getMonth() + 1);
        break;
      case "QUARTERLY":
        periodEnd.setMonth(periodEnd.getMonth() + 3);
        break;
      case "YEARLY":
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
        break;
    }

    const periodJobs = completedJobs.filter((j) => {
      const d = new Date(j.createdAt);
      return d >= periodStart && d < periodEnd;
    });

    switch (target.metric) {
      case "REVENUE":
        actual = periodJobs.reduce((sum, j) => sum + (j.price || 0), 0);
        break;
      case "JOBS_COMPLETED":
        actual = periodJobs.length;
        break;
      case "NEW_CLIENTS":
        actual = new Set(periodJobs.map((j) => j.clientId || j.clientName)).size;
        break;
      case "PROFIT_MARGIN": {
        const rev = periodJobs.reduce((sum, j) => sum + (j.price || 0), 0);
        const costs = periodJobs.reduce(
          (sum, j) =>
            sum +
            (j.employeePay || 0) +
            (j.parking || 0) +
            j.productUsage.reduce((s, u) => s + u.quantity * u.product.costPerUnit, 0),
          0
        );
        actual = rev > 0 ? ((rev - costs) / rev) * 100 : 0;
        break;
      }
      case "AVG_JOB_PRICE":
        actual =
          periodJobs.length > 0
            ? periodJobs.reduce((sum, j) => sum + (j.price || 0), 0) / periodJobs.length
            : 0;
        break;
      case "EMPLOYEE_RETENTION":
        actual = employees.length;
        break;
    }

    const progress =
      target.targetValue > 0 ? (actual / target.targetValue) * 100 : 0;

    return {
      id: target.id,
      metric: target.metric,
      period: target.period,
      periodStart: target.periodStart.toISOString(),
      targetValue: target.targetValue,
      actual,
      variance: actual - target.targetValue,
      progress,
      notes: target.notes,
    };
  });

  // === OVERDUE PAYMENT ALERTS ===
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const overdueJobs = completedJobs.filter(
    (j) =>
      !j.paymentReceived &&
      new Date(j.createdAt) < sevenDaysAgo
  );

  // Create overdue payment alerts for jobs not already alerted
  for (const job of overdueJobs) {
    const existingAlert = alerts.find(
      (a) =>
        a.type === "OVERDUE_PAYMENT" &&
        a.relatedId === job.id &&
        !a.isDismissed
    );
    if (!existingAlert) {
      try {
        await db.alert.create({
          data: {
            type: "OVERDUE_PAYMENT",
            severity: "WARNING",
            title: `Overdue payment: ${job.clientName}`,
            message: `Job for ${job.clientName} completed over 7 days ago and is still unpaid ($${(job.price || 0).toFixed(2)})`,
            relatedId: job.id,
            relatedType: "Job",
          },
        });
      } catch {
        // Ignore duplicate creation errors
      }
    }
  }

  // Re-fetch alerts after potential new ones were created
  const freshAlerts = await db.alert.findMany({
    where: { isDismissed: false },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  // === SUPPLIER COMPARISON DATA ===
  const supplierComparisonData: Array<Record<string, string | number>> = [];
  const supplierNames = [...new Set(supplierPrices.map((sp) => sp.supplier.name))];
  const productNames = [...new Set(supplierPrices.map((sp) => sp.product.name))];

  for (const productName of productNames) {
    const row: Record<string, string | number> = { product: productName };
    for (const supplierName of supplierNames) {
      const price = supplierPrices.find(
        (sp) => sp.product.name === productName && sp.supplier.name === supplierName
      );
      row[supplierName] = price?.price ?? 0;
    }
    supplierComparisonData.push(row);
  }

  // === INVENTORY VALUE CHART DATA ===
  const inventoryValueData = products.map((p) => {
    const empQty = employeeProducts
      .filter((ep) => ep.product.id === p.id)
      .reduce((sum, ep) => sum + ep.quantity, 0);
    return {
      name: p.name,
      warehouse: parseFloat((p.stockLevel * p.costPerUnit).toFixed(2)),
      inCirculation: parseFloat((empQty * p.costPerUnit).toFixed(2)),
    };
  }).filter((p) => p.warehouse > 0 || p.inCirculation > 0);

  // === SERIALIZE ALERTS ===
  const serializedAlerts = freshAlerts.map((a) => ({
    id: a.id,
    type: a.type,
    severity: a.severity,
    title: a.title,
    message: a.message,
    isRead: a.isRead,
    relatedId: a.relatedId,
    relatedType: a.relatedType,
    createdAt: a.createdAt.toISOString(),
  }));

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <AnalyticsView
        jobStats={jobStats}
        revenueStats={revenueStats}
        inventoryStats={inventoryStats}
        employeeStats={employeeStats}
        productUsage={productUsage}
        employeePerformance={employeePerformance}
        lowStockProducts={lowStockData}
        jobTypeBreakdown={jobTypeBreakdown}
        monthlyData={monthlyData}
        recentJobs={recentJobs}
        paymentJobs={paymentJobs}
        budgetVsActuals={budgetVsActuals}
        targetsWithActuals={targetsWithActuals}
        alerts={serializedAlerts}
        supplierComparisonData={supplierComparisonData}
        supplierNames={supplierNames}
        inventoryValueData={inventoryValueData}
      />
    </div>
  );
}
