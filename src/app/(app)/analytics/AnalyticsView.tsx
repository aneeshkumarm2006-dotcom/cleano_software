"use client";

import React, { useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Link from "next/link";
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
} from "lucide-react";
import RevenueTrendChart from "./charts/RevenueTrendChart";
import InventoryValueChart from "./charts/InventoryValueChart";
import ProfitLossChart from "./charts/ProfitLossChart";
import SupplierComparisonChart from "./charts/SupplierComparisonChart";
import TargetVsActualChart from "./charts/TargetVsActualChart";
import { CBarChart, CPieChart } from "@/components/ui/Chart";
import { dismissAlert, markAlertRead } from "@/app/(app)/actions/createAlert";
import { createTarget } from "@/app/(app)/actions/createTarget";
import { updateTarget } from "@/app/(app)/actions/updateTarget";

type TabView =
  | "overview"
  | "kpis"
  | "graphs"
  | "budget"
  | "targets"
  | "inventory"
  | "employees"
  | "payments"
  | "alerts"
  | "marketing";

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
  createdAt: string;
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
  supplierComparisonData: Array<Record<string, string | number>>;
  supplierNames: string[];
  inventoryValueData: Array<{ name: string; warehouse: number; inCirculation: number }>;
}

// ── Reusable Sub-components ──

