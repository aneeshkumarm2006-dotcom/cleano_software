"use client";

import React, { useEffect, useMemo, useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Link from "next/link";
import PremiumSelect from "@/components/ui/PremiumSelect";
import DatePicker from "@/components/ui/DatePicker";
import {
  DollarSign,
  TrendingUp,
  Briefcase,
  Package,
  Users,
  AlertTriangle,
  Calendar,
  Clock,
  CheckCircle2,
  ArrowUp,
  ArrowDown,
  BarChart3,
  Target,
  Bell,
  Megaphone,
  PieChart,
  Activity,
  Pencil,
  Trash2,
  Star,
  MessageSquare,
  Repeat,
} from "lucide-react";
import LabourCostCard from "./LabourCostCard";
import RevenueTrendChart from "./charts/RevenueTrendChart";
import InventoryValueChart from "./charts/InventoryValueChart";
import ProfitLossChart from "./charts/ProfitLossChart";
import SupplierComparisonChart from "./charts/SupplierComparisonChart";
import TargetVsActualChart from "./charts/TargetVsActualChart";
import { CBarChart, CPieChart, CLineChart } from "@/components/ui/Chart";
import { dismissAlert, markAlertRead } from "@/app/admin/actions/createAlert";
import { createTarget } from "@/app/admin/actions/createTarget";
import { updateTarget } from "@/app/admin/actions/updateTarget";
import { deleteTarget } from "@/app/admin/actions/deleteTarget";
import { fmtDate, fmtTime } from "@/lib/time";
import { formatDate, storeCivilDayRange, storeDateKey } from "@/lib/timezone";
import AnalyticsFilterBar, { type AnalyticsFilters } from "./AnalyticsFilterBar";
import { isFilterableTab, type AnalyticsTab } from "./tabs";
import { INDUSTRY_LABELS, type JobIndustry } from "@/lib/calendar-labels";

type TabView = AnalyticsTab;

const MENU_ITEMS: Array<{ id: TabView; label: string; icon: React.ReactNode }> =
  [
    { id: "overview", label: "Overview", icon: <BarChart3 className="w-4 h-4" /> },
    { id: "kpis", label: "KPIs", icon: <Activity className="w-4 h-4" /> },
    { id: "graphs", label: "Graphs", icon: <PieChart className="w-4 h-4" /> },
    { id: "budget", label: "Budget vs Actuals", icon: <DollarSign className="w-4 h-4" /> },
    { id: "targets", label: "Targets vs Actuals", icon: <Target className="w-4 h-4" /> },
    { id: "inventory", label: "Inventory", icon: <Package className="w-4 h-4" /> },
    { id: "employees", label: "Employees", icon: <Users className="w-4 h-4" /> },
    { id: "payments", label: "Payments", icon: <DollarSign className="w-4 h-4" /> },
    { id: "alerts", label: "Alerts", icon: <Bell className="w-4 h-4" /> },
    { id: "marketing", label: "Marketing", icon: <Megaphone className="w-4 h-4" /> },
  ];

// ── Types ──

interface JobStats {
  total: number;
  completed: number;
  inProgress: number;
  scheduled: number;
  cancelled: number;
  avgDuration: number;
  completionRate: number;
}

interface RevenueStats {
  totalRevenue: number;
  monthlyRevenue: number;
  weeklyRevenue: number;
  avgJobPrice: number;
  totalEmployeePay: number;
  totalTips: number;
  totalParking: number;
  totalProductCost: number;
  netProfit: number;
  profitMargin: number;
  pendingPayments: number;
  pendingAmount: number;
}

interface InventoryStats {
  totalProducts: number;
  totalValue: number;
  lowStockCount: number;
  totalUsageCost: number;
  avgUsagePerJob: number;
  inCirculationValue: number;
}

interface EmployeeStats {
  totalEmployees: number;
  admins: number;
  activeNow: number;
  avgJobsPerEmployee: number;
  topPerformer: string | null;
}

interface ProductUsage {
  id: string;
  name: string;
  unit: string;
  totalUsed: number;
  usageCount: number;
  totalCost: number;
  stockLevel: number;
  minStock: number;
}

interface EmployeePerformance {
  id: string;
  name: string;
  totalJobs: number;
  completedJobs: number;
  totalRevenue: number;
  totalPaid: number;
  avgJobPrice: number;
  completionRate: number;
  avgTimePerJob: number;
  currentRating: number;
  ratingsCount: number;
  complaints: number;
}

interface LowStockProduct {
  id: string;
  name: string;
  stockLevel: number;
  minStock: number;
  unit: string;
}

interface JobTypeBreakdown {
  type: string;
  count: number;
  revenue: number;
}

interface MonthlyData {
  month: string;
  revenue: number;
  jobs: number;
  expenses: number;
  net: number;
  profit: number;
  period: string;
}

interface PaymentJob {
  id: string;
  employeeId: string;
  employeeName: string;
  employeePay: number;
  status: string;
  startTime: string;
  endTime: string | null;
  createdAt: string;
  totalWorkers: number;
}

interface BudgetVsActual {
  id: string;
  category: string;
  period: string;
  budgetAmount: number;
  actualAmount: number;
  variance: number;
  percentUsed: number;
  /**
   * False for an active category with no Budget row for the period. Stage 8.2
   * wants the list driven by the `BudgetCategory` table, not by which
   * categories happen to have been budgeted — otherwise a category the admin
   * just created is invisible here until someone budgets it.
   */
  hasBudget: boolean;
}

interface TargetWithActual {
  id: string;
  metric: string;
  period: string;
  periodStart: string;
  targetValue: number;
  actual: number;
  variance: number;
  progress: number;
  notes: string | null;
}

interface AlertItem {
  id: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  isRead: boolean;
  relatedId: string | null;
  relatedType: string | null;
  /** Cleaner who triggered the alert (refill/equipment requests). */
  employeeId: string | null;
  createdAt: string;
}

interface MarketingCampaignData {
  id: string;
  name: string;
  status: string;
  budget: number;
  spent: number;
  channel: string | null;
  startDate: string | null;
  endDate: string | null;
  landingPageCount: number;
}

interface MarketingLandingPageData {
  id: string;
  title: string;
  slug: string;
  isPublished: boolean;
  campaignName: string | null;
  totalVisits: number;
}

interface MarketingData {
  campaigns: MarketingCampaignData[];
  landingPages: MarketingLandingPageData[];
  totalPageVisits: number;
  activeCampaigns: number;
  publishedPages: number;
  totalBudget: number;
  totalSpent: number;
}

interface RecurringStats {
  /** Recurring jobs inside the current filter. */
  jobCount: number;
  totalJobs: number;
  jobShare: number;
  revenue: number;
  totalRevenue: number;
  revenueShare: number;
}

interface AnalyticsViewProps {
  jobStats: JobStats;
  revenueStats: RevenueStats;
  inventoryStats: InventoryStats;
  employeeStats: EmployeeStats;
  productUsage: ProductUsage[];
  employeePerformance: EmployeePerformance[];
  lowStockProducts: LowStockProduct[];
  jobTypeBreakdown: JobTypeBreakdown[];
  monthlyData: MonthlyData[];
  recentJobs: Array<{
    id: string;
    clientName: string;
    status: string;
    price: number | null;
    date: string;
    employeeName: string;
  }>;
  paymentJobs: PaymentJob[];
  budgetVsActuals: BudgetVsActual[];
  targetsWithActuals: TargetWithActual[];
  alerts: AlertItem[];
  /**
   * Deduped, actionable undismissed alerts BEFORE the 50-row display cap, so
   * the tab can say "showing 50 of N" instead of implying N is 50.
   */
  alertTotalCount: number;
  supplierComparisonData: Array<Record<string, string | number>>;
  supplierNames: string[];
  inventoryValueData: Array<{ name: string; warehouse: number; inCirculation: number }>;
  marketingData?: MarketingData;
  ratingTrendData: Array<Record<string, string | number>>;
  ratingTrendEmployeeNames: string[];
  recurringStats: RecurringStats;
  filters: AnalyticsFilters;
  industryCounts: Partial<Record<JobIndustry, number>>;
  unspecifiedCount: number;
  /** Jobs inside the date range across all industries. */
  scopedJobCount: number;
  unfilteredJobCount: number;
  /** Canonical all-time revenue — what a filtered figure is a share of (7.5). */
  unfilteredTotalRevenue: number;
  initialTab: TabView;
}

// ── Reusable Sub-components ──

function SimpleBarChart({
  data,
  maxValue,
  label,
  color = "bg-[#008C9C]",
}: {
  data: { label: string; value: number }[];
  maxValue: number;
  label: string;
  color?: string;
}) {
  return (
    <div className="space-y-3">
      {label && (
        <p className="text-xs text-[#008C9C]/60 uppercase tracking-wide">
          {label}
        </p>
      )}
      {data.map((item, idx) => (
        <div key={idx} className="space-y-1">
          <div className="flex justify-between text-xs text-[#008C9C]/70">
            <span>{item.label}</span>
            <span className="font-[400]">{item.value}</span>
          </div>
          <div className="h-2 bg-[#008C9C]/10 rounded-full overflow-hidden">
            <div
              className={`h-full ${color} rounded-full transition-all duration-500`}
              style={{
                width: `${maxValue > 0 ? (item.value / maxValue) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function ProgressRing({
  value,
  max,
  label,
  size = 120,
}: {
  value: number;
  max: number;
  label: string;
  size?: number;
}) {
  const percentage = max > 0 ? (value / max) * 100 : 0;
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(0,140,156, 0.1)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#008C9C"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <div
        className="absolute flex flex-col items-center justify-center"
        style={{ width: size, height: size }}>
        <span className="text-2xl font-[400] text-[#008C9C]">
          {percentage.toFixed(0)}%
        </span>
      </div>
      <p className="text-xs text-[#008C9C]/60 mt-2">{label}</p>
    </div>
  );
}

function MetricCard({
  label,
  value,
  subValue,
  trend,
  variant = "default",
}: {
  label: string;
  value: string;
  subValue?: string;
  trend?: { value: number; isUp: boolean };
  variant?: "default" | "warning" | "success";
}) {
  return (
    <Card
      variant={
        variant === "warning"
          ? "warning"
          : variant === "success"
          ? "cleano_light"
          : "cleano_light"
      }
      className="p-6 h-[7rem]">
      <div className="h-full flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <span
            className={`app-title-small ${
              variant === "warning" ? "text-yellow-700" : "!text-[#008C9C]/70"
            }`}>
            {label}
          </span>
          {trend && (
            <div
              className={`flex items-center gap-1 text-xs ${
                trend.isUp ? "text-green-600" : "text-red-600"
              }`}>
              {trend.isUp ? (
                <ArrowUp className="w-3 h-3" />
              ) : (
                <ArrowDown className="w-3 h-3" />
              )}
              {trend.value}%
            </div>
          )}
        </div>
        <div>
          <p
            className={`h2-title ${
              variant === "warning" ? "text-yellow-700" : "text-[#008C9C]"
            }`}>
            {value}
          </p>
          {subValue && (
            <p className="text-xs text-[#008C9C]/60 mt-0.5">{subValue}</p>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Design-system helpers (match the analytics mockup) ──
function AnStat({ icon: Icon, label, value, delta, deltaUp, hint }: {
  icon?: React.ElementType; label: string; value: React.ReactNode;
  delta?: string; deltaUp?: boolean; hint?: string;
}) {
  return (
    <div className="astat">
      <div className="astat-head">
        <span>{label}</span>
        {Icon && <span className="astat-icon"><Icon size={15} /></span>}
      </div>
      <div className="astat-value">{value}</div>
      {(delta || hint) && (
        <div className="astat-delta">
          {delta && <strong style={deltaUp ? { color: "var(--emerald-600)" } : undefined}>{delta}</strong>}
          {delta && hint ? " · " : ""}
          {hint}
        </div>
      )}
    </div>
  );
}
function AnTile({ label, value, hint, accent }: {
  label: string; value: React.ReactNode; hint?: string; accent?: string;
}) {
  return (
    <div className="an-tile">
      <div className="an-tile-label">{label}</div>
      <div className="an-tile-value" style={accent ? { color: accent } : undefined}>{value}</div>
      {hint && <div className="an-tile-hint">{hint}</div>}
    </div>
  );
}
function AnPanel({ title, sub, action, children, style }: {
  title?: string; sub?: string; action?: React.ReactNode;
  children: React.ReactNode; style?: React.CSSProperties;
}) {
  return (
    <div className="dcard" style={{ gap: 18, ...style }}>
      {(title || action) && (
        <div className="dcard-head" style={{ alignItems: "flex-start" }}>
          <div>
            {title && <h3>{title}</h3>}
            {sub && <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--primary-60)" }}>{sub}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

// ── Main Component ──

export default function AnalyticsView({
  jobStats,
  revenueStats,
  inventoryStats,
  employeeStats,
  productUsage,
  employeePerformance,
  lowStockProducts,
  jobTypeBreakdown,
  monthlyData,
  recentJobs,
  paymentJobs,
  budgetVsActuals,
  targetsWithActuals,
  alerts,
  alertTotalCount,
  supplierComparisonData,
  supplierNames,
  inventoryValueData,
  marketingData,
  ratingTrendData,
  ratingTrendEmployeeNames,
  recurringStats,
  filters,
  industryCounts,
  unspecifiedCount,
  scopedJobCount,
  unfilteredJobCount,
  unfilteredTotalRevenue,
  initialTab,
}: AnalyticsViewProps) {
  // The tab stays client state so switching tabs is instant — only the FILTER
  // costs a server round-trip. `initialTab` seeds it from `?tab=`, which the
  // filter bar writes, so a filter change can't land the owner on Overview
  // even if the navigation remounts this tree.
  const [activeView, setActiveView] = useState<TabView>(initialTab);

  // Keep `?tab=` honest without paying for a navigation. The native History
  // API is the supported way to change search params in the App Router without
  // re-running the server component — a `router.replace` here would refetch all
  // 14 queries on every tab click, which is exactly the instant-feeling
  // behaviour this page already had and must keep.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if ((params.get("tab") ?? "overview") === activeView) return;
    if (activeView === "overview") params.delete("tab");
    else params.set("tab", activeView);
    const qs = params.toString();
    window.history.replaceState(
      null,
      "",
      qs ? `${window.location.pathname}?${qs}` : window.location.pathname
    );
  }, [activeView]);

  // Whether a non-job-derived panel should say so. Only worth the noise once a
  // filter is actually on — an unfiltered page has nothing to disclaim.
  const showsFilter = isFilterableTab(activeView);
  const unfilteredNote = filters.isFiltered ? " · not affected by filters" : "";
  const industryNote =
    filters.industry !== "ALL" ? INDUSTRY_LABELS[filters.industry] : null;
  // With a date range on, "this month" is the intersection of the range and the
  // current month — usually zero, and it reads as a broken tile. Say what the
  // number actually is instead.
  const revenueHint = filters.hasDateRange ? "in selected range" : "this month";

  // Alerts render from a server component, so Dismiss / Mark read only take
  // effect once the page revalidates. These overrides make the row respond
  // immediately and roll back if the action fails — previously the result was
  // discarded entirely, so a failed call was indistinguishable from a dead
  // button (which is exactly how it read: "the count stays at 49"). Lives here
  // rather than inside AlertsTab because that's a nested component and remounts
  // on every parent render.
  const [alertOverrides, setAlertOverrides] = useState<
    Record<string, "read" | "dismissed">
  >({});
  const [alertError, setAlertError] = useState<string | null>(null);
  const [pendingAlertId, setPendingAlertId] = useState<string | null>(null);

  // The optimistic view of the server-rendered list: dismissed rows drop out,
  // marked-read rows lose their NEW badge, both before the round-trip lands.
  // Derived HERE and not inside AlertsTab so that everything counting alerts —
  // the tiles, and the count on the Alerts tab itself — reads the same list.
  // The tab badge used to count the raw `alerts` prop, so dismissing an unread
  // alert moved the tiles (50→49, unread 49→48) and left the badge stuck on 49
  // until the page revalidated.
  const visibleAlerts = useMemo(
    () =>
      alerts
        .filter((a) => alertOverrides[a.id] !== "dismissed")
        .map((a) =>
          alertOverrides[a.id] === "read" ? { ...a, isRead: true } : a
        ),
    [alerts, alertOverrides]
  );
  const unreadAlertCount = visibleAlerts.filter((a) => !a.isRead).length;

  // The server dedupes the whole undismissed set and only then caps the list at
  // 50, so `alertTotalCount` can exceed what is rendered. Say so rather than
  // letting the tile read "50" as if that were the total. Optimistic dismissals
  // come off the total too, or the tile would drift from the list.
  const totalAlertCount = Math.max(
    visibleAlerts.length,
    alertTotalCount - (alerts.length - visibleAlerts.length)
  );

  const clearAlertOverride = (id: string) =>
    setAlertOverrides((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  const handleDismissAlert = async (id: string) => {
    setAlertError(null);
    setPendingAlertId(id);
    setAlertOverrides((prev) => ({ ...prev, [id]: "dismissed" }));
    const res = await dismissAlert(id);
    setPendingAlertId(null);
    if (!res.success) {
      clearAlertOverride(id);
      setAlertError(res.error ?? "Failed to dismiss alert");
    }
  };

  const handleMarkAlertRead = async (id: string) => {
    setAlertError(null);
    setPendingAlertId(id);
    setAlertOverrides((prev) => ({ ...prev, [id]: "read" }));
    const res = await markAlertRead(id);
    setPendingAlertId(null);
    if (!res.success) {
      clearAlertOverride(id);
      setAlertError(res.error ?? "Failed to mark alert as read");
    }
  };

  // ── % recurring (item 11 · Q7) ──
  // A recurring job is one with a parent OR one with children — the frequency
  // itself is never stored on Job. Both readings ship: the headline is the
  // share of JOBS, the sub-line the share of REVENUE (always lower, because
  // recurring bookings carry 8–20% frequency discounts). The tile answers to
  // the industry filter, which is the "total and just residential" of the
  // client's written note.
  const RecurringStat = () => (
    <AnStat
      icon={Repeat}
      label="% recurring"
      value={`${recurringStats.jobShare.toFixed(0)}%`}
      delta={`${recurringStats.revenueShare.toFixed(0)}% of revenue`}
      hint={
        recurringStats.jobCount > 0
          ? `${recurringStats.jobCount} of ${recurringStats.totalJobs} jobs`
          : `no series in ${recurringStats.totalJobs} jobs`
      }
    />
  );

  // ── Tab 1: Overview ──
  const OverviewTab = () => (
    <div className="stack-18">
      <div className="astat-grid astat-grid-5">
        {/* Unfiltered, this is `getTotalRevenue()` — the canonical helper that
            keeps Analytics agreeing with the Dashboard to the cent. Filtered,
            it is the same predicate applied in memory, and the hint names the
            whole it is a share of so the two readings can't be confused (7.5). */}
        <AnStat
          icon={DollarSign}
          label="Total revenue"
          value={`$${revenueStats.totalRevenue.toFixed(0)}`}
          delta={`$${revenueStats.monthlyRevenue.toFixed(0)}`}
          deltaUp
          hint={
            filters.isFiltered
              ? `${revenueHint} · $${unfilteredTotalRevenue.toFixed(0)} unfiltered`
              : revenueHint
          }
        />
        <AnStat icon={TrendingUp} label="Net profit" value={`$${revenueStats.netProfit.toFixed(0)}`} delta={`${revenueStats.profitMargin.toFixed(0)}%`} hint="margin" />
        <AnStat icon={Briefcase} label="Total jobs" value={jobStats.total} delta={`${jobStats.completed}`} hint="completed" />
        <RecurringStat />
        <AnStat icon={AlertTriangle} label="Pending payments" value={`$${revenueStats.pendingAmount.toFixed(0)}`} hint={`${revenueStats.pendingPayments} jobs outstanding`} />
      </div>

      <div className="an-grid-2">
        <AnPanel title="Revenue trend" sub="Monthly service revenue (12 mo)">
          <RevenueTrendChart data={monthlyData} />
        </AnPanel>
        <AnPanel
          title="Jobs by type"
          sub={industryNote ? `${industryNote} mix` : "All-time mix"}>
          {jobTypeBreakdown.length > 0 ? (
            <SimpleBarChart
              data={jobTypeBreakdown.map((j) => ({ label: j.type || "Unspecified", value: j.count }))}
              maxValue={Math.max(...jobTypeBreakdown.map((j) => j.count))}
              label=""
            />
          ) : (
            <div className="an-empty">No job data for this filter</div>
          )}
        </AnPanel>
      </div>

      <div className="astat-grid">
        <AnTile label="Employees" value={employeeStats.totalEmployees} hint={`${employeeStats.activeNow} active now`} />
        <AnTile
          label="Products"
          value={inventoryStats.totalProducts}
          hint={`$${inventoryStats.totalValue.toFixed(0)} value${unfilteredNote}`}
        />
        <AnTile label="Avg job price" value={`$${revenueStats.avgJobPrice.toFixed(0)}`} hint="completed only" />
        <AnTile
          label="Low stock"
          value={lowStockProducts.length}
          hint={`${lowStockProducts.length ? "needs refill" : "all stocked"}${unfilteredNote}`}
          accent={lowStockProducts.length ? "var(--amber-700)" : undefined}
        />
      </div>
    </div>
  );

  // ── Tab 2: KPIs ──
  const KPIsTab = () => {
    const kpis = [
      // With a date range on, "this month" is the intersection of the range and
      // the calendar month — normally $0.00, which reads as a dead tile. The
      // honest reading under a range is the range total itself.
      filters.hasDateRange
        ? {
            label: "Revenue in Range",
            value: `$${revenueStats.totalRevenue.toFixed(2)}`,
            subValue: "Selected date range",
            icon: <DollarSign className="w-5 h-5" />,
          }
        : {
            label: "Revenue This Month",
            value: `$${revenueStats.monthlyRevenue.toFixed(2)}`,
            subValue: `$${revenueStats.weeklyRevenue.toFixed(2)} this week`,
            icon: <DollarSign className="w-5 h-5" />,
          },
      {
        label: "Profit Margin",
        value: `${revenueStats.profitMargin.toFixed(1)}%`,
        subValue: `$${revenueStats.netProfit.toFixed(2)} net profit`,
        icon: <TrendingUp className="w-5 h-5" />,
      },
      {
        label: "Job Completion Rate",
        value: `${jobStats.completionRate.toFixed(1)}%`,
        subValue: `${jobStats.completed} of ${jobStats.total} jobs`,
        icon: <CheckCircle2 className="w-5 h-5" />,
      },
      {
        label: "Avg Job Duration",
        value: `${jobStats.avgDuration.toFixed(0)} min`,
        subValue: `Across ${jobStats.completed} completed jobs`,
        icon: <Clock className="w-5 h-5" />,
      },
      {
        label: "Avg Revenue per Job",
        value: `$${revenueStats.avgJobPrice.toFixed(2)}`,
        subValue: `Total: $${revenueStats.totalRevenue.toFixed(2)}`,
        icon: <DollarSign className="w-5 h-5" />,
      },
      {
        label: "Employee Productivity",
        value: `${employeeStats.avgJobsPerEmployee.toFixed(1)}`,
        subValue: `Jobs per employee avg`,
        icon: <Users className="w-5 h-5" />,
      },
      {
        label: "Avg Product Cost / Job",
        value: `$${inventoryStats.avgUsagePerJob.toFixed(2)}`,
        subValue: `Total: $${inventoryStats.totalUsageCost.toFixed(2)}`,
        icon: <Package className="w-5 h-5" />,
      },
      {
        label: "Pending Collections",
        value: `$${revenueStats.pendingAmount.toFixed(2)}`,
        subValue: `${revenueStats.pendingPayments} unpaid jobs`,
        icon: <AlertTriangle className="w-5 h-5" />,
      },
    ];

    return (
      <div className="stack-18">
        <div className="an-kpi-grid">
          {kpis.map((kpi, idx) => (
            <div key={idx} className="astat">
              <div className="astat-head"><span>{kpi.label}</span></div>
              <div className="astat-value">{kpi.value}</div>
              <div className="astat-delta">{kpi.subValue}</div>
            </div>
          ))}
        </div>

        <div className="an-grid-2">
          <AnPanel title="Completion rate">
            <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}>
              <ProgressRing value={jobStats.completed} max={jobStats.total} label="Jobs completed" size={140} />
            </div>
          </AnPanel>
          <AnPanel title="Payments collected">
            <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}>
              <ProgressRing value={jobStats.completed - revenueStats.pendingPayments} max={jobStats.completed} label="Collected" size={140} />
            </div>
          </AnPanel>
        </div>
      </div>
    );
  };

  // ── Tab 3: Graphs ──
  const GraphsTab = () => (
    <div className="stack-18">
      <AnPanel title="Revenue trend" sub="Monthly service revenue (12 mo)">
        <RevenueTrendChart data={monthlyData} />
      </AnPanel>
      <AnPanel title="Profit & loss by month" sub="Revenue · cost · profit">
        <ProfitLossChart data={monthlyData} />
      </AnPanel>
      <div className="an-grid-2">
        {/* Inventory, suppliers and targets have no industry or job-date
            dimension. They live on this tab, so they say so rather than
            looking like a filter that didn't take. */}
        <AnPanel
          title="Inventory value"
          sub={`Warehouse vs in-circulation${unfilteredNote}`}>
          <InventoryValueChart data={inventoryValueData} />
        </AnPanel>
        <AnPanel
          title="Supplier price comparison"
          sub={`Unit cost across suppliers${unfilteredNote}`}>
          <SupplierComparisonChart data={supplierComparisonData} supplierNames={supplierNames} />
        </AnPanel>
      </div>
      {targetsWithActuals.length > 0 && (
        <AnPanel
          title="Targets vs actuals"
          sub={filters.isFiltered ? "Not affected by filters" : undefined}>
          <TargetVsActualChart
            data={targetsWithActuals.map((t) => ({
              metric: t.metric.replace(/_/g, " "),
              target: t.targetValue,
              actual: t.actual,
            }))}
          />
        </AnPanel>
      )}
    </div>
  );

  // ── Tab 4: Budget vs Actuals ──
  const BudgetTab = () => {
    const totalBudget = budgetVsActuals.reduce((s, b) => s + b.budgetAmount, 0);
    const totalActual = budgetVsActuals.reduce((s, b) => s + b.actualAmount, 0);
    const totalVariance = budgetVsActuals.reduce((s, b) => s + b.variance, 0);
    return (
      <div className="stack-18">
        {budgetVsActuals.length > 0 ? (
          <>
            <div className="astat-grid">
              <AnTile label="Total budgeted" value={`$${totalBudget.toFixed(2)}`} />
              <AnTile label="Total actual" value={`$${totalActual.toFixed(2)}`} />
              <AnTile
                label="Total variance"
                value={`${totalVariance < 0 ? "-" : "+"}$${Math.abs(totalVariance).toFixed(2)}`}
                accent={totalVariance < 0 ? "var(--error)" : "var(--emerald-600)"}
                hint={totalVariance < 0 ? "Over budget" : "Under budget"}
              />
            </div>

            <AnPanel title="Budget vs actual" sub="Spending by category">
              <CBarChart
                data={budgetVsActuals.map((b) => ({
                  name: `${b.category} (${b.period})`,
                  Budget: b.budgetAmount,
                  Actual: b.actualAmount,
                }))}
                dataKeys={["Budget", "Actual"]}
                xKey="name"
                height={300}
              />
            </AnPanel>

            <AnPanel title="By category">
              <div className="stack-16">
                {budgetVsActuals.map((b) => {
                  const overBudget = b.percentUsed > 100;
                  return (
                    <div key={b.id} className="an-budrow">
                      <div className="an-budrow-head">
                        <div>
                          <div className="an-budrow-name">{b.category}</div>
                          <div className="an-budrow-sub">
                            {b.hasBudget ? b.period : `${b.period} · no budget set`}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: 10 }}>
                          <span className="an-budrow-name">
                            ${b.actualAmount.toFixed(2)} / ${b.budgetAmount.toFixed(2)}
                          </span>
                          <span className={`pill ${overBudget ? "pill-rose" : "pill-emerald"}`}>
                            {b.percentUsed.toFixed(0)}%
                          </span>
                        </div>
                      </div>
                      <div className="an-progress">
                        <div
                          className="an-progress-fill"
                          style={{
                            width: `${Math.min(b.percentUsed, 100)}%`,
                            background: overBudget ? "var(--error)" : "var(--primary)",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </AnPanel>
          </>
        ) : (
          <div className="an-empty">
            <div className="an-empty-icon"><DollarSign size={26} /></div>
            <h3 className="title-sm">No budgets configured yet</h3>
            <p className="subtitle" style={{ fontSize: 13.5, margin: 0 }}>
              Set up budgets in the Finances module to see comparisons here.
            </p>
          </div>
        )}
      </div>
    );
  };

  // ── Tab 5: Targets vs Actuals ──
  const TargetsTab = () => {
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [targetMetric, setTargetMetric] = useState("REVENUE");
    const [targetPeriod, setTargetPeriod] = useState("MONTHLY");
    const [targetPeriodStart, setTargetPeriodStart] = useState("");

    const metricLabels: Record<string, string> = {
      REVENUE: "Revenue",
      JOBS_COMPLETED: "Jobs Completed",
      NEW_CLIENTS: "New Clients",
      PROFIT_MARGIN: "Profit Margin (%)",
      AVG_JOB_PRICE: "Avg Job Price",
      EMPLOYEE_RETENTION: "Employee Count",
    };

    return (
      <div className="stack-18">
        <div className="dcard-head" style={{ alignItems: "flex-start" }}>
          <div>
            <p className="eyebrow">Goals</p>
            <h3 style={{ margin: "2px 0 0" }}>Business targets</h3>
          </div>
          <button
            type="button"
            className={`btn btn-sm ${showForm ? "btn-secondary" : "btn-primary"}`}
            onClick={() => setShowForm(!showForm)}>
            {showForm ? "Cancel" : "Add target"}
          </button>
        </div>

        {showForm && (
          <AnPanel>
            <form
              action={async (formData) => {
                await createTarget(formData);
                setShowForm(false);
              }}
              className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-[350] text-[#008C9C]/70 uppercase tracking-wide mb-1 block">
                    Metric
                  </label>
                  <PremiumSelect
                    name="metric"
                    value={targetMetric}
                    onChange={setTargetMetric}
                    options={[
                      { value: "REVENUE", label: "Revenue" },
                      { value: "JOBS_COMPLETED", label: "Jobs Completed" },
                      { value: "NEW_CLIENTS", label: "New Clients" },
                      { value: "PROFIT_MARGIN", label: "Profit Margin (%)" },
                      { value: "AVG_JOB_PRICE", label: "Avg Job Price" },
                      { value: "EMPLOYEE_RETENTION", label: "Employee Count" },
                    ]}
                    size="sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-[350] text-[#008C9C]/70 uppercase tracking-wide mb-1 block">
                    Period
                  </label>
                  <PremiumSelect
                    name="period"
                    value={targetPeriod}
                    onChange={setTargetPeriod}
                    options={[
                      { value: "WEEKLY", label: "Weekly" },
                      { value: "MONTHLY", label: "Monthly" },
                      { value: "QUARTERLY", label: "Quarterly" },
                      { value: "YEARLY", label: "Yearly" },
                    ]}
                    size="sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-[350] text-[#008C9C]/70 uppercase tracking-wide mb-1 block">
                    Period Start
                  </label>
                  <DatePicker
                    name="periodStart"
                    value={targetPeriodStart}
                    onChange={setTargetPeriodStart}
                    size="sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-[350] text-[#008C9C]/70 uppercase tracking-wide mb-1 block">
                    Target Value
                  </label>
                  <input
                    type="number"
                    name="targetValue"
                    step="0.01"
                    required
                    className="w-full px-4 py-2.5 rounded-xl border border-[#008C9C]/10 bg-white text-sm text-[#008C9C] focus:outline-none focus:ring-2 focus:ring-[#008C9C]/20"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-[350] text-[#008C9C]/70 uppercase tracking-wide mb-1 block">
                  Notes
                </label>
                <input
                  type="text"
                  name="notes"
                  className="w-full px-4 py-2.5 rounded-xl border border-[#008C9C]/10 bg-white text-sm text-[#008C9C] focus:outline-none focus:ring-2 focus:ring-[#008C9C]/20"
                />
              </div>
              <Button
                type="submit"
                variant="action"
                size="sm"
                border={false}
                className="rounded-xl px-6 py-2">
                Create Target
              </Button>
            </form>
          </AnPanel>
        )}

        {targetsWithActuals.length > 0 ? (
          <>
            <AnPanel title="Target progress" sub="Actual vs target by metric">
              <TargetVsActualChart
                data={targetsWithActuals.map((t) => ({
                  metric: metricLabels[t.metric] || t.metric,
                  target: t.targetValue,
                  actual: t.actual,
                }))}
              />
            </AnPanel>

            <div className="an-grid-2">
              {targetsWithActuals.map((target) => {
                const hit = target.progress >= 100;
                const fillColor = hit
                  ? "var(--emerald-600)"
                  : target.progress >= 80
                  ? "var(--amber-600)"
                  : "var(--primary)";

                const isEditing = editingId === target.id;
                const isConfirmingDelete = deletingId === target.id;
                const valuePrecision = target.metric === "PROFIT_MARGIN" ? 1 : 2;

                return (
                  <div key={target.id} className="dcard" style={{ gap: 12 }}>
                    <div className="row-between" style={{ alignItems: "flex-start" }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>
                          {metricLabels[target.metric] || target.metric}
                        </h3>
                        <div style={{ fontSize: 12, color: "var(--primary-60)", marginTop: 2 }}>
                          {target.period} from {formatDate(target.periodStart)}
                        </div>
                      </div>
                      {!isEditing && !isConfirmingDelete && (
                        <div className="row" style={{ gap: 4 }}>
                          <button
                            type="button"
                            className="icon-btn"
                            style={{ width: 28, height: 28 }}
                            aria-label="Edit target"
                            title="Edit target"
                            onClick={() => {
                              setDeletingId(null);
                              setEditingId(target.id);
                            }}>
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            style={{ width: 28, height: 28, color: "var(--error)" }}
                            aria-label="Delete target"
                            title="Delete target"
                            onClick={() => {
                              setEditingId(null);
                              setDeletingId(target.id);
                            }}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="row-between" style={{ alignItems: "flex-end" }}>
                      <div style={{ fontFamily: "var(--font-serif)", fontSize: 28, color: "var(--ink)", lineHeight: 1 }}>
                        {target.actual.toFixed(valuePrecision)}
                      </div>
                      <div style={{ fontSize: 13, color: "var(--primary-60)" }}>
                        of {target.targetValue.toFixed(valuePrecision)}
                      </div>
                    </div>
                    <div className="an-progress">
                      <div
                        className="an-progress-fill"
                        style={{ width: `${Math.min(target.progress, 100)}%`, background: fillColor }}
                      />
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: hit ? "var(--emerald-600)" : "var(--primary-60)" }}>
                      {hit
                        ? "✓ Target met"
                        : `${target.progress.toFixed(0)}% of target · variance ${target.variance >= 0 ? "+" : ""}${target.variance.toFixed(2)}`}
                    </div>
                    {target.notes && !isEditing && (
                      <div style={{ fontSize: 12, color: "var(--primary-50)" }}>{target.notes}</div>
                    )}

                    {isEditing && (
                      <form
                        action={async (formData) => {
                          await updateTarget(formData);
                          setEditingId(null);
                        }}
                        className="mt-4 pt-4 border-t border-[#008C9C]/10 space-y-3">
                        <input type="hidden" name="targetId" value={target.id} />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs font-[350] text-[#008C9C]/70 uppercase tracking-wide mb-1 block">
                              Target Value
                            </label>
                            <input
                              type="number"
                              name="targetValue"
                              step="0.01"
                              required
                              defaultValue={target.targetValue}
                              className="w-full px-4 py-2.5 rounded-xl border border-[#008C9C]/10 bg-white text-sm text-[#008C9C] focus:outline-none focus:ring-2 focus:ring-[#008C9C]/20"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-[350] text-[#008C9C]/70 uppercase tracking-wide mb-1 block">
                              Notes
                            </label>
                            <input
                              type="text"
                              name="notes"
                              defaultValue={target.notes ?? ""}
                              className="w-full px-4 py-2.5 rounded-xl border border-[#008C9C]/10 bg-white text-sm text-[#008C9C] focus:outline-none focus:ring-2 focus:ring-[#008C9C]/20"
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            type="submit"
                            variant="action"
                            size="sm"
                            border={false}
                            className="rounded-xl px-4 py-2">
                            Save Changes
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            border={false}
                            onClick={() => setEditingId(null)}
                            className="rounded-xl px-4 py-2">
                            Cancel
                          </Button>
                        </div>
                      </form>
                    )}

                    {isConfirmingDelete && (
                      <div className="mt-4 pt-4 border-t border-[#008C9C]/10 flex items-center justify-between gap-3 flex-wrap">
                        <p className="text-xs text-[#008C9C]/70">
                          Delete this target? This cannot be undone.
                        </p>
                        <form
                          action={async (formData) => {
                            await deleteTarget(formData);
                            setDeletingId(null);
                          }}
                          className="flex items-center gap-2">
                          <input type="hidden" name="targetId" value={target.id} />
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            border={false}
                            onClick={() => setDeletingId(null)}
                            className="rounded-xl px-4 py-2">
                            Cancel
                          </Button>
                          <Button
                            type="submit"
                            variant="destructive"
                            size="sm"
                            border={false}
                            className="rounded-xl px-4 py-2">
                            Delete
                          </Button>
                        </form>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="an-empty">
            <div className="an-empty-icon"><Target size={26} /></div>
            <h3 className="title-sm">No targets set yet</h3>
            <p className="subtitle" style={{ fontSize: 13.5, margin: 0 }}>
              Click &quot;Add target&quot; to create your first business target.
            </p>
          </div>
        )}
      </div>
    );
  };

  // ── Tab 6: Inventory ──
  const InventoryTab = () => (
    <div className="stack-18">
      <div className="astat-grid">
        <AnTile label="Total products" value={String(inventoryStats.totalProducts)} />
        <AnTile label="Warehouse value" value={`$${inventoryStats.totalValue.toFixed(2)}`} />
        <AnTile label="In circulation" value={`$${inventoryStats.inCirculationValue.toFixed(2)}`} />
        <AnTile
          label="Low stock items"
          value={String(inventoryStats.lowStockCount)}
          accent={inventoryStats.lowStockCount > 0 ? "var(--amber-600)" : undefined}
        />
      </div>

      <div className="an-grid-2">
        <AnPanel title="Most used products" sub="By consumption value">
          {productUsage.length > 0 ? (
            <div className="an-list">
              {productUsage.slice(0, 5).map((product, idx) => (
                <Link key={product.id} href={`/admin/inventory/${product.id}`} className="an-listrow">
                  <div className="an-listrow-main">
                    <span className="an-rank">#{idx + 1}</span>
                    <div>
                      <div className="an-listrow-name">{product.name}</div>
                      <div className="an-listrow-sub">{product.totalUsed.toFixed(1)} {product.unit} used</div>
                    </div>
                  </div>
                  <div className="an-listrow-val">${product.totalCost.toFixed(2)}</div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="an-listempty">No usage data yet</div>
          )}
        </AnPanel>

        <AnPanel
          title="Low stock alert"
          sub="Below minimum threshold"
          action={
            lowStockProducts.length > 0 ? (
              <span className="pill pill-rose">{lowStockProducts.length} low</span>
            ) : undefined
          }>
          {lowStockProducts.length > 0 ? (
            <div className="an-scroll">
              <div className="an-list">
                {lowStockProducts.map((product) => (
                  <Link key={product.id} href={`/admin/inventory/${product.id}`} className="an-listrow warn">
                    <div>
                      <div className="an-listrow-name">{product.name}</div>
                      <div className="an-listrow-sub">{product.unit}</div>
                    </div>
                    <span className="pill pill-amber">{product.stockLevel} / {product.minStock} {product.unit}</span>
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <div className="an-listempty" style={{ flexDirection: "column", gap: 10, padding: "28px 0" }}>
              <span className="an-empty-icon" style={{ width: 44, height: 44, margin: 0, background: "rgba(5,150,105,0.10)", color: "var(--emerald-600)" }}>
                <CheckCircle2 size={22} />
              </span>
              All stock levels OK
            </div>
          )}
        </AnPanel>
      </div>

      <AnPanel title="Inventory value distribution" sub="Warehouse vs in-circulation">
        <InventoryValueChart data={inventoryValueData} />
      </AnPanel>
    </div>
  );

  // ── Tab 7: Employees ──
  const EmployeesTab = () => (
    <div className="stack-18">
      <div className="astat-grid">
        <AnTile
          label="Total employees"
          value={String(employeeStats.totalEmployees)}
          hint={filters.isFiltered ? "headcount · unfiltered" : undefined}
        />
        <AnTile
          label="Admins"
          value={String(employeeStats.admins)}
          hint={filters.isFiltered ? "headcount · unfiltered" : undefined}
        />
        <AnTile label="Active now" value={String(employeeStats.activeNow)} />
        <AnTile label="Avg jobs / employee" value={employeeStats.avgJobsPerEmployee.toFixed(1)} />
      </div>

      <AnPanel
        title="Employee performance"
        sub="Jobs, completion and revenue"
        action={<Link href="/admin/employees" className="btn btn-secondary btn-sm">View all</Link>}>
        {employeePerformance.length > 0 ? (
          <div className="atable-wrap" style={{ boxShadow: "none", border: "1px solid var(--primary-10)" }}>
            <div style={{ overflowX: "auto" }}>
              <table className="atable">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th className="num">Jobs</th>
                    <th className="num">Completed</th>
                    <th className="num">Rate</th>
                    <th className="num">Revenue</th>
                    <th className="num">Avg / job</th>
                  </tr>
                </thead>
                <tbody>
                  {employeePerformance.map((emp, idx) => (
                    <tr
                      key={emp.id}
                      onClick={() => { window.location.href = `/admin/employees/${emp.id}`; }}>
                      <td>
                        <div className="row" style={{ gap: 8 }}>
                          <span className="avatar" style={{ background: "var(--primary)", width: 28, height: 28, fontSize: 11 }}>
                            {emp.name.split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase()}
                          </span>
                          <div>
                            <div className="col-client">{emp.name}</div>
                            {idx === 0 && <div className="col-client-sub">Top performer</div>}
                          </div>
                        </div>
                      </td>
                      <td className="num">{emp.totalJobs}</td>
                      <td className="num">{emp.completedJobs}</td>
                      <td className="num">
                        <span className={`profit-pct ${emp.completionRate >= 80 ? "good" : ""}`}>
                          {emp.completionRate.toFixed(0)}%
                        </span>
                      </td>
                      <td className="num">${emp.totalRevenue.toFixed(2)}</td>
                      <td className="num">${emp.avgJobPrice.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="an-listempty">No employee data yet</div>
        )}
      </AnPanel>

      <div className="an-grid-2">
        <AnPanel title="Jobs per employee" sub="Top 10 · jobs vs completed">
          {employeePerformance.length > 0 ? (
            <CBarChart
              data={employeePerformance.slice(0, 10).map((e) => ({
                name: e.name,
                Jobs: e.totalJobs,
                Completed: e.completedJobs,
              }))}
              dataKeys={["Jobs", "Completed"]}
              xKey="name"
              height={240}
            />
          ) : (
            <div className="an-listempty">No data yet</div>
          )}
        </AnPanel>

        <AnPanel title="Average time per job" sub="Minutes · top 10">
          {employeePerformance.some((e) => e.avgTimePerJob > 0) ? (
            <CBarChart
              data={employeePerformance
                .filter((e) => e.avgTimePerJob > 0)
                .slice(0, 10)
                .map((e) => ({
                  name: e.name,
                  Minutes: parseFloat(e.avgTimePerJob.toFixed(1)),
                }))}
              dataKeys={["Minutes"]}
              xKey="name"
              height={240}
            />
          ) : (
            <div className="an-listempty">No completed jobs with duration yet</div>
          )}
        </AnPanel>

        <AnPanel title="Current star rating" sub="By employee · top 10">
          {employeePerformance.some((e) => e.ratingsCount > 0) ? (
            <CBarChart
              data={employeePerformance
                .filter((e) => e.ratingsCount > 0)
                .slice(0, 10)
                .map((e) => ({
                  name: e.name,
                  Rating: parseFloat(e.currentRating.toFixed(2)),
                }))}
              dataKeys={["Rating"]}
              xKey="name"
              height={240}
            />
          ) : (
            <div className="an-listempty">No ratings yet</div>
          )}
        </AnPanel>

        <AnPanel title="Total complaints logged" sub="Ratings below 3 · top 10">
          {employeePerformance.some((e) => e.complaints > 0) ? (
            <CBarChart
              data={employeePerformance
                .filter((e) => e.complaints > 0)
                .slice(0, 10)
                .map((e) => ({
                  name: e.name,
                  Complaints: e.complaints,
                }))}
              dataKeys={["Complaints"]}
              xKey="name"
              height={240}
            />
          ) : (
            <div className="an-listempty">No complaints logged</div>
          )}
        </AnPanel>
      </div>

      <AnPanel title="Historical rating trend" sub="12 months by employee">
        {ratingTrendEmployeeNames.length > 0 ? (
          <CLineChart
            data={ratingTrendData}
            dataKeys={ratingTrendEmployeeNames}
            xKey="month"
            height={320}
          />
        ) : (
          <div className="an-listempty">Not enough rating history yet</div>
        )}
      </AnPanel>
    </div>
  );

  // ── Tab 8: Payments ──
  const PaymentsTab = () => {
    // `startDate` / `endDate` are civil dates ("2026-08-01") from the pickers.
    // They must be defaulted, compared and displayed in the store timezone:
    // toISOString() gave the UTC civil day (so the default "1st of the month"
    // could be the previous month on the 1st before 8 PM), and `new Date(str)`
    // is UTC midnight, which is 8 PM the evening BEFORE in Montréal — the
    // window was 4 hours wide of the dates shown (Q9).
    const getDefaultStartDate = () => storeDateKey().slice(0, 8) + "01";

    const getDefaultEndDate = () => storeDateKey();

    const [startDate, setStartDate] = React.useState(getDefaultStartDate());
    const [endDate, setEndDate] = React.useState(getDefaultEndDate());

    const calculateEmployeePayments = () => {
      const startDateTime = startDate
        ? storeCivilDayRange(startDate).start.getTime()
        : 0;
      // End of the picked day, exclusive-safe: take the next store midnight
      // minus 1 ms so the comparison below can stay inclusive.
      const endDateTime = endDate
        ? storeCivilDayRange(endDate).end.getTime() - 1
        : Date.now();

      const filteredJobs = paymentJobs.filter((job) => {
        const jobDate = new Date(job.startTime).getTime();
        return jobDate >= startDateTime && jobDate <= endDateTime;
      });

      const employeeMap = new Map<
        string,
        { id: string; name: string; totalOwed: number; jobsCount: number }
      >();

      filteredJobs.forEach((job) => {
        const existing = employeeMap.get(job.employeeId) || {
          id: job.employeeId,
          name: job.employeeName,
          totalOwed: 0,
          jobsCount: 0,
        };
        employeeMap.set(job.employeeId, {
          ...existing,
          totalOwed: existing.totalOwed + job.employeePay,
          jobsCount: existing.jobsCount + 1,
        });
      });

      return Array.from(employeeMap.values())
        .filter((emp) => emp.totalOwed > 0)
        .sort((a, b) => b.totalOwed - a.totalOwed);
    };

    const employeePayments = calculateEmployeePayments();
    const totalOwed = employeePayments.reduce(
      (sum, emp) => sum + emp.totalOwed,
      0
    );

    const setDateRange = (preset: string) => {
      const today = new Date();
      const todayStr = today.toISOString().split("T")[0];
      switch (preset) {
        case "today":
          setStartDate(todayStr);
          setEndDate(todayStr);
          break;
        case "week": {
          const weekAgo = new Date(today);
          weekAgo.setDate(today.getDate() - 7);
          setStartDate(weekAgo.toISOString().split("T")[0]);
          setEndDate(todayStr);
          break;
        }
        case "month":
          setStartDate(getDefaultStartDate());
          setEndDate(getDefaultEndDate());
          break;
        case "lastMonth": {
          const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
          const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
          setStartDate(lastMonth.toISOString().split("T")[0]);
          setEndDate(lastMonthEnd.toISOString().split("T")[0]);
          break;
        }
        case "all":
          setStartDate("");
          setEndDate("");
          break;
      }
    };

    const presetLabels: Record<string, string> = {
      today: "Today",
      week: "Last 7 days",
      month: "This month",
      lastMonth: "Last month",
      all: "All time",
    };

    return (
      <div className="stack-18">
        <AnPanel title="Date range" sub="Filter employee payouts">
          <div className="an-chip-row">
            {["today", "week", "month", "lastMonth", "all"].map((preset) => (
              <button
                key={preset}
                type="button"
                className="an-chip"
                onClick={() => setDateRange(preset)}>
                {presetLabels[preset]}
              </button>
            ))}
          </div>
          <div className="an-daterange">
            <label>Start date<DatePicker size="sm" value={startDate} onChange={setStartDate} placeholder="Any" /></label>
            <label>End date<DatePicker size="sm" value={endDate} onChange={setEndDate} placeholder="Any" /></label>
          </div>
        </AnPanel>

        <div className="astat-grid">
          <AnTile label="Total owed" value={`$${totalOwed.toFixed(2)}`} accent="var(--emerald-600)" />
          <AnTile label="Employees" value={String(employeePayments.length)} />
          <AnTile
            label="Jobs completed"
            value={String(employeePayments.reduce((sum, emp) => sum + emp.jobsCount, 0))}
          />
        </div>

        <AnPanel
          style={{ gap: 0, padding: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12, padding: "20px 22px", borderBottom: "1px solid var(--primary-10)" }}>
            <div>
              <h3 style={{ margin: 0 }}>Employee payment summary</h3>
              <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--primary-60)" }}>
                {startDate && endDate
                  ? `${formatDate(storeCivilDayRange(startDate).start)} – ${formatDate(storeCivilDayRange(endDate).start)}`
                  : startDate
                  ? `From ${formatDate(storeCivilDayRange(startDate).start)}`
                  : endDate
                  ? `Until ${formatDate(storeCivilDayRange(endDate).start)}`
                  : "All completed jobs"}
              </p>
            </div>
            {employeePayments.length > 0 && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  const csvHeaders = ["Employee Name", "Jobs", "Amount Owed", "Avg Per Job"];
                  const rows = employeePayments.map((emp) => [
                    emp.name,
                    emp.jobsCount.toString(),
                    emp.totalOwed.toFixed(2),
                    (emp.totalOwed / emp.jobsCount).toFixed(2),
                  ]);
                  const csvContent = [
                    csvHeaders.join(","),
                    ...rows.map((row) => row.join(",")),
                  ].join("\n");
                  const blob = new Blob([csvContent], { type: "text/csv" });
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `employee-payments-${new Date().toISOString().split("T")[0]}.csv`;
                  a.click();
                  window.URL.revokeObjectURL(url);
                }}>
                Export CSV
              </button>
            )}
          </div>

          {employeePayments.length > 0 ? (
            <>
              <div className="hidden md:block overflow-x-auto">
                <div className="min-w-max">
                  <div className="flex bg-[#008C9C]/5">
                    {[
                      { label: "Employee Name", className: "w-[220px]" },
                      { label: "Jobs", className: "w-[100px]" },
                      { label: "Amount Owed", className: "w-[150px]" },
                      { label: "Avg/Job", className: "w-[120px]" },
                      { label: "Actions", className: "w-[180px]" },
                    ].map((col) => (
                      <div
                        key={col.label}
                        className={`${col.className} p-4 text-left text-xs font-[350] !text-[#008C9C]/40 uppercase tracking-wide`}>
                        {col.label}
                      </div>
                    ))}
                  </div>
                  <div className="divide-y divide-[#008C9C]/4">
                    {employeePayments.map((emp) => (
                      <div
                        key={emp.id}
                        className="flex items-center hover:bg-[#008C9C]/1 transition-colors">
                        <div className="w-[220px] p-4">
                          <p className="text-sm font-[350] text-[#008C9C] truncate">
                            {emp.name}
                          </p>
                        </div>
                        <div className="w-[100px] p-4">
                          <p className="text-sm font-[350] text-[#008C9C]">
                            {emp.jobsCount}
                          </p>
                        </div>
                        <div className="w-[150px] p-4">
                          <Badge variant="success" size="sm" className="px-3 py-1.5">
                            ${emp.totalOwed.toFixed(2)}
                          </Badge>
                        </div>
                        <div className="w-[120px] p-4">
                          <p className="text-sm font-[350] text-[#008C9C]/60">
                            ${(emp.totalOwed / emp.jobsCount).toFixed(2)}
                          </p>
                        </div>
                        <div className="w-[180px] p-4">
                          <Link href={`/admin/employees/${emp.id}`}>
                            <Button
                              variant="default"
                              size="sm"
                              border={false}
                              className="rounded-2xl px-4 py-3 whitespace-nowrap">
                              View Details
                            </Button>
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="md:hidden space-y-3 p-4">
                {employeePayments.map((emp) => (
                  <Card key={emp.id} variant="cleano_light" className="p-4">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <p className="text-sm font-[400] text-[#008C9C]">
                            {emp.name}
                          </p>
                          <p className="text-xs text-[#008C9C]/70 mt-1">
                            {emp.jobsCount} jobs • $
                            {(emp.totalOwed / emp.jobsCount).toFixed(2)} avg
                          </p>
                        </div>
                        <Badge variant="success" size="sm" className="px-3 py-1.5">
                          ${emp.totalOwed.toFixed(2)}
                        </Badge>
                      </div>
                      <Link href={`/admin/employees/${emp.id}`}>
                        <Button
                          variant="default"
                          size="sm"
                          border={false}
                          className="rounded-2xl px-4 py-2 w-full">
                          View Details
                        </Button>
                      </Link>
                    </div>
                  </Card>
                ))}
              </div>
            </>
          ) : (
            <div style={{ padding: "48px 22px", textAlign: "center" }}>
              <span className="an-empty-icon"><DollarSign size={26} /></span>
              <h3 className="title-sm" style={{ marginBottom: 6 }}>No payments found</h3>
              <p className="subtitle" style={{ fontSize: 13.5, margin: 0 }}>
                Employee payments for completed jobs will appear here.
              </p>
            </div>
          )}
        </AnPanel>
      </div>
    );
  };

  // ── Tab 9: Alerts ──
  const AlertsTab = () => {
    // `visibleAlerts` / `unreadAlertCount` are derived once at the top of the
    // component — see the note there.
    const unreadCount = unreadAlertCount;

    const typeIcons: Record<string, React.ReactNode> = {
      LOW_INVENTORY: <Package size={16} />,
      CANCELLATION: <Briefcase size={16} />,
      OVERDUE_PAYMENT: <DollarSign size={16} />,
      GENERAL: <Bell size={16} />,
    };

    return (
      <div className="stack-18">
        <div className="astat-grid">
          <AnTile
            label="Total alerts"
            value={String(totalAlertCount)}
            hint={
              totalAlertCount > visibleAlerts.length
                ? `showing the ${visibleAlerts.length} most recent`
                : undefined
            }
          />
          <AnTile
            label="Unread"
            value={String(unreadCount)}
            accent={unreadCount > 0 ? "var(--amber-600)" : undefined}
          />
          <AnTile
            label="Critical"
            value={String(visibleAlerts.filter((a) => a.severity === "CRITICAL").length)}
            accent={visibleAlerts.some((a) => a.severity === "CRITICAL") ? "var(--error)" : undefined}
          />
        </div>

        {alertError && (
          <div className="an-alert an-alert-crit" role="alert">
            <span className="an-alert-icon">
              <AlertTriangle size={16} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="an-alert-msg">{alertError}</p>
            </div>
          </div>
        )}

        {visibleAlerts.length > 0 ? (
          <div className="an-list">
            {visibleAlerts.map((alert) => {
              const tone =
                alert.severity === "CRITICAL" ? "crit" : alert.severity === "WARNING" ? "warn" : "info";
              return (
                <div key={alert.id} className={`an-alert an-alert-${tone}`}>
                  <span className="an-alert-icon">{typeIcons[alert.type] || typeIcons.GENERAL}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="an-alert-titlerow">
                      <span className="an-alert-title">{alert.title}</span>
                      {!alert.isRead && <span className="an-alert-new">NEW</span>}
                    </div>
                    <p className="an-alert-msg">{alert.message}</p>
                    <div className="an-alert-meta">
                      <span className="pill">{alert.type.replace(/_/g, " ")}</span>
                      <span>
                        {fmtDate(alert.createdAt)}{" "}
                        {fmtTime(alert.createdAt)}
                      </span>
                      {/* An overdue-payment card is only actionable if the
                          admin can get to the job it is about. The server drops
                          Job-related alerts whose job no longer exists, so this
                          link is never a 404. */}
                      {alert.relatedType === "Job" && alert.relatedId && (
                        <Link
                          href={`/admin/jobs/${alert.relatedId}`}
                          className="link"
                          style={{ fontSize: 12, fontWeight: 600 }}>
                          View job →
                        </Link>
                      )}
                      {alert.employeeId && (
                        <Link
                          href={`/admin/employees/${alert.employeeId}?tab=products`}
                          className="link"
                          style={{ fontSize: 12, fontWeight: 600 }}>
                          View cleaner →
                        </Link>
                      )}
                    </div>
                  </div>
                  <div className="an-alert-actions">
                    {!alert.isRead && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={pendingAlertId === alert.id}
                        onClick={() => handleMarkAlertRead(alert.id)}>
                        Mark read
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={pendingAlertId === alert.id}
                      onClick={() => handleDismissAlert(alert.id)}>
                      Dismiss
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="an-empty">
            <span className="an-empty-icon" style={{ background: "rgba(5,150,105,0.10)", color: "var(--emerald-600)" }}>
              <CheckCircle2 size={26} />
            </span>
            <h3 className="title-sm">No active alerts</h3>
            <p className="subtitle" style={{ fontSize: 13.5, margin: 0 }}>
              Alerts for low inventory, cancellations and overdue payments will appear here.
            </p>
          </div>
        )}
      </div>
    );
  };

  // ── Tab 10: Marketing ──
  const MarketingTab = () => {
    const md = marketingData;
    const budgetUsedPct =
      md && md.totalBudget > 0
        ? ((md.totalSpent / md.totalBudget) * 100).toFixed(1)
        : "0";

    return (
      <div className="stack-18">
        <div className="astat-grid">
          <AnTile label="Active campaigns" value={String(md?.activeCampaigns ?? 0)} hint={`${md?.campaigns.length ?? 0} total`} />
          <AnTile label="Page visits" value={String(md?.totalPageVisits ?? 0)} hint={`${md?.publishedPages ?? 0} published pages`} />
          <AnTile label="Budget spent" value={`$${(md?.totalSpent ?? 0).toFixed(0)}`} hint={`${budgetUsedPct}% of $${(md?.totalBudget ?? 0).toFixed(0)}`} />
          <AnTile label="Landing pages" value={String(md?.landingPages.length ?? 0)} hint={`${md?.publishedPages ?? 0} live`} />
        </div>

        <AnPanel title="Campaign performance" sub="Spend and reach by campaign">
          {md && md.campaigns.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table className="atable">
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Status</th>
                    <th>Channel</th>
                    <th style={{ textAlign: "right" }}>Budget</th>
                    <th style={{ textAlign: "right" }}>Spent</th>
                    <th style={{ textAlign: "right" }}>Pages</th>
                  </tr>
                </thead>
                <tbody>
                  {md.campaigns.map((c) => (
                    <tr key={c.id}>
                      <td style={{ fontWeight: 500, color: "var(--primary)" }}>{c.name}</td>
                      <td>
                        <span className={`pill ${c.status === "ACTIVE" ? "pill-emerald" : ""}`}>{c.status}</span>
                      </td>
                      <td style={{ color: "var(--primary-60)" }}>{c.channel || "—"}</td>
                      <td style={{ textAlign: "right" }}>${c.budget.toFixed(0)}</td>
                      <td style={{ textAlign: "right" }}>${c.spent.toFixed(0)}</td>
                      <td style={{ textAlign: "right" }}>{c.landingPageCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="an-listempty">No campaigns yet. Create one from the Sales page.</div>
          )}
        </AnPanel>

        <AnPanel title="Landing page visits" sub="Traffic by page">
          {md && md.landingPages.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table className="atable">
                <thead>
                  <tr>
                    <th>Page</th>
                    <th>Status</th>
                    <th>Campaign</th>
                    <th style={{ textAlign: "right" }}>Total visits</th>
                  </tr>
                </thead>
                <tbody>
                  {md.landingPages
                    .sort((a, b) => b.totalVisits - a.totalVisits)
                    .map((lp) => (
                      <tr key={lp.id}>
                        <td>
                          <div style={{ fontWeight: 500, color: "var(--primary)" }}>{lp.title}</div>
                          <div style={{ fontSize: 11.5, color: "var(--primary-40)" }}>/p/{lp.slug}</div>
                        </td>
                        <td>
                          <span className={`pill ${lp.isPublished ? "pill-emerald" : ""}`}>
                            {lp.isPublished ? "Published" : "Draft"}
                          </span>
                        </td>
                        <td style={{ color: "var(--primary-60)" }}>{lp.campaignName || "—"}</td>
                        <td style={{ textAlign: "right", fontWeight: 500, color: "var(--primary)" }}>{lp.totalVisits}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="an-listempty">No landing pages yet. Create one from the Sales page.</div>
          )}
        </AnPanel>
      </div>
    );
  };

  return (
    <div className="admin-font stack-24" style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* Header */}
      <header>
        <p className="eyebrow">Insights · Owner</p>
        <h1 className="display" style={{ fontSize: "clamp(32px, 4.2vw, 46px)", marginTop: 6 }}>
          Analytics &amp; <em>reports.</em>
        </h1>
        <p className="subtitle" style={{ marginTop: 10, fontSize: 15.5 }}>
          Comprehensive insights into revenue, labour, inventory and growth.
        </p>
      </header>

      {/* Always-on Labour Cost % widget */}
      <LabourCostCard />

      {/* Tabs */}
      <div className="atabs" style={{ overflowX: "auto", maxWidth: "100%" }}>
        {MENU_ITEMS.map((item) => {
          const isActive = activeView === item.id;
          const alertCount = item.id === "alerts" ? unreadAlertCount : 0;
          return (
            <button
              key={item.id}
              className={`atab ${isActive ? "active" : ""}`}
              onClick={() => setActiveView(item.id)}
              style={{ whiteSpace: "nowrap" }}>
              {item.label}
              {alertCount > 0 && (
                <span className="atab-count" style={{ background: "#ef4444", color: "#fff" }}>
                  {alertCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Page filters — job-derived tabs only (Q7 §5). Inventory, Budget,
          Targets, Alerts and Marketing have no industry or job-date dimension,
          so the control is hidden there rather than sitting inert. */}
      {showsFilter && (
        <AnalyticsFilterBar
          filters={filters}
          industryCounts={industryCounts}
          showUnspecified={
            unspecifiedCount > 0 || filters.industry === "UNSPECIFIED"
          }
          scopedJobCount={scopedJobCount}
          unfilteredJobCount={unfilteredJobCount}
          activeTab={activeView}
        />
      )}

      {/* Content Area */}
      <div className="flex-1">
        {activeView === "overview" && <OverviewTab />}
        {activeView === "kpis" && <KPIsTab />}
        {activeView === "graphs" && <GraphsTab />}
        {activeView === "budget" && <BudgetTab />}
        {activeView === "targets" && <TargetsTab />}
        {activeView === "inventory" && <InventoryTab />}
        {activeView === "employees" && <EmployeesTab />}
        {activeView === "payments" && <PaymentsTab />}
        {activeView === "alerts" && <AlertsTab />}
        {activeView === "marketing" && <MarketingTab />}
      </div>
    </div>
  );
}
