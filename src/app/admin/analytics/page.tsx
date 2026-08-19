import { requireOwnerAdmin } from "@/lib/page-guards";
import { db } from "@/db";
import {
  getTotalRevenue,
  getEmployeeCounts,
  totalRevenueOf,
  isActiveJob,
  isCompletedJob,
  isOnHoldJob,
  isRevenueJob,
  jobRevenue,
} from "@/lib/metrics";
// Fix 3 — every figure on this page that means "what this job is worth" reads
// the ACTIVE subtotal (base + add-ons, or the override total), never the bare
// `Job.price`; every figure that means "what is still owed" reads
// `resolveAmountDue`, which is what the card is actually charged.
import { activeSubtotal } from "@/lib/job-money";
import { resolveAmountDue } from "@/lib/job-billing";
import {
  jobTypeLabel,
  jobIndustry,
  INDUSTRY_UNSPECIFIED,
  type JobIndustry,
} from "@/lib/calendar-labels";
import {
  addStoreDays,
  addStoreMonths,
  formatDate,
  startOfStoreMonth,
  startOfStoreWeek,
  storeMonthKey,
  storeMonthPeriod,
} from "@/lib/timezone";
import AnalyticsView from "./AnalyticsView";
import {
  dedupeAlertsByIdentity,
  withoutDuplicateAlerts,
} from "@/lib/alert-dedupe";
import { ANALYTICS_TABS, type AnalyticsTab } from "./tabs";
import {
  jobInDateRange,
  jobMatchesAnalyticsFilter,
  oneParam,
  parseAnalyticsFilters,
} from "./filters";