function SimpleBarChart({
  data,
  maxValue,
  label,
  color = "bg-[#005F6A]",
}: {
  data: { label: string; value: number }[];
  maxValue: number;
  label: string;
  color?: string;
}) {
  return (
    <div className="space-y-3">
      {label && (
        <p className="text-xs text-[#005F6A]/60 uppercase tracking-wide">
          {label}
        </p>
      )}
      {data.map((item, idx) => (
        <div key={idx} className="space-y-1">
          <div className="flex justify-between text-xs text-[#005F6A]/70">
            <span>{item.label}</span>
            <span className="font-[400]">{item.value}</span>
          </div>
          <div className="h-2 bg-[#005F6A]/10 rounded-full overflow-hidden">
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
          stroke="rgba(0, 95, 106, 0.1)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#005F6A"
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
        <span className="text-2xl font-[400] text-[#005F6A]">
          {percentage.toFixed(0)}%
        </span>
      </div>
      <p className="text-xs text-[#005F6A]/60 mt-2">{label}</p>
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
              variant === "warning" ? "text-yellow-700" : "!text-[#005F6A]/70"
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
              variant === "warning" ? "text-yellow-700" : "text-[#005F6A]"
            }`}>
            {value}
          </p>
          {subValue && (
            <p className="text-xs text-[#005F6A]/60 mt-0.5">{subValue}</p>
          )}
        </div>
      </div>
    </Card>
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
  supplierComparisonData,
  supplierNames,
  inventoryValueData,
}: AnalyticsViewProps) {
  const [activeView, setActiveView] = useState<TabView>("overview");

  // ── Tab 1: Overview ──
  const OverviewTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Total Revenue"
          value={`$${revenueStats.totalRevenue.toFixed(2)}`}
          subValue={`$${revenueStats.monthlyRevenue.toFixed(2)} this month`}
        />
        <MetricCard
          label="Net Profit"
          value={`$${revenueStats.netProfit.toFixed(2)}`}
          subValue={`${revenueStats.profitMargin.toFixed(1)}% margin`}
          variant={revenueStats.profitMargin > 30 ? "success" : "default"}
        />
        <MetricCard
          label="Total Jobs"
          value={String(jobStats.total)}
          subValue={`${jobStats.completionRate.toFixed(0)}% completion rate`}
        />
        <MetricCard
          label="Pending Payments"
          value={String(revenueStats.pendingPayments)}
          subValue={`$${revenueStats.pendingAmount.toFixed(2)} outstanding`}
          variant={revenueStats.pendingPayments > 0 ? "warning" : "default"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card variant="default" className="p-6">
          <div className="flex items-center gap-2 mb-6">
            <div className="p-2 bg-[#005F6A]/10 rounded-lg">
              <TrendingUp className="w-4 h-4 text-[#005F6A]" />
            </div>
            <h3 className="text-sm font-[350] text-[#005F6A]/80">
              Revenue Trend (12 months)
            </h3>
          </div>
          <RevenueTrendChart data={monthlyData} />
        </Card>

        <Card variant="default" className="p-6">
          <div className="flex items-center gap-2 mb-6">
            <div className="p-2 bg-[#005F6A]/10 rounded-lg">
              <Briefcase className="w-4 h-4 text-[#005F6A]" />
            </div>
            <h3 className="text-sm font-[350] text-[#005F6A]/80">
              Jobs by Type
            </h3>
          </div>
          {jobTypeBreakdown.length > 0 ? (
            <SimpleBarChart
              data={jobTypeBreakdown.map((j) => ({
                label: j.type || "Unspecified",
                value: j.count,
              }))}
              maxValue={Math.max(...jobTypeBreakdown.map((j) => j.count))}
              label=""
            />
          ) : (
            <p className="text-sm text-[#005F6A]/60 text-center py-8">
              No job data yet
            </p>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card variant="cleano_light" className="p-4 text-center">
          <p className="text-2xl font-[400] text-[#005F6A]">
            {employeeStats.totalEmployees}
          </p>
          <p className="text-xs text-[#005F6A]/60 mt-1">Total Employees</p>
        </Card>
        <Card variant="cleano_light" className="p-4 text-center">
          <p className="text-2xl font-[400] text-[#005F6A]">
            {inventoryStats.totalProducts}
          </p>
          <p className="text-xs text-[#005F6A]/60 mt-1">Products</p>
        </Card>
        <Card variant="cleano_light" className="p-4 text-center">
          <p className="text-2xl font-[400] text-[#005F6A]">
            ${revenueStats.avgJobPrice.toFixed(0)}
          </p>
          <p className="text-xs text-[#005F6A]/60 mt-1">Avg Job Price</p>
        </Card>
        <Card
          variant={lowStockProducts.length > 0 ? "warning" : "cleano_light"}
          className="p-4 text-center">
          <p
            className={`text-2xl font-[400] ${
              lowStockProducts.length > 0 ? "text-yellow-700" : "text-[#005F6A]"
            }`}>
            {lowStockProducts.length}
          </p>
          <p
            className={`text-xs mt-1 ${
              lowStockProducts.length > 0
                ? "text-yellow-600"
                : "text-[#005F6A]/60"
            }`}>
            Low Stock Items
          </p>
        </Card>
      </div>
    </div>
  );

  // ── Tab 2: KPIs ──
  const KPIsTab = () => {
    const kpis = [
      {
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
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.map((kpi, idx) => (
            <Card key={idx} variant="default" className="p-6">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-[#005F6A]/10 rounded-lg text-[#005F6A]">
                  {kpi.icon}
                </div>
                <div className="flex-1">
                  <p className="text-xs text-[#005F6A]/60 uppercase tracking-wide">
                    {kpi.label}
                  </p>
                  <p className="text-xl font-[400] text-[#005F6A] mt-1">
                    {kpi.value}
                  </p>
                  <p className="text-xs text-[#005F6A]/50 mt-0.5">
                    {kpi.subValue}
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card variant="default" className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="p-2 bg-[#005F6A]/10 rounded-lg">
                <CheckCircle2 className="w-4 h-4 text-[#005F6A]" />
              </div>
              <h3 className="text-sm font-[350] text-[#005F6A]/80">
                Job Completion
              </h3>
            </div>
            <div className="flex justify-center">
              <ProgressRing
                value={jobStats.completed}
                max={jobStats.total}
                label="Completion Rate"
                size={140}
              />
            </div>
          </Card>

          <Card variant="default" className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="p-2 bg-[#005F6A]/10 rounded-lg">
                <DollarSign className="w-4 h-4 text-[#005F6A]" />
              </div>
              <h3 className="text-sm font-[350] text-[#005F6A]/80">
                Payment Collection
              </h3>
            </div>
            <div className="flex justify-center">
              <ProgressRing
                value={jobStats.completed - revenueStats.pendingPayments}
                max={jobStats.completed}
                label="Payments Collected"
                size={140}
              />
            </div>
          </Card>
        </div>
      </div>
    );
  };

  // ── Tab 3: Graphs ──
  const GraphsTab = () => (
    <div className="space-y-6">
      <Card variant="default" className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="p-2 bg-[#005F6A]/10 rounded-lg">
            <TrendingUp className="w-4 h-4 text-[#005F6A]" />
          </div>
          <h3 className="text-sm font-[350] text-[#005F6A]/80">
            Revenue Trend (12 months)
          </h3>
        </div>
        <RevenueTrendChart data={monthlyData} />
      </Card>

      <Card variant="default" className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="p-2 bg-[#005F6A]/10 rounded-lg">
            <BarChart3 className="w-4 h-4 text-[#005F6A]" />
          </div>
          <h3 className="text-sm font-[350] text-[#005F6A]/80">
            Profit & Loss by Month
          </h3>
        </div>
        <ProfitLossChart data={monthlyData} />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card variant="default" className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-[#005F6A]/10 rounded-lg">
              <Package className="w-4 h-4 text-[#005F6A]" />
            </div>
            <h3 className="text-sm font-[350] text-[#005F6A]/80">
              Inventory Value: Warehouse vs In-Circulation
            </h3>
          </div>
          <InventoryValueChart data={inventoryValueData} />
        </Card>

        <Card variant="default" className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-[#005F6A]/10 rounded-lg">
              <DollarSign className="w-4 h-4 text-[#005F6A]" />
            </div>
            <h3 className="text-sm font-[350] text-[#005F6A]/80">
              Supplier Price Comparison
            </h3>
          </div>
          <SupplierComparisonChart
            data={supplierComparisonData}
            supplierNames={supplierNames}
          />
        </Card>
      </div>

      {targetsWithActuals.length > 0 && (
        <Card variant="default" className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-[#005F6A]/10 rounded-lg">
              <Target className="w-4 h-4 text-[#005F6A]" />
            </div>
            <h3 className="text-sm font-[350] text-[#005F6A]/80">
              Targets vs Actuals
            </h3>
          </div>
          <TargetVsActualChart
            data={targetsWithActuals.map((t) => ({
              metric: t.metric.replace(/_/g, " "),
              target: t.targetValue,
              actual: t.actual,
            }))}
          />
        </Card>
      )}
    </div>
  );

  // ── Tab 4: Budget vs Actuals ──
  const BudgetTab = () => (
    <div className="space-y-6">
      {budgetVsActuals.length > 0 ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <MetricCard
              label="Total Budgeted"
              value={`$${budgetVsActuals.reduce((s, b) => s + b.budgetAmount, 0).toFixed(2)}`}
            />
            <MetricCard
              label="Total Actual"
              value={`$${budgetVsActuals.reduce((s, b) => s + b.actualAmount, 0).toFixed(2)}`}
            />
            <MetricCard
              label="Total Variance"
              value={`$${budgetVsActuals.reduce((s, b) => s + b.variance, 0).toFixed(2)}`}
              variant={
                budgetVsActuals.reduce((s, b) => s + b.variance, 0) < 0
                  ? "warning"
                  : "success"
              }
            />
          </div>

          <Card variant="default" className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="p-2 bg-[#005F6A]/10 rounded-lg">
                <BarChart3 className="w-4 h-4 text-[#005F6A]" />
              </div>
              <h3 className="text-sm font-[350] text-[#005F6A]/80">
                Budget vs Actual Spending
              </h3>
            </div>
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
          </Card>

          <Card variant="default" className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="p-2 bg-[#005F6A]/10 rounded-lg">
                <DollarSign className="w-4 h-4 text-[#005F6A]" />
              </div>
              <h3 className="text-sm font-[350] text-[#005F6A]/80">
                Budget Detail
              </h3>
            </div>
            <div className="space-y-3">
              {budgetVsActuals.map((b) => {
                const overBudget = b.percentUsed > 100;
                return (
                  <div
                    key={b.id}
                    className={`p-4 rounded-xl ${
                      overBudget ? "bg-red-50 border border-red-200" : "bg-[#005F6A]/5"
                    }`}>
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-sm font-[400] text-[#005F6A]">
                          {b.category}
                        </p>
                        <p className="text-xs text-[#005F6A]/60">{b.period}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-[400] text-[#005F6A]">
                          ${b.actualAmount.toFixed(2)} / ${b.budgetAmount.toFixed(2)}
                        </p>
                        <Badge
                          variant={overBudget ? "error" : "success"}
                          size="sm">
                          {b.percentUsed.toFixed(0)}%
                        </Badge>
                      </div>
                    </div>
                    <div className="h-2 bg-[#005F6A]/10 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          overBudget ? "bg-red-500" : "bg-[#005F6A]"
                        }`}
                        style={{ width: `${Math.min(b.percentUsed, 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </>
      ) : (
        <Card variant="default" className="p-12 text-center">
          <div className="w-16 h-16 bg-[#005F6A]/5 rounded-full flex items-center justify-center mx-auto mb-3">
            <DollarSign className="w-8 h-8 text-[#005F6A]/40" />
          </div>
          <p className="text-sm font-[350] text-[#005F6A]/70">
            No budgets configured yet
          </p>
          <p className="text-xs text-[#005F6A]/50 mt-1">
            Set up budgets in the Finances module to see comparisons here
          </p>
        </Card>
      )}
    </div>
  );

  // ── Tab 5: Targets vs Actuals ──
  const TargetsTab = () => {
    const [showForm, setShowForm] = useState(false);

    const metricLabels: Record<string, string> = {
      REVENUE: "Revenue",
      JOBS_COMPLETED: "Jobs Completed",
      NEW_CLIENTS: "New Clients",
      PROFIT_MARGIN: "Profit Margin (%)",
      AVG_JOB_PRICE: "Avg Job Price",
      EMPLOYEE_RETENTION: "Employee Count",
    };

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-[350] text-[#005F6A]/80">
            Business Targets
          </h2>
          <Button
            variant="action"
            size="sm"
            border={false}
            onClick={() => setShowForm(!showForm)}
            className="rounded-xl px-4 py-2">
            {showForm ? "Cancel" : "Add Target"}
          </Button>
        </div>

        {showForm && (
          <Card variant="cleano_light" className="p-6">
            <form
              action={async (formData) => {
                await createTarget(formData);
                setShowForm(false);
              }}
              className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-[350] text-[#005F6A]/70 uppercase tracking-wide mb-1 block">
                    Metric
                  </label>
                  <select
                    name="metric"
                    required
                    className="w-full px-4 py-2.5 rounded-xl border border-[#005F6A]/10 bg-white text-sm text-[#005F6A] focus:outline-none focus:ring-2 focus:ring-[#005F6A]/20">
                    <option value="REVENUE">Revenue</option>
                    <option value="JOBS_COMPLETED">Jobs Completed</option>
                    <option value="NEW_CLIENTS">New Clients</option>
                    <option value="PROFIT_MARGIN">Profit Margin (%)</option>
                    <option value="AVG_JOB_PRICE">Avg Job Price</option>
                    <option value="EMPLOYEE_RETENTION">Employee Count</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-[350] text-[#005F6A]/70 uppercase tracking-wide mb-1 block">
                    Period
                  </label>
                  <select
                    name="period"
                    required
                    className="w-full px-4 py-2.5 rounded-xl border border-[#005F6A]/10 bg-white text-sm text-[#005F6A] focus:outline-none focus:ring-2 focus:ring-[#005F6A]/20">
                    <option value="WEEKLY">Weekly</option>
                    <option value="MONTHLY">Monthly</option>
                    <option value="QUARTERLY">Quarterly</option>
                    <option value="YEARLY">Yearly</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-[350] text-[#005F6A]/70 uppercase tracking-wide mb-1 block">
                    Period Start
                  </label>
                  <input
                    type="date"
                    name="periodStart"
                    required
                    className="w-full px-4 py-2.5 rounded-xl border border-[#005F6A]/10 bg-white text-sm text-[#005F6A] focus:outline-none focus:ring-2 focus:ring-[#005F6A]/20"
                  />
                </div>
                <div>
                  <label className="text-xs font-[350] text-[#005F6A]/70 uppercase tracking-wide mb-1 block">
                    Target Value
                  </label>
                  <input
                    type="number"
                    name="targetValue"
                    step="0.01"
                    required
                    className="w-full px-4 py-2.5 rounded-xl border border-[#005F6A]/10 bg-white text-sm text-[#005F6A] focus:outline-none focus:ring-2 focus:ring-[#005F6A]/20"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-[350] text-[#005F6A]/70 uppercase tracking-wide mb-1 block">
                  Notes
                </label>
                <input
                  type="text"
                  name="notes"
                  className="w-full px-4 py-2.5 rounded-xl border border-[#005F6A]/10 bg-white text-sm text-[#005F6A] focus:outline-none focus:ring-2 focus:ring-[#005F6A]/20"
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
          </Card>
        )}

        {targetsWithActuals.length > 0 ? (
          <>
            <Card variant="default" className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="p-2 bg-[#005F6A]/10 rounded-lg">
                  <Target className="w-4 h-4 text-[#005F6A]" />
                </div>
                <h3 className="text-sm font-[350] text-[#005F6A]/80">
                  Target Progress
                </h3>
              </div>
              <TargetVsActualChart
                data={targetsWithActuals.map((t) => ({
                  metric: metricLabels[t.metric] || t.metric,
                  target: t.targetValue,
                  actual: t.actual,
                }))}
              />
            </Card>

            <div className="space-y-3">
              {targetsWithActuals.map((target) => {
                const progressColor =
                  target.progress >= 100
                    ? "bg-green-500"
                    : target.progress >= 80
                    ? "bg-yellow-500"
                    : "bg-red-500";
                const badgeVariant =
                  target.progress >= 100
                    ? "success"
                    : target.progress >= 80
                    ? "default"
                    : "error";

                return (
                  <Card key={target.id} variant="default" className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-sm font-[400] text-[#005F6A]">
                          {metricLabels[target.metric] || target.metric}
                        </p>
                        <p className="text-xs text-[#005F6A]/60">
                          {target.period} from{" "}
                          {new Date(target.periodStart).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="text-right flex items-center gap-3">
                        <div>
                          <p className="text-sm font-[400] text-[#005F6A]">
                            {target.actual.toFixed(
                              target.metric === "PROFIT_MARGIN" ? 1 : 2
                            )}{" "}
                            / {target.targetValue.toFixed(target.metric === "PROFIT_MARGIN" ? 1 : 2)}
                          </p>
                          <p className="text-xs text-[#005F6A]/60">
                            Variance: {target.variance >= 0 ? "+" : ""}
                            {target.variance.toFixed(2)}
                          </p>
                        </div>
                        <Badge variant={badgeVariant as any} size="sm">
                          {target.progress.toFixed(0)}%
                        </Badge>
                      </div>
                    </div>
                    <div className="h-2 bg-[#005F6A]/10 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${progressColor} rounded-full transition-all duration-500`}
                        style={{ width: `${Math.min(target.progress, 100)}%` }}
                      />
                    </div>
                    {target.notes && (
                      <p className="text-xs text-[#005F6A]/50 mt-2">
                        {target.notes}
                      </p>
                    )}
                  </Card>
                );
              })}
            </div>
          </>
        ) : (
          <Card variant="default" className="p-12 text-center">
            <div className="w-16 h-16 bg-[#005F6A]/5 rounded-full flex items-center justify-center mx-auto mb-3">
              <Target className="w-8 h-8 text-[#005F6A]/40" />
            </div>
            <p className="text-sm font-[350] text-[#005F6A]/70">
              No targets set yet
            </p>
            <p className="text-xs text-[#005F6A]/50 mt-1">
              Click &quot;Add Target&quot; to create your first business target
            </p>
          </Card>
        )}
      </div>
    );
  };

  // ── Tab 6: Inventory ──
  const InventoryTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Total Products"
          value={String(inventoryStats.totalProducts)}
        />
        <MetricCard
          label="Warehouse Value"
          value={`$${inventoryStats.totalValue.toFixed(2)}`}
        />
        <MetricCard
          label="In Circulation"
          value={`$${inventoryStats.inCirculationValue.toFixed(2)}`}
        />
        <MetricCard
          label="Low Stock Items"
          value={String(inventoryStats.lowStockCount)}
          variant={inventoryStats.lowStockCount > 0 ? "warning" : "default"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card variant="default" className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-[#005F6A]/10 rounded-lg">
              <TrendingUp className="w-4 h-4 text-[#005F6A]" />
            </div>
            <h3 className="text-sm font-[350] text-[#005F6A]/80">
              Most Used Products
            </h3>
          </div>
          {productUsage.length > 0 ? (
            <div className="space-y-2">
              {productUsage.slice(0, 5).map((product, idx) => (
                <Link
                  key={product.id}
                  href={`/inventory/${product.id}`}
                  className="flex items-center justify-between p-3 rounded-xl bg-[#005F6A]/5 hover:bg-[#005F6A]/8 transition-colors">
                  <div className="flex items-center gap-3">
                    <Badge variant="cleano" size="sm">
                      #{idx + 1}
                    </Badge>
                    <div>
                      <p className="text-sm font-[400] text-[#005F6A]">
                        {product.name}
                      </p>
                      <p className="text-xs text-[#005F6A]/60">
                        {product.totalUsed.toFixed(1)} {product.unit} used
                      </p>
                    </div>
                  </div>
                  <p className="text-sm font-[400] text-[#005F6A]">
                    ${product.totalCost.toFixed(2)}
                  </p>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#005F6A]/60 text-center py-8">
              No usage data yet
            </p>
          )}
        </Card>

        <Card
          variant={lowStockProducts.length > 0 ? "warning" : "default"}
          className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <div
              className={`p-2 rounded-lg ${
                lowStockProducts.length > 0
                  ? "bg-yellow-100"
                  : "bg-[#005F6A]/10"
              }`}>
              <AlertTriangle
                className={`w-4 h-4 ${
                  lowStockProducts.length > 0
                    ? "text-yellow-600"
                    : "text-[#005F6A]"
                }`}
              />
            </div>
            <h3
              className={`text-sm font-[350] ${
                lowStockProducts.length > 0
                  ? "text-yellow-700"
                  : "text-[#005F6A]/80"
              }`}>
              Low Stock Alert
            </h3>
          </div>
          {lowStockProducts.length > 0 ? (
            <div className="space-y-2">
              {lowStockProducts.map((product) => (
                <Link
                  key={product.id}
                  href={`/inventory/${product.id}`}
                  className="flex items-center justify-between p-3 rounded-xl bg-yellow-50 border border-yellow-200 hover:bg-yellow-100 transition-colors">
                  <div>
                    <p className="text-sm font-[400] text-yellow-800">
                      {product.name}
                    </p>
                    <p className="text-xs text-yellow-600">
                      {product.stockLevel} / {product.minStock} {product.unit}
                    </p>
                  </div>
                  <Badge variant="error" size="sm">
                    Low
                  </Badge>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="w-12 h-12 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 className="w-6 h-6 text-green-600" />
              </div>
              <p className="text-sm text-[#005F6A]/60">All stock levels OK</p>
            </div>
          )}
        </Card>
      </div>

      <Card variant="default" className="p-6">
        <div className="flex items-center gap-2 mb-6">
          <div className="p-2 bg-[#005F6A]/10 rounded-lg">
            <Package className="w-4 h-4 text-[#005F6A]" />
          </div>
          <h3 className="text-sm font-[350] text-[#005F6A]/80">
            Inventory Value Distribution
          </h3>
        </div>
        <InventoryValueChart data={inventoryValueData} />
      </Card>
    </div>
  );

  // ── Tab 7: Employees ──
  const EmployeesTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Total Employees"
          value={String(employeeStats.totalEmployees)}
        />
        <MetricCard label="Admins" value={String(employeeStats.admins)} />
        <MetricCard
          label="Active Now"
          value={String(employeeStats.activeNow)}
        />
        <MetricCard
          label="Avg Jobs/Employee"
          value={employeeStats.avgJobsPerEmployee.toFixed(1)}
        />
      </div>

      <Card variant="default" className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-[#005F6A]/10 rounded-lg">
              <Users className="w-4 h-4 text-[#005F6A]" />
            </div>
            <h3 className="text-sm font-[350] text-[#005F6A]/80">
              Employee Performance
            </h3>
          </div>
          <Link href="/employees">
            <Button variant="ghost" size="sm" className="text-xs">
              View All
            </Button>
          </Link>
        </div>
        {employeePerformance.length > 0 ? (
          <div className="overflow-x-auto">
            <div className="min-w-max">
              <div className="flex bg-[#005F6A]/5 rounded-t-xl">
                {[
                  { label: "Employee", className: "w-[180px] text-left" },
                  { label: "Jobs", className: "w-[80px] text-center" },
                  { label: "Completed", className: "w-[100px] text-center" },
                  { label: "Rate", className: "w-[80px] text-center" },
                  { label: "Revenue", className: "w-[120px] text-right" },
                  { label: "Avg/Job", className: "w-[100px] text-right" },
                ].map((col) => (
                  <div
                    key={col.label}
                    className={`p-3 text-xs font-[350] !text-[#005F6A]/40 uppercase !tracking-wider ${col.className}`}>
                    {col.label}
                  </div>
                ))}
              </div>
              <div className="divide-y divide-[#005F6A]/4">
                {employeePerformance.map((emp, idx) => (
                  <Link
                    key={emp.id}
                    href={`/employees/${emp.id}`}
                    className="flex items-center hover:bg-[#005F6A]/1 transition-colors">
                    <div className="w-[180px] p-3 flex items-center gap-2">
                      {idx === 0 && (
                        <Badge variant="cleano" size="sm">
                          Top
                        </Badge>
                      )}
                      <p className="app-title-small truncate">{emp.name}</p>
                    </div>
                    <div className="w-[80px] p-3 text-center">
                      <p className="app-title-small">{emp.totalJobs}</p>
                    </div>
                    <div className="w-[100px] p-3 text-center">
                      <p className="app-title-small">{emp.completedJobs}</p>
                    </div>
                    <div className="w-[80px] p-3 text-center">
                      <Badge
                        variant={
                          emp.completionRate >= 80 ? "success" : "default"
                        }
                        size="sm"
                        className="px-2 py-1">
                        {emp.completionRate.toFixed(0)}%
                      </Badge>
                    </div>
                    <div className="w-[120px] p-3 text-right">
                      <p className="app-title-small">
                        ${emp.totalRevenue.toFixed(2)}
                      </p>
                    </div>
                    <div className="w-[100px] p-3 text-right">
                      <p className="app-title-small !text-[#005F6A]/50">
                        ${emp.avgJobPrice.toFixed(2)}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-[#005F6A]/60 text-center py-8">
            No employee data yet
          </p>
        )}
      </Card>

      <Card variant="default" className="p-6">
        <div className="flex items-center gap-2 mb-6">
          <div className="p-2 bg-[#005F6A]/10 rounded-lg">
            <TrendingUp className="w-4 h-4 text-[#005F6A]" />
          </div>
          <h3 className="text-sm font-[350] text-[#005F6A]/80">
            Jobs by Employee
          </h3>
        </div>
        {employeePerformance.length > 0 ? (
          <CBarChart
            data={employeePerformance.slice(0, 8).map((e) => ({
              name: e.name,
              Jobs: e.totalJobs,
              Completed: e.completedJobs,
            }))}
            dataKeys={["Jobs", "Completed"]}
            xKey="name"
            height={300}
          />
        ) : (
          <p className="text-sm text-[#005F6A]/60 text-center py-8">
            No data yet
          </p>
        )}
      </Card>
    </div>
  );

  // ── Tab 8: Payments ──
  const PaymentsTab = () => {
    const getDefaultStartDate = () => {
      const date = new Date();
      date.setDate(1);
      return date.toISOString().split("T")[0];
    };

    const getDefaultEndDate = () => {
      return new Date().toISOString().split("T")[0];
    };

    const [startDate, setStartDate] = React.useState(getDefaultStartDate());
    const [endDate, setEndDate] = React.useState(getDefaultEndDate());

    const calculateEmployeePayments = () => {
      const startDateTime = startDate ? new Date(startDate).getTime() : 0;
      const endDateTime = endDate
        ? new Date(endDate).setHours(23, 59, 59, 999)
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

    return (
      <div className="space-y-6">
        <Card variant="cleano_light" className="p-6">
          <div className="space-y-4">
            <div>
              <label className="text-xs font-[350] text-[#005F6A]/70 uppercase tracking-wide mb-2 block">
                Quick Select
              </label>
              <div className="flex flex-wrap gap-2">
                {["today", "week", "month", "lastMonth", "all"].map((preset) => (
                  <Button
                    key={preset}
                    variant="default"
                    size="sm"
                    border={false}
                    onClick={() => setDateRange(preset)}
                    className="rounded-xl px-4 py-2">
                    {preset === "today"
                      ? "Today"
                      : preset === "week"
                      ? "Last 7 Days"
                      : preset === "month"
                      ? "This Month"
                      : preset === "lastMonth"
                      ? "Last Month"
                      : "All Time"}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex flex-col lg:flex-row gap-4">
              <div className="flex-1">
                <label className="text-xs font-[350] text-[#005F6A]/70 uppercase tracking-wide mb-2 block">
                  Start Date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-[#005F6A]/10 bg-white text-sm text-[#005F6A] focus:outline-none focus:ring-2 focus:ring-[#005F6A]/20"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs font-[350] text-[#005F6A]/70 uppercase tracking-wide mb-2 block">
                  End Date
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-[#005F6A]/10 bg-white text-sm text-[#005F6A] focus:outline-none focus:ring-2 focus:ring-[#005F6A]/20"
                />
              </div>
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricCard
            label="Total Owed"
            value={`$${totalOwed.toFixed(2)}`}
            variant="success"
          />
          <MetricCard
            label="Employees"
            value={String(employeePayments.length)}
          />
          <MetricCard
            label="Jobs Completed"
            value={String(
              employeePayments.reduce((sum, emp) => sum + emp.jobsCount, 0)
            )}
          />
        </div>

        <Card variant="default" className="p-0">
          <div className="p-6 border-b border-[#005F6A]/10">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-[#005F6A]/10 rounded-lg">
                    <DollarSign className="w-4 h-4 text-[#005F6A]" />
                  </div>
                  <h3 className="text-sm font-[350] text-[#005F6A]/80">
                    Employee Payment Summary
                  </h3>
                </div>
                {(startDate || endDate) && (
                  <p className="text-xs text-[#005F6A]/60 mt-2">
                    {startDate && endDate
                      ? `${new Date(startDate).toLocaleDateString()} - ${new Date(endDate).toLocaleDateString()}`
                      : startDate
                      ? `From ${new Date(startDate).toLocaleDateString()}`
                      : `Until ${new Date(endDate).toLocaleDateString()}`}
                  </p>
                )}
              </div>
              {employeePayments.length > 0 && (
                <Button
                  variant="default"
                  size="sm"
                  border={false}
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
                  }}
                  className="rounded-xl px-4 py-2">
                  Export CSV
                </Button>
              )}
            </div>
          </div>

          {employeePayments.length > 0 ? (
            <>
              <div className="hidden md:block overflow-x-auto">
                <div className="min-w-max">
                  <div className="flex bg-[#005F6A]/5">
                    {[
                      { label: "Employee Name", className: "w-[220px]" },
                      { label: "Jobs", className: "w-[100px]" },
                      { label: "Amount Owed", className: "w-[150px]" },
                      { label: "Avg/Job", className: "w-[120px]" },
                      { label: "Actions", className: "w-[180px]" },
                    ].map((col) => (
                      <div
                        key={col.label}
                        className={`${col.className} p-4 text-left text-xs font-[350] !text-[#005F6A]/40 uppercase tracking-wide`}>
                        {col.label}
                      </div>
                    ))}
                  </div>
                  <div className="divide-y divide-[#005F6A]/4">
                    {employeePayments.map((emp) => (
                      <div
                        key={emp.id}
                        className="flex items-center hover:bg-[#005F6A]/1 transition-colors">
                        <div className="w-[220px] p-4">
                          <p className="text-sm font-[350] text-[#005F6A] truncate">
                            {emp.name}
                          </p>
                        </div>
                        <div className="w-[100px] p-4">
                          <p className="text-sm font-[350] text-[#005F6A]">
                            {emp.jobsCount}
                          </p>
                        </div>
                        <div className="w-[150px] p-4">
                          <Badge variant="success" size="sm" className="px-3 py-1.5">
                            ${emp.totalOwed.toFixed(2)}
                          </Badge>
                        </div>
                        <div className="w-[120px] p-4">
                          <p className="text-sm font-[350] text-[#005F6A]/60">
                            ${(emp.totalOwed / emp.jobsCount).toFixed(2)}
                          </p>
                        </div>
                        <div className="w-[180px] p-4">
                          <Link href={`/employees/${emp.id}`}>
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
                          <p className="text-sm font-[400] text-[#005F6A]">
                            {emp.name}
                          </p>
                          <p className="text-xs text-[#005F6A]/70 mt-1">
                            {emp.jobsCount} jobs • $
                            {(emp.totalOwed / emp.jobsCount).toFixed(2)} avg
                          </p>
                        </div>
                        <Badge variant="success" size="sm" className="px-3 py-1.5">
                          ${emp.totalOwed.toFixed(2)}
                        </Badge>
                      </div>
                      <Link href={`/employees/${emp.id}`}>
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
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-[#005F6A]/5 rounded-full flex items-center justify-center mx-auto mb-3">
                <DollarSign className="w-8 h-8 text-[#005F6A]/40" />
              </div>
              <p className="text-sm font-[350] text-[#005F6A]/70">
                No payments found
              </p>
              <p className="text-xs font-[350] text-[#005F6A]/60 mt-1">
                Employee payments for completed jobs will appear here
              </p>
            </div>
          )}
        </Card>
      </div>
    );
  };

  // ── Tab 9: Alerts ──
  const AlertsTab = () => {
    const unreadCount = alerts.filter((a) => !a.isRead).length;

    const severityConfig: Record<
      string,
      { color: string; bg: string; border: string }
    > = {
      CRITICAL: {
        color: "text-red-700",
        bg: "bg-red-50",
        border: "border-red-200",
      },
      WARNING: {
        color: "text-yellow-700",
        bg: "bg-yellow-50",
        border: "border-yellow-200",
      },
      INFO: {
        color: "text-blue-700",
        bg: "bg-blue-50",
        border: "border-blue-200",
      },
    };

    const typeIcons: Record<string, React.ReactNode> = {
      LOW_INVENTORY: <Package className="w-4 h-4" />,
      CANCELLATION: <Briefcase className="w-4 h-4" />,
      OVERDUE_PAYMENT: <DollarSign className="w-4 h-4" />,
      GENERAL: <Bell className="w-4 h-4" />,
    };

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricCard label="Total Alerts" value={String(alerts.length)} />
          <MetricCard
            label="Unread"
            value={String(unreadCount)}
            variant={unreadCount > 0 ? "warning" : "default"}
          />
          <MetricCard
            label="Critical"
            value={String(
              alerts.filter((a) => a.severity === "CRITICAL").length
            )}
            variant={
              alerts.some((a) => a.severity === "CRITICAL")
                ? "warning"
                : "default"
            }
          />
        </div>

        {alerts.length > 0 ? (
          <div className="space-y-3">
            {alerts.map((alert) => {
              const config = severityConfig[alert.severity] || severityConfig.INFO;
              return (
                <Card key={alert.id} variant="default" className="p-0">
                  <div
                    className={`p-4 ${config.bg} border-l-4 ${config.border} rounded-xl`}>
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 ${config.color}`}>
                          {typeIcons[alert.type] || typeIcons.GENERAL}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className={`text-sm font-[400] ${config.color}`}>
                              {alert.title}
                            </p>
                            {!alert.isRead && (
                              <span className="w-2 h-2 bg-[#005F6A] rounded-full" />
                            )}
                          </div>
                          <p className="text-xs text-[#005F6A]/60 mt-1">
                            {alert.message}
                          </p>
                          <div className="flex items-center gap-3 mt-2">
                            <Badge variant="default" size="sm">
                              {alert.type.replace(/_/g, " ")}
                            </Badge>
                            <span className="text-xs text-[#005F6A]/40">
                              {new Date(alert.createdAt).toLocaleDateString()}{" "}
                              {new Date(alert.createdAt).toLocaleTimeString()}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {!alert.isRead && (
                          <Button
                            variant="ghost"
                            size="sm"
                            border={false}
                            onClick={async () => {
                              await markAlertRead(alert.id);
                            }}
                            className="text-xs rounded-xl px-3 py-1">
                            Mark Read
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          border={false}
                          onClick={async () => {
                            await dismissAlert(alert.id);
                          }}
                          className="text-xs rounded-xl px-3 py-1">
                          Dismiss
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card variant="default" className="p-12 text-center">
            <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 className="w-8 h-8 text-green-500" />
            </div>
            <p className="text-sm font-[350] text-[#005F6A]/70">
              No active alerts
            </p>
            <p className="text-xs text-[#005F6A]/50 mt-1">
              Alerts for low inventory, cancellations, and overdue payments will
              appear here
            </p>
          </Card>
        )}
      </div>
    );
  };

  // ── Tab 10: Marketing ──
  const MarketingTab = () => (
    <div className="space-y-6">
      <Card variant="default" className="p-12 text-center">
        <div className="w-16 h-16 bg-[#005F6A]/5 rounded-full flex items-center justify-center mx-auto mb-3">
          <Megaphone className="w-8 h-8 text-[#005F6A]/40" />
        </div>
        <p className="text-sm font-[350] text-[#005F6A]/70">
          Marketing Analytics
        </p>
        <p className="text-xs text-[#005F6A]/50 mt-1">
          Campaign performance and landing page analytics will appear here once
          the Sales & Marketing module (Phase 8) is configured
        </p>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard label="Active Campaigns" value="0" subValue="No campaigns yet" />
        <MetricCard label="Page Visits" value="0" subValue="No landing pages yet" />
        <MetricCard label="Conversion Rate" value="0%" subValue="No data yet" />
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl !font-light tracking-tight text-[#005F6A]">
          Analytics & Reports
        </h1>
        <p className="text-sm text-[#005F6A]/70 mt-1">
          Comprehensive insights into your business performance
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 bg-[#005F6A]/5 rounded-2xl p-1 w-fit overflow-x-auto max-w-full">
        {MENU_ITEMS.map((item) => {
          const isActive = activeView === item.id;
          const alertCount =
            item.id === "alerts"
              ? alerts.filter((a) => !a.isRead).length
              : 0;
          return (
            <Button
              key={item.id}
              border={false}
              onClick={() => setActiveView(item.id)}
              variant={isActive ? "action" : "ghost"}
              size="md"
              className="rounded-xl px-4 md:px-5 py-3 whitespace-nowrap relative">
              <span className="mr-2 hidden sm:inline">{item.icon}</span>
              {item.label}
              {alertCount > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 text-[10px] font-[500] bg-red-500 text-white rounded-full">
                  {alertCount}
                </span>
              )}
            </Button>
          );
        })}
      </div>

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