type SearchParams = Promise<{
  [key: string]: string | string[] | undefined;
}>;

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  // OWNER/ADMIN only (Stage 7.6).
  //
  // This guard used to bounce ONLY `role === "EMPLOYEE"`, which is a role that
  // cannot reach /admin/* at all — the layout redirects it first. So the check
  // was unreachable, and OPS_MANAGER and FIELD_LEAD could open this page and read
  // total revenue, profit, per-cleaner revenue and lead-source CPA, even though
  // its nav entry has always carried `adminOnly: true`. Stage 7 gives FIELD_LEAD
  // a legitimate group view whose whole premise is "no money", so the door it
  // could already walk through had to close with it.
  await requireOwnerAdmin();

  // ── Page filters (item 11 · Q7) ────────────────────────────────────────────
  // This page had no filter mechanism at all — not even a date range — so the
  // plumbing lands here once and both controls ride on it. Parsing and the
  // predicate live in ./filters so they are testable on their own and there is
  // exactly one definition of "is this job in the current view".
  const params = (await searchParams) ?? {};
  const filters = parseAnalyticsFilters(params);
  const { industry, from: fromKey, to: toKey, hasDateRange, isFiltered } =
    filters;
  const matchesFilter = (j: { jobType: string | null; startTime: Date }) =>
    jobMatchesAnalyticsFilter(j, filters);

  // The tab is carried in the URL purely so a filter change can't land the
  // owner back on Overview; the tab itself stays client state (instant).
  const tabParam = oneParam(params.tab);
  const activeTab: AnalyticsTab = ANALYTICS_TABS.includes(
    tabParam as AnalyticsTab
  )
    ? (tabParam as AnalyticsTab)
    : "overview";

  // Date calculations — store timezone, not the host's. This page renders on
  // the server (UTC), so getFullYear()/getMonth()/setHours(0) computed UTC
  // boundaries: "this month" started at 8 PM on the last day of the previous
  // month, Montréal time (Q9).
  const now = new Date();
  const startOfMonth = startOfStoreMonth(now);
  const startOfWeek = startOfStoreWeek(now);

  // Fetch all data
  const [
    allJobs,
    products,
    employees,
    productUsages,
    budgets,
    activeBudgetCategories,
    targets,
    supplierPrices,
    transactions,
    employeeProducts,
    marketingCampaigns,
    landingPages,
    pageVisitCounts,
    employeeRatings,
    // Canonical revenue + employee counts (shared helper) so Analytics agrees
    // with Dashboard/Clients/Employees. Revenue = completed+paid, discount/
    // refund applied, tax excluded, on a startTime date basis (not createdAt).
    //
    // These four used to run in a SECOND `await Promise.all` after this one.
    // They depend on nothing in it — only on `startOfMonth` / `startOfWeek`,
    // computed above — so the wait was pure serialization: a measured ~3.5 s
    // added to a page that already costs ~15-20 s of server time per render,
    // and every industry-chip click pays that bill in full (see the note in
    // AnalyticsFilterBar). Folded into the one batch.
    canonRevenue,
    canonMonthlyRevenue,
    canonWeeklyRevenue,
    employeeCounts,
  ] = await Promise.all([
    db.job.findMany({
      // Exclude archived (soft-deleted) jobs so every Analytics metric — labour
      // cost, service revenue, net profit, total jobs, jobs-by-type — matches
      // the canonical Total Revenue card and the rest of the admin dashboard.
      // Without this, deleted jobs inflated the banner ($87k) while the revenue
      // card correctly read $0.
      where: { deletedAt: null },
      include: {
        employee: { select: { id: true, name: true } },
        cleaners: { select: { id: true, name: true } },
        productUsage: {
          include: {
            product: true,
          },
        },
        // Fix 3: every revenue figure below is the sum of ACTIVE subtotals, so
        // the add-on rows must come with the job. `include` already brings
        // every scalar (subtotalAmount / bookingSource / pricingMode); this
        // relation is the one piece it does not.
        addOns: { select: { name: true, price: true, quantity: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.product.findMany(),
    db.user.findMany({
      include: {
        // Archived jobs excluded so per-employee analytics match the headline.
        cleaningJobs: {
          where: { deletedAt: null },
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
      // The category name is joined rather than denormalized so a rename in
      // Settings shows up here without a backfill (item 12 · Stage 8).
      include: { category: { select: { name: true, sortOrder: true } } },
      orderBy: [{ period: "desc" }, { category: { sortOrder: "asc" } }],
    }),
    // Stage 8.2: the Budget vs Actuals list is driven by the CATEGORY table, not
    // by which categories happen to have a Budget row. Archived ones are left
    // out of the list (their rows on Transaction/Budget are untouched — this is
    // a display filter, nothing is deleted).
    db.budgetCategory.findMany({
      where: { archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, sortOrder: true },
    }),
    db.target.findMany({
      orderBy: { periodStart: "desc" },
    }),
    // (The alert list is fetched AFTER the overdue-payment pass below, not
    // here — a pre-pass copy could only ever be stale, and the narrow
    // "already alerted?" query that pass now runs doesn't need one.)
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
    db.marketingCampaign.findMany({
      include: {
        _count: { select: { landingPages: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.landingPage.findMany({
      include: {
        campaign: { select: { id: true, name: true } },
        _count: { select: { visits: true } },
      },
    }),
    db.pageVisit.groupBy({
      by: ["landingPageId"],
      _count: true,
    }),
    db.employeeRating.findMany({
      // Admin-excluded ratings are out of every analytics average (item 5).
      where: { excludedAt: null },
      include: {
        employee: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    getTotalRevenue(),
    getTotalRevenue({ from: startOfMonth }),
    getTotalRevenue({ from: startOfWeek }),
    getEmployeeCounts(),
  ]);

  // ── Apply the filter ───────────────────────────────────────────────────────
  // Everything below that reads `jobs` now reads the FILTERED list. The two
  // deliberate exceptions keep their own names: `allJobs` feeds the industry
  // chip counts and the recurring lookup (recurrence is a property of the job,
  // not of the current view), and it feeds the overdue-payment alert pass —
  // that pass WRITES, and which alerts exist must never depend on what somebody
  // happened to be looking at.
  const jobs = allJobs.filter(matchesFilter);

  // Chip counts are computed over the date-filtered (but not industry-filtered)
  // set, so ALL always equals the sum of the positions currently on screen.
  const industryScope = allJobs.filter((j) => jobInDateRange(j, filters));
  const industryCounts = industryScope.reduce<
    Partial<Record<JobIndustry, number>>
  >((acc, j) => {
    const key = jobIndustry(j.jobType);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  // ── Recurring (item 11 · Q7 §6) ────────────────────────────────────────────
  // `Job` has no frequency column: saveJob reads `frequency` off the form,
  // generates the series and links the children by `parentJobId`, then throws
  // the frequency away. So a recurring job is one with a parent OR one with
  // children — the first booking of a series has no parent, and counting only
  // `parentJobId != null` under-counts every series by exactly one job.
  // Derived from allJobs, never the filtered list: a job doesn't stop being
  // part of a series because its siblings fall outside the date range.
  const seriesParentIds = new Set(
    allJobs.map((j) => j.parentJobId).filter((id): id is string => Boolean(id))
  );
  const isRecurringJob = (j: { id: string; parentJobId: string | null }) =>
    j.parentJobId !== null || seriesParentIds.has(j.id);
  const recurringJobs = jobs.filter(isRecurringJob);
  const recurringRevenue = recurringJobs.reduce(
    (sum, j) => (isRevenueJob(j) ? sum + jobRevenue(j) : sum),
    0
  );

  // === JOB STATS ===
  // Round 4, fixes 3 + 6. `jobStats.total` below was `jobs.length` — every row
  // in the filtered list, cancellations and unpriced holds included — which is
  // the same defect the Dashboard's Total jobs tile had, and the reason the two
  // pages could quote different-looking figures for the same idea. Both now
  // count ACTIVE work through the one predicate: `isActiveJob` here (this page
  // filters in memory, so the SQL helper can't answer it) and
  // `activeJobsWhere()` on the Dashboard, held in lockstep by design.
  const activeJobs = jobs.filter(isActiveJob);
  // Round 4, fix 1. This was a bare `status === COMPLETED || status === PAID`,
  // the exact predicate the rest of the round replaced: payment is not
  // completion, and a future job stamped PAID by an import or a card charge
  // was counted here as finished work. Caught by clicking the two pages side
  // by side — Analytics said 29 completed and 26 payments outstanding while
  // the Dashboard and the Jobs tab said 27 and 24, the same two mis-stamped
  // Aug 19 rows. `isCompletedJob` is the one predicate behind all of them, so
  // the three cannot drift again; the PDF asks for exactly that ("dashboard
  // counts and Completed filters share one status logic").
  //
  // The blast radius is wider than the tile: everything below that reduces
  // over `completedJobs` — average duration, average job price, labour cost,
  // tips, parking, net profit and the pending-payment list — was reading
  // future work as delivered work.
  const completedJobs = jobs.filter((j) => isCompletedJob(j, now));
  const inProgressJobs = jobs.filter((j) => j.status === "IN_PROGRESS");
  const scheduledJobs = jobs.filter((j) => j.status === "SCHEDULED");
  const onHoldJobs = jobs.filter(isOnHoldJob);
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
    total: activeJobs.length,
    completed: completedJobs.length,
    inProgress: inProgressJobs.length,
    scheduled: scheduledJobs.length,
    onHold: onHoldJobs.length,
    cancelled: cancelledJobs.length,
    avgDuration,
    // Over ACTIVE work too, and this one mattered most: with cancellations in
    // the denominator, a month of cancelled bookings read as a month of failed
    // completions. A cancelled job is not a job we failed to complete.
    completionRate:
      activeJobs.length > 0
        ? (completedJobs.length / activeJobs.length) * 100
        : 0,
  };

  // === REVENUE STATS ===
  // Revenue comes from the canonical helper (startTime basis, discount/refund
  // applied); the old createdAt-keyed price sums are gone.
  //
  // Under a filter the SQL helper can't answer the question — industry lives in
  // free-text `Job.jobType`, and an `in` list of every stored spelling would be
  // a second place for the fold rule to rot. So the filtered figure is summed
  // in memory with `totalRevenueOf`, the PURE twin of `revenueWhere()` that
  // metrics-shared exports for exactly this (7.5). The two are held in lockstep
  // by design and verified equal on live data ($4,017.48 both ways), so ALL
  // still reads byte-identical to the Dashboard — no jump when the filter is
  // cleared. `canonRevenue` is still fetched unfiltered and travels to the view
  // so a filtered tile can show what it is a share of.
  const totalRevenue = isFiltered ? totalRevenueOf(jobs) : canonRevenue;
  const monthlyRevenue = isFiltered
    ? totalRevenueOf(jobs.filter((j) => j.startTime >= startOfMonth))
    : canonMonthlyRevenue;
  const weeklyRevenue = isFiltered
    ? totalRevenueOf(jobs.filter((j) => j.startTime >= startOfWeek))
    : canonWeeklyRevenue;
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
  // Product cost follows the filter through the usage's own job. Applying the
  // predicate (rather than intersecting with the `jobs` id set) is deliberate:
  // with no filter it passes everything, so the unfiltered figure stays exactly
  // what it was — including usages recorded against archived jobs, which this
  // query has always counted.
  const filteredUsages = isFiltered
    ? productUsages.filter((u) => u.job && matchesFilter(u.job))
    : productUsages;
  const totalProductCost = filteredUsages.reduce(
    (sum, u) => sum + u.quantity * u.product.costPerUnit,
    0
  );
  // Stage 4b.3 / decision D3. Tips and parking are CUSTOMER-FUNDED pass-throughs
  // handed to the crew, so neither belongs in this formula: adding tips booked
  // the customer's gratuity as company profit, and subtracting parking charged
  // the company for a disbursement the customer paid for. The PDF's invariant is
  // that they "must not be treated as company revenue or incorrectly reduce
  // company profit". `totalTips` / `totalParking` are still computed above and
  // still surfaced as their own pass-through figures — they just stop moving
  // the profit line.
  const netProfit = totalRevenue - totalEmployeePay - totalProductCost;
  const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
  const pendingPaymentJobs = completedJobs.filter((j) => !j.paymentReceived);
  // What is genuinely OUTSTANDING, i.e. what these cards would take if charged
  // — the same figure chargeJob uses, deposit credited. `price` understated it
  // on every admin job (no tax) and overstated it on every web booking (the
  // referral credit came off twice).
  const pendingAmount = pendingPaymentJobs.reduce(
    (sum, j) => sum + resolveAmountDue(j),
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
  // Each employee's job list is filtered by the same predicate, so every
  // job-derived employee figure (average jobs, who's on site, the performance
  // table) answers the same question the rest of the page is answering.
  // Headcount is NOT job-derived and stays whole — an Airbnb filter must not
  // make people disappear from the payroll.
  const employeeJobs = new Map(
    employees.map((e) => [e.id, e.cleaningJobs.filter(matchesFilter)])
  );
  const jobsOf = (id: string) => employeeJobs.get(id) ?? [];

  const admins = employees.filter(
    (e) => e.role === "ADMIN" || e.role === "OWNER"
  );
  const activeEmployees = employees.filter((e) =>
    jobsOf(e.id).some((j) => j.status === "IN_PROGRESS")
  );
  const avgJobsPerEmployee =
    employees.length > 0
      ? employees.reduce((sum, e) => sum + jobsOf(e.id).length, 0) /
        employees.length
      : 0;
  const topPerformer =
    employees.length > 0
      ? employees.reduce((top, e) =>
          jobsOf(e.id).length > jobsOf(top.id).length ? e : top
        )?.name || null
      : null;

  const employeeStats = {
    // Canonical field-staff headcount (excludes CLIENT logins + soft-deleted)
    // so this agrees with Dashboard and the Employees page.
    totalEmployees: employeeCounts.active,
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
  const ratingsByEmployee = new Map<string, { sum: number; count: number }>();
  employeeRatings.forEach((r) => {
    const existing = ratingsByEmployee.get(r.employeeId) || { sum: 0, count: 0 };
    ratingsByEmployee.set(r.employeeId, {
      sum: existing.sum + r.rating,
      count: existing.count + 1,
    });
  });

  // Complaints: alerts of severity CRITICAL or low ratings (< 3) per employee
  const complaintsByEmployee = new Map<string, number>();
  employeeRatings.forEach((r) => {
    if (r.rating < 3) {
      complaintsByEmployee.set(
        r.employeeId,
        (complaintsByEmployee.get(r.employeeId) || 0) + 1
      );
    }
  });

  const employeePerformance = employees
    .filter((e) => e.role === "EMPLOYEE")
    .map((e) => {
      const empJobs = jobsOf(e.id);
      // Same guard as `completedJobs` above (round 4, fix 1) — a future job
      // stamped PAID by an import is not a job this cleaner has completed, and
      // it must not carry its price into their revenue or its estimate into
      // their average.
      const completedEmpJobs = empJobs.filter((j) => isCompletedJob(j, now));
      const totalRevenue = completedEmpJobs.reduce(
        (sum, j) => sum + activeSubtotal(j),
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

      // Avg time per job (minutes) — only completed jobs with both start and end times
      const empJobsWithDuration = completedEmpJobs.filter((j) => j.endTime);
      const avgTimePerJob =
        empJobsWithDuration.length > 0
          ? empJobsWithDuration.reduce((sum, j) => {
              const duration =
                (new Date(j.endTime!).getTime() -
                  new Date(j.startTime).getTime()) /
                (1000 * 60);
              return sum + duration;
            }, 0) / empJobsWithDuration.length
          : 0;

      const ratingAgg = ratingsByEmployee.get(e.id);
      const currentRating =
        ratingAgg && ratingAgg.count > 0 ? ratingAgg.sum / ratingAgg.count : 0;
      const ratingsCount = ratingAgg?.count || 0;
      const complaints = complaintsByEmployee.get(e.id) || 0;

      return {
        id: e.id,
        name: e.name,
        totalJobs: empJobs.length,
        completedJobs: completedEmpJobs.length,
        totalRevenue,
        totalPaid,
        avgJobPrice,
        completionRate,
        avgTimePerJob,
        currentRating,
        ratingsCount,
        complaints,
      };
    })
    .sort((a, b) => b.totalJobs - a.totalJobs);

  // === HISTORICAL RATING TREND (12 months, per employee) ===
  const ratingTrendMap = new Map<string, Map<string, { sum: number; count: number }>>();
  const trendMonthKeys: string[] = [];
  for (let i = 11; i >= 0; i--) {
    trendMonthKeys.push(storeMonthKey(addStoreMonths(now, -i)));
  }

  employeeRatings.forEach((r) => {
    // Store-timezone month bucket: a rating left at 9 PM on Jul 31 in Montréal
    // is 01:00 UTC on Aug 1, and was landing in the wrong month.
    const monthKey = storeMonthKey(r.createdAt);
    if (!trendMonthKeys.includes(monthKey)) return;
    if (!ratingTrendMap.has(r.employeeId)) {
      ratingTrendMap.set(r.employeeId, new Map());
    }
    const monthMap = ratingTrendMap.get(r.employeeId)!;
    const existing = monthMap.get(monthKey) || { sum: 0, count: 0 };
    monthMap.set(monthKey, {
      sum: existing.sum + r.rating,
      count: existing.count + 1,
    });
  });

  // Build a flat dataset: [{ month, [employeeName]: avgRating, ... }, ...]
  // Limit to top 5 employees by ratings count to keep the chart readable
  const topRatedEmployeeIds = Array.from(ratingsByEmployee.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([id]) => id);
  const topRatedEmployees = employees.filter((e) =>
    topRatedEmployeeIds.includes(e.id)
  );

  const ratingTrendData = trendMonthKeys.map((monthKey) => {
    const row: Record<string, string | number> = { month: monthKey };
    topRatedEmployees.forEach((emp) => {
      const monthMap = ratingTrendMap.get(emp.id);
      const monthData = monthMap?.get(monthKey);
      row[emp.name] =
        monthData && monthData.count > 0
          ? parseFloat((monthData.sum / monthData.count).toFixed(2))
          : 0;
    });
    return row;
  });

  const ratingTrendEmployeeNames = topRatedEmployees.map((e) => e.name);

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
    // Normalize so imported ("MOVE_IN_OUT") and manual labels collapse into one
    // official display name instead of separate rows.
    const type = job.jobType ? jobTypeLabel(job.jobType) : "Unspecified";
    const existing = jobTypeMap.get(type) || { count: 0, revenue: 0 };
    jobTypeMap.set(type, {
      count: existing.count + 1,
      revenue: existing.revenue + activeSubtotal(job),
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
    const date = addStoreMonths(now, -i);
    monthlyDataMap.set(storeMonthKey(date), {
      revenue: 0,
      jobs: 0,
      costs: 0,
      period: storeMonthPeriod(date),
    });
  }

  completedJobs.forEach((job) => {
    const monthKey = storeMonthKey(job.createdAt);
    if (monthlyDataMap.has(monthKey)) {
      const existing = monthlyDataMap.get(monthKey)!;
      const jobProductCost = job.productUsage.reduce(
        (sum, u) => sum + u.quantity * u.product.costPerUnit,
        0
      );
      monthlyDataMap.set(monthKey, {
        ...existing,
        revenue: existing.revenue + activeSubtotal(job),
        jobs: existing.jobs + 1,
        // Parking dropped per D3 — a customer-funded pass-through, not a cost.
        // Left in, the monthly expense line and the net figure beside it
        // disagreed with the job page's own net profit for the same jobs.
        costs: existing.costs + (job.employeePay || 0) + jobProductCost,
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
    price: activeSubtotal(job),
    date: formatDate(job.createdAt),
    employeeName: job.employee?.name ?? "Unassigned",
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
  //
  // Stage 8.2 requires the category list to come from `BudgetCategory`. Deriving
  // it from `budgets` meant only the categories somebody had already budgeted
  // showed up — Supplies and Labour on the live store — so Revenue, Overhead,
  // Other and every category the admin adds in Settings were simply absent, with
  // no way to tell "no spend" from "not tracked". Every ACTIVE category is
  // listed now; one without a Budget row for the period gets a zero-budget row
  // carrying its real actuals. Archived categories are not listed, and nothing
  // about their stored rows changes.
  const currentPeriod = storeMonthPeriod(now);

  /** Actual spend for one category in one `YYYY-MM` store-month period. */
  const actualFor = (categoryId: string, period: string) =>
    transactions.reduce(
      (sum, t) =>
        // Must be the store-timezone month, or a transaction dated late on the
        // last day of a month falls into the next one and misses its Budget row.
        t.categoryId === categoryId && storeMonthPeriod(t.date) === period
          ? sum + t.amount
          : sum,
      0
    );

  const activeCategoryIds = new Set(activeBudgetCategories.map((c) => c.id));
  const budgetedCategoryIds = new Set(budgets.map((b) => b.categoryId));

  const budgetRows = budgets
    // An archived category keeps its Budget rows in the database; it just does
    // not appear in this list any more.
    .filter((budget) => activeCategoryIds.has(budget.categoryId))
    .map((budget) => {
      const actual = actualFor(budget.categoryId, budget.period);
      return {
        id: budget.id,
        categoryId: budget.categoryId,
        sortOrder: budget.category.sortOrder,
        category: budget.category.name,
        period: budget.period,
        budgetAmount: budget.amount,
        actualAmount: actual,
        variance: budget.amount - actual,
        percentUsed: budget.amount > 0 ? (actual / budget.amount) * 100 : 0,
        hasBudget: true,
      };
    });

  const unbudgetedRows = activeBudgetCategories
    .filter((c) => !budgetedCategoryIds.has(c.id))
    .map((c) => {
      const actual = actualFor(c.id, currentPeriod);
      return {
        id: `nobudget-${c.id}`,
        categoryId: c.id,
        sortOrder: c.sortOrder,
        category: c.name,
        period: currentPeriod,
        budgetAmount: 0,
        actualAmount: actual,
        variance: -actual,
        percentUsed: 0,
        hasBudget: false,
      };
    });

  const budgetVsActuals = [...budgetRows, ...unbudgetedRows].sort(
    (a, b) =>
      b.period.localeCompare(a.period) ||
      a.sortOrder - b.sortOrder ||
      a.category.localeCompare(b.category)
  );

  // === TARGETS VS ACTUALS ===
  const currentMonth = startOfStoreMonth(now);
  const currentMonthClients = new Set(
    completedJobs
      .filter((j) => new Date(j.createdAt) >= currentMonth)
      .map((j) => j.clientId || j.clientName)
  );

  const targetsWithActuals = targets.map((target) => {
    let actual = 0;
    const periodStart = new Date(target.periodStart);
    // Civil-calendar arithmetic in the store timezone. setDate/setMonth here
    // stepped the host's (UTC) calendar, so a period that spanned a DST change
    // ended an hour early and dropped the last job of the window.
    let periodEnd: Date;

    switch (target.period) {
      case "WEEKLY":
        periodEnd = addStoreDays(periodStart, 7);
        break;
      case "MONTHLY":
        periodEnd = addStoreMonths(periodStart, 1);
        break;
      case "QUARTERLY":
        periodEnd = addStoreMonths(periodStart, 3);
        break;
      case "YEARLY":
        periodEnd = addStoreMonths(periodStart, 12);
        break;
      default:
        periodEnd = new Date(periodStart);
    }

    const periodJobs = completedJobs.filter((j) => {
      const d = new Date(j.createdAt);
      return d >= periodStart && d < periodEnd;
    });

    switch (target.metric) {
      case "REVENUE":
        actual = periodJobs.reduce((sum, j) => sum + activeSubtotal(j), 0);
        break;
      case "JOBS_COMPLETED":
        actual = periodJobs.length;
        break;
      case "NEW_CLIENTS":
        actual = new Set(periodJobs.map((j) => j.clientId || j.clientName)).size;
        break;
      case "PROFIT_MARGIN": {
        const rev = periodJobs.reduce((sum, j) => sum + activeSubtotal(j), 0);
        // Parking dropped per D3 — see the netProfit note above. A PROFIT_MARGIN
        // target that counted a pass-through as a cost was measuring the company
        // against a number it never spent.
        const costs = periodJobs.reduce(
          (sum, j) =>
            sum +
            (j.employeePay || 0) +
            j.productUsage.reduce((s, u) => s + u.quantity * u.product.costPerUnit, 0),
          0
        );
        actual = rev > 0 ? ((rev - costs) / rev) * 100 : 0;
        break;
      }
      case "AVG_JOB_PRICE":
        actual =
          periodJobs.length > 0
            ? periodJobs.reduce((sum, j) => sum + activeSubtotal(j), 0) / periodJobs.length
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
  // Deliberately UNFILTERED. This pass writes rows; which alerts exist must not
  // depend on whether somebody had Airbnb selected when the page rendered.
  const sevenDaysAgo = addStoreDays(now, -7);
  // Round 4, fix 1, and this one WRITES. The predicate was a bare status test,
  // so a future job stamped COMPLETED/PAID by an import or a card charge, booked
  // more than a week ago and not yet paid, minted a real "Overdue payment" alert
  // for work nobody has done. `isCompletedJob` keeps this pass in step with the
  // Dashboard's pending-payment tile, which already counts through
  // `jobStatusWhere("overdue")` — the two were answering the same question
  // differently, and only one of them left rows behind.
  const overdueJobs = allJobs.filter(
    (j) =>
      isCompletedJob(j, now) &&
      !j.paymentReceived &&
      new Date(j.createdAt) < sevenDaysAgo
  );

  // Create overdue payment alerts for jobs not already alerted.
  //
  // The "already alerted" test used to scan `alerts` — the 50 most recent
  // undismissed rows fetched above. Once the table held more than 50 of those,
  // an older job's alert fell outside the window, the lookup missed, and this
  // loop minted a NEW row for it on EVERY page load. That is the runaway behind
  // client feedback items 7 and 25: it had produced up to 19 identical
  // "Overdue payment" rows per job and accounted for the overwhelming majority
  // of the alert table. The check is now a real query over the exact job ids in
  // hand, so it cannot age out of a window.
  if (overdueJobs.length > 0) {
    const alreadyAlerted = new Set(
      (
        await db.alert.findMany({
          where: {
            type: "OVERDUE_PAYMENT",
            isDismissed: false,
            relatedId: { in: overdueJobs.map((j) => j.id) },
          },
          select: { relatedId: true },
        })
      ).map((a) => a.relatedId),
    );
    const missing = overdueJobs.filter((j) => !alreadyAlerted.has(j.id));
    if (missing.length > 0) {
      try {
        // This generator used to write straight to `createMany`, bypassing the
        // shared guard every other alert path goes through. Its own relatedId
        // check above is narrower — it cannot see a row whose content already
        // matches under a different relatedId, and it cannot dedupe within the
        // batch — so the batch is routed through `withoutDuplicateAlerts` as
        // well. Belt and braces on the path that produced the runaway.
        const fresh = await withoutDuplicateAlerts(
          missing.map((job) => ({
            type: "OVERDUE_PAYMENT" as const,
            severity: "WARNING" as const,
            title: `Overdue payment: ${job.clientName}`,
            // Job number + date, because one client legitimately has several
            // overdue jobs at once and the old wording named only the client:
            // 35 undismissed rows read "Job for Leyad Montreal completed over 7
            // days ago and is still unpaid", one per real unpaid job, with
            // nothing on the card to tell them apart or to act on. Now each row
            // is self-identifying and matches the "Job #N on <date>" wording the
            // cancellation/bulk-charge alerts already use. Existing rows keep
            // their old text — this page must not rewrite alert history.
            message: `Job #${job.jobNumber} for ${job.clientName} (${formatDate(
              job.startTime,
              { month: "short", day: "numeric" },
            )}) completed over 7 days ago and is still unpaid ($${resolveAmountDue(job).toFixed(2)})`,
            relatedId: job.id,
            relatedType: "Job",
          })),
        );
        if (fresh.length > 0) {
          await db.alert.createMany({ data: fresh });
        }
      } catch {
        // Ignore duplicate creation errors
      }
    }
  }

  // Re-fetch alerts after potential new ones were created.
  //
  // Rows written before the creation-time guards existed are still in the table
  // and we do not delete alert rows, so the list is deduped on the way out —
  // 1492 undismissed OVERDUE_PAYMENT rows are only 136 real jobs, the rest is
  // the pre-fix runaway re-minting the same job on every page load.
  //
  // No `take` on the query, and the cap is applied LAST. A `take: 250` window
  // ahead of the dedupe was the bug in the previous attempt: with duplicates
  // outnumbering originals 11:1, the newest 250 rows held only a couple of dozen
  // distinct jobs, so the tab could never reach 50 real ones no matter how many
  // were outstanding. ~1.5k narrow rows is a cheap read; the `select` keeps it
  // to the columns the card actually renders rather than the whole table.
  const alertRows = await db.alert.findMany({
    where: { isDismissed: false },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      type: true,
      severity: true,
      title: true,
      message: true,
      isRead: true,
      relatedId: true,
      relatedType: true,
      recipientUserId: true,
      employeeId: true,
      createdAt: true,
    },
  });
  const dedupedAlerts = dedupeAlertsByIdentity(alertRows);

  // Drop alerts whose Job is gone.
  //
  // Every one of the 136 distinct `relatedId`s on undismissed OVERDUE_PAYMENT
  // rows resolves to zero rows in `Job` — not soft-deleted, absent. The jobs
  // they point at were created between May and July; the earliest surviving job
  // was created Aug 4 and jobNumber starts at 1550, so the Job table was
  // replaced under the alerts. `Alert.relatedId` is a loose `String?` with no
  // FK (schema.prisma:1089), so nothing cascaded and the alerts outlived their
  // subjects. Showing an admin an overdue payment they can never open is worse
  // than showing nothing, and it would make AnalyticsView's "View job" link a
  // guaranteed 404.
  //
  // One extra query over the DEDUPED ids (136, not 1492), so no N+1. No
  // `deletedAt` filter: /admin/jobs/[id] renders archived jobs fine, so an
  // archived job is still openable and its alert still actionable.
  const jobAlertIds = [
    ...new Set(
      dedupedAlerts
        .filter((a) => a.relatedType === "Job" && a.relatedId)
        .map((a) => a.relatedId as string),
    ),
  ];
  const liveJobIds = new Set(
    jobAlertIds.length > 0
      ? (
          await db.job.findMany({
            where: { id: { in: jobAlertIds } },
            select: { id: true },
          })
        ).map((j) => j.id)
      : [],
  );
  const actionableAlerts = dedupedAlerts.filter(
    (a) =>
      a.relatedType !== "Job" ||
      !a.relatedId ||
      liveJobIds.has(a.relatedId),
  );

  // The cap is the last step, so the count beside it is the honest total and
  // the view can say when it is showing a subset (the tiles and the tab badge
  // derive from the list itself, so they already agree with what is rendered).
  const alertTotalCount = actionableAlerts.length;
  const freshAlerts = actionableAlerts.slice(0, 50);

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

  // === MARKETING DATA ===
  const totalPageVisits = pageVisitCounts.reduce((sum, v) => sum + v._count, 0);
  const activeCampaignCount = marketingCampaigns.filter(
    (c) => c.status === "ACTIVE"
  ).length;
  const publishedPageCount = landingPages.filter((lp) => lp.isPublished).length;

  const marketingData = {
    campaigns: marketingCampaigns.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      budget: c.budget,
      spent: c.spent,
      channel: c.channel,
      startDate: c.startDate?.toISOString() || null,
      endDate: c.endDate?.toISOString() || null,
      landingPageCount: c._count.landingPages,
    })),
    landingPages: landingPages.map((lp) => ({
      id: lp.id,
      title: lp.title,
      slug: lp.slug,
      isPublished: lp.isPublished,
      campaignName: lp.campaign?.name || null,
      totalVisits: lp._count.visits,
    })),
    totalPageVisits,
    activeCampaigns: activeCampaignCount,
    publishedPages: publishedPageCount,
    totalBudget: marketingCampaigns.reduce((sum, c) => sum + c.budget, 0),
    totalSpent: marketingCampaigns.reduce((sum, c) => sum + c.spent, 0),
  };

  // === RECURRING SHARE (item 11 · Q7) ===
  // Both readings ship (the Q7 recommendation): the headline is the share of
  // JOBS — what "% recurring" means operationally and the more stable figure —
  // and the sub-line is the share of REVENUE, which always reads lower because
  // recurring bookings carry 8–20% frequency discounts. Nothing to rebuild if
  // the client meant the other one.
  const recurringStats = {
    jobCount: recurringJobs.length,
    totalJobs: jobs.length,
    jobShare: jobs.length > 0 ? (recurringJobs.length / jobs.length) * 100 : 0,
    revenue: recurringRevenue,
    totalRevenue,
    revenueShare: totalRevenue > 0 ? (recurringRevenue / totalRevenue) * 100 : 0,
  };

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
    employeeId: a.employeeId,
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
        alertTotalCount={alertTotalCount}
        supplierComparisonData={supplierComparisonData}
        supplierNames={supplierNames}
        inventoryValueData={inventoryValueData}
        marketingData={marketingData}
        ratingTrendData={ratingTrendData}
        ratingTrendEmployeeNames={ratingTrendEmployeeNames}
        recurringStats={recurringStats}
        filters={{
          industry,
          from: fromKey,
          to: toKey,
          isFiltered,
          hasDateRange,
        }}
        industryCounts={industryCounts}
        unspecifiedCount={industryCounts[INDUSTRY_UNSPECIFIED] ?? 0}
        scopedJobCount={industryScope.length}
        unfilteredJobCount={allJobs.length}
        unfilteredTotalRevenue={canonRevenue}
        initialTab={activeTab}
      />
    </div>
  );
}
