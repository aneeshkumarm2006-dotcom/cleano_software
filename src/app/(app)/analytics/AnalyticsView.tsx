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
} from "lucide-react";

type TabView =
  | "overview"
  | "revenue"
  | "jobs"
  | "inventory"
  | "employees"
  | "payments";

const MENU_ITEMS: Array<{ id: TabView; label: string; icon: React.ReactNode }> =
  [
    {
      id: "overview",
      label: "Overview",
      icon: <BarChart3 className="w-4 h-4" />,
    },
    {
      id: "revenue",
      label: "Revenue",
      icon: <DollarSign className="w-4 h-4" />,
    },
    { id: "jobs", label: "Jobs", icon: <Briefcase className="w-4 h-4" /> },
    {
      id: "inventory",
      label: "Inventory",
      icon: <Package className="w-4 h-4" />,
    },
    {
      id: "employees",
      label: "Employees",
      icon: <Users className="w-4 h-4" />,
    },
    {
      id: "payments",
      label: "Payments",
      icon: <DollarSign className="w-4 h-4" />,
    },
  ];

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
  profit: number;
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
}

// Simple Bar Chart Component
function BarChart({
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
      <p className="text-xs text-[#005F6A]/60 uppercase tracking-wide">
        {label}
      </p>
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

// Progress Ring Component
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

// Metric Card Component
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
}: AnalyticsViewProps) {
  const [activeView, setActiveView] = useState<TabView>("overview");

  // Overview Tab
  const OverviewTab = () => (
    <div className="space-y-6">
      {/* Key Metrics */}
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

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly Revenue Chart */}
        <Card variant="default" className="p-6">
          <div className="flex items-center gap-2 mb-6">
            <div className="p-2 bg-[#005F6A]/10 rounded-lg">
              <TrendingUp className="w-4 h-4 text-[#005F6A]" />
            </div>
            <h3 className="text-sm font-[350] text-[#005F6A]/80">
              Monthly Revenue Trend
            </h3>
          </div>
          {monthlyData.length > 0 ? (
            <div className="space-y-4">
              {monthlyData.slice(-6).map((item, idx) => (
                <div key={idx} className="space-y-1">
                  <div className="flex justify-between text-xs text-[#005F6A]/70">
                    <span>{item.month}</span>
                    <span className="font-[400]">
                      ${item.revenue.toFixed(0)}
                    </span>
                  </div>
                  <div className="h-3 bg-[#005F6A]/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#005F6A] rounded-full transition-all duration-500"
                      style={{
                        width: `${
                          Math.max(...monthlyData.map((m) => m.revenue)) > 0
                            ? (item.revenue /
                                Math.max(
                                  ...monthlyData.map((m) => m.revenue)
                                )) *
                              100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#005F6A]/60 text-center py-8">
              No revenue data yet
            </p>
          )}
        </Card>

        {/* Job Type Breakdown */}
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
            <BarChart
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

      {/* Quick Stats Row */}
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

  // Revenue Tab
  const RevenueTab = () => (
    <div className="space-y-6">
      {/* Revenue Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Total Revenue"
          value={`$${revenueStats.totalRevenue.toFixed(2)}`}
        />
        <MetricCard
          label="This Month"
          value={`$${revenueStats.monthlyRevenue.toFixed(2)}`}
        />
        <MetricCard
          label="This Week"
          value={`$${revenueStats.weeklyRevenue.toFixed(2)}`}
        />
        <MetricCard
          label="Avg Job Price"
          value={`$${revenueStats.avgJobPrice.toFixed(2)}`}
        />
      </div>

      {/* Profit Analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card variant="default" className="p-6">
          <div className="flex items-center gap-2 mb-6">
            <div className="p-2 bg-[#005F6A]/10 rounded-lg">
              <DollarSign className="w-4 h-4 text-[#005F6A]" />
            </div>
            <h3 className="text-sm font-[350] text-[#005F6A]/80">
              Profit & Loss Breakdown
            </h3>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 rounded-xl bg-green-50">
              <span className="text-sm text-[#005F6A]/70">Total Revenue</span>
              <span className="text-sm font-[400] text-green-600">
                +${revenueStats.totalRevenue.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between items-center p-3 rounded-xl bg-[#005F6A]/5">
              <span className="text-sm text-[#005F6A]/70">Employee Pay</span>
              <span className="text-sm font-[400] text-[#005F6A]">
                -${revenueStats.totalEmployeePay.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between items-center p-3 rounded-xl bg-[#005F6A]/5">
              <span className="text-sm text-[#005F6A]/70">Product Costs</span>
              <span className="text-sm font-[400] text-[#005F6A]">
                -${revenueStats.totalProductCost.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between items-center p-3 rounded-xl bg-[#005F6A]/5">
              <span className="text-sm text-[#005F6A]/70">Parking</span>
              <span className="text-sm font-[400] text-[#005F6A]">
                -${revenueStats.totalParking.toFixed(2)}
              </span>
            </div>
            {revenueStats.totalTips > 0 && (
              <div className="flex justify-between items-center p-3 rounded-xl bg-green-50">
                <span className="text-sm text-[#005F6A]/70">Tips</span>
                <span className="text-sm font-[400] text-green-600">
                  +${revenueStats.totalTips.toFixed(2)}
                </span>
              </div>
            )}
            <div className="flex justify-between items-center p-3 rounded-xl bg-[#005F6A]/10 mt-2">
              <span className="text-sm font-[400] text-[#005F6A]">
                Net Profit
              </span>
              <span className="text-base font-[400] text-[#005F6A]">
                ${revenueStats.netProfit.toFixed(2)}
              </span>
            </div>
          </div>
        </Card>

        {/* Payment Status */}
        <Card variant="default" className="p-6">
          <div className="flex items-center gap-2 mb-6">
            <div className="p-2 bg-[#005F6A]/10 rounded-lg">
              <CheckCircle2 className="w-4 h-4 text-[#005F6A]" />
            </div>
            <h3 className="text-sm font-[350] text-[#005F6A]/80">
              Payment Status
            </h3>
          </div>
          <div className="flex justify-center mb-6">
            <div className="relative">
              <ProgressRing
                value={jobStats.completed - revenueStats.pendingPayments}
                max={jobStats.completed}
                label="Payments Collected"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-3 rounded-xl bg-green-50">
              <p className="text-lg font-[400] text-green-600">
                {jobStats.completed - revenueStats.pendingPayments}
              </p>
              <p className="text-xs text-green-600/70">Paid</p>
            </div>
            <div className="text-center p-3 rounded-xl bg-yellow-50">
              <p className="text-lg font-[400] text-yellow-600">
                {revenueStats.pendingPayments}
              </p>
              <p className="text-xs text-yellow-600/70">Pending</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Monthly Trend */}
      <Card variant="default" className="p-6">
        <div className="flex items-center gap-2 mb-6">
          <div className="p-2 bg-[#005F6A]/10 rounded-lg">
            <TrendingUp className="w-4 h-4 text-[#005F6A]" />
          </div>
          <h3 className="text-sm font-[350] text-[#005F6A]/80">
            Monthly Profit Trend
          </h3>
        </div>
        {monthlyData.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {monthlyData.slice(-6).map((item, idx) => (
              <div key={idx} className="text-center">
                <div className="h-24 flex items-end justify-center mb-2">
                  <div
                    className={`w-full max-w-12 rounded-t-lg transition-all duration-500 ${
                      item.profit >= 0 ? "bg-[#005F6A]" : "bg-red-400"
                    }`}
                    style={{
                      height: `${
                        Math.max(
                          ...monthlyData.map((m) => Math.abs(m.profit))
                        ) > 0
                          ? (Math.abs(item.profit) /
                              Math.max(
                                ...monthlyData.map((m) => Math.abs(m.profit))
                              )) *
                            100
                          : 0
                      }%`,
                    }}
                  />
                </div>
                <p className="text-xs text-[#005F6A]/60">{item.month}</p>
                <p className="text-sm font-[400] text-[#005F6A]">
                  ${item.profit.toFixed(0)}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[#005F6A]/60 text-center py-8">
            No data yet
          </p>
        )}
      </Card>
    </div>
  );

  // Jobs Tab
  const JobsTab = () => (
    <div className="space-y-6">
      {/* Job Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <MetricCard label="Total Jobs" value={String(jobStats.total)} />
        <MetricCard label="Completed" value={String(jobStats.completed)} />
        <MetricCard label="In Progress" value={String(jobStats.inProgress)} />
        <MetricCard label="Scheduled" value={String(jobStats.scheduled)} />
        <MetricCard
          label="Cancelled"
          value={String(jobStats.cancelled)}
          variant={jobStats.cancelled > 0 ? "warning" : "default"}
        />
      </div>

      {/* Job Analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Completion Rate */}
        <Card variant="default" className="p-6">
          <div className="flex items-center gap-2 mb-6">
            <div className="p-2 bg-[#005F6A]/10 rounded-lg">
              <CheckCircle2 className="w-4 h-4 text-[#005F6A]" />
            </div>
            <h3 className="text-sm font-[350] text-[#005F6A]/80">
              Job Completion Rate
            </h3>
          </div>
          <div className="flex justify-center">
            <div className="relative">
              <ProgressRing
                value={jobStats.completed}
                max={jobStats.total}
                label="Completion Rate"
                size={140}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 mt-6">
            <div className="text-center p-2 rounded-xl bg-[#005F6A]/5">
              <p className="text-lg font-[400] text-[#005F6A]">
                {jobStats.completed}
              </p>
              <p className="text-xs text-[#005F6A]/60">Completed</p>
            </div>
            <div className="text-center p-2 rounded-xl bg-[#005F6A]/5">
              <p className="text-lg font-[400] text-[#005F6A]">
                {jobStats.inProgress}
              </p>
              <p className="text-xs text-[#005F6A]/60">In Progress</p>
            </div>
            <div className="text-center p-2 rounded-xl bg-[#005F6A]/5">
              <p className="text-lg font-[400] text-[#005F6A]">
                {jobStats.scheduled}
              </p>
              <p className="text-xs text-[#005F6A]/60">Scheduled</p>
            </div>
          </div>
        </Card>

        {/* Job Types Revenue */}
        <Card variant="default" className="p-6">
          <div className="flex items-center gap-2 mb-6">
            <div className="p-2 bg-[#005F6A]/10 rounded-lg">
              <DollarSign className="w-4 h-4 text-[#005F6A]" />
            </div>
            <h3 className="text-sm font-[350] text-[#005F6A]/80">
              Revenue by Job Type
            </h3>
          </div>
          {jobTypeBreakdown.length > 0 ? (
            <div className="space-y-3">
              {jobTypeBreakdown.map((type, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 rounded-xl bg-[#005F6A]/5">
                  <div>
                    <p className="text-sm font-[400] text-[#005F6A]">
                      {type.type || "Unspecified"}
                    </p>
                    <p className="text-xs text-[#005F6A]/60">
                      {type.count} jobs
                    </p>
                  </div>
                  <p className="text-sm font-[400] text-[#005F6A]">
                    ${type.revenue.toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#005F6A]/60 text-center py-8">
              No job data yet
            </p>
          )}
        </Card>
      </div>

      {/* Recent Jobs */}
      <Card variant="default" className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-[#005F6A]/10 rounded-lg">
              <Calendar className="w-4 h-4 text-[#005F6A]" />
            </div>
            <h3 className="text-sm font-[350] text-[#005F6A]/80">
              Recent Jobs
            </h3>
          </div>
          <Link href="/jobs">
            <Button variant="ghost" size="sm" className="text-xs">
              View All
            </Button>
          </Link>
        </div>
        {recentJobs.length > 0 ? (
          <div className="space-y-2">
            {recentJobs.map((job) => (
              <Link
                key={job.id}
                href={`/jobs/${job.id}`}
                className="flex items-center justify-between p-3 rounded-xl bg-[#005F6A]/5 hover:bg-[#005F6A]/8 transition-colors">
                <div className="flex-1">
                  <p className="text-sm font-[400] text-[#005F6A]">
                    {job.clientName}
                  </p>
                  <p className="text-xs text-[#005F6A]/60">
                    {job.employeeName} • {job.date}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge
                    variant={
                      job.status === "COMPLETED"
                        ? "success"
                        : job.status === "IN_PROGRESS"
                        ? "secondary"
                        : "default"
                    }
                    size="sm"
                    className="px-2 py-1">
                    {job.status}
                  </Badge>
                  {job.price && (
                    <span className="text-sm font-[400] text-[#005F6A]">
                      ${job.price.toFixed(2)}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[#005F6A]/60 text-center py-8">
            No jobs yet
          </p>
        )}
      </Card>
    </div>
  );

  // Inventory Tab
  const InventoryTab = () => (
    <div className="space-y-6">
      {/* Inventory Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Total Products"
          value={String(inventoryStats.totalProducts)}
        />
        <MetricCard
          label="Inventory Value"
          value={`$${inventoryStats.totalValue.toFixed(2)}`}
        />
        <MetricCard
          label="Total Usage Cost"
          value={`$${inventoryStats.totalUsageCost.toFixed(2)}`}
        />
        <MetricCard
          label="Low Stock Items"
          value={String(inventoryStats.lowStockCount)}
          variant={inventoryStats.lowStockCount > 0 ? "warning" : "default"}
        />
      </div>

      {/* Product Usage & Low Stock */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Used Products */}
        <Card variant="default" className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-[#005F6A]/10 rounded-lg">
                <TrendingUp className="w-4 h-4 text-[#005F6A]" />
              </div>
              <h3 className="text-sm font-[350] text-[#005F6A]/80">
                Most Used Products
              </h3>
            </div>
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

        {/* Low Stock Alert */}
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

      {/* Usage by Product Chart */}
      <Card variant="default" className="p-6">
        <div className="flex items-center gap-2 mb-6">
          <div className="p-2 bg-[#005F6A]/10 rounded-lg">
            <Package className="w-4 h-4 text-[#005F6A]" />
          </div>
          <h3 className="text-sm font-[350] text-[#005F6A]/80">
            Product Usage Distribution
          </h3>
        </div>
        {productUsage.length > 0 ? (
          <BarChart
            data={productUsage.slice(0, 8).map((p) => ({
              label: p.name,
              value: p.usageCount,
            }))}
            maxValue={Math.max(...productUsage.map((p) => p.usageCount))}
            label="Times Used in Jobs"
          />
        ) : (
          <p className="text-sm text-[#005F6A]/60 text-center py-8">
            No usage data yet
          </p>
        )}
      </Card>
    </div>
  );

  // Employees Tab
  const EmployeesTab = () => (
    <div className="space-y-6">
      {/* Employee Metrics */}
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

      {/* Employee Performance Table */}
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
              {/* Header */}
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
              {/* Rows */}
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

      {/* Performance Chart */}
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
          <BarChart
            data={employeePerformance.slice(0, 8).map((e) => ({
              label: e.name,
              value: e.totalJobs,
            }))}
            maxValue={Math.max(...employeePerformance.map((e) => e.totalJobs))}
            label=""
          />
        ) : (
          <p className="text-sm text-[#005F6A]/60 text-center py-8">
            No data yet
          </p>
        )}
      </Card>
    </div>
  );

  // Payments Tab
  const PaymentsTab = () => {
    // Default to current month
    const getDefaultStartDate = () => {
      const date = new Date();
      date.setDate(1); // First day of current month
      return date.toISOString().split("T")[0];
    };

    const getDefaultEndDate = () => {
      const date = new Date();
      return date.toISOString().split("T")[0];
    };

    const [startDate, setStartDate] = React.useState(getDefaultStartDate());
    const [endDate, setEndDate] = React.useState(getDefaultEndDate());

    // Calculate payments for each employee within the date range
    const calculateEmployeePayments = () => {
      const startDateTime = startDate ? new Date(startDate).getTime() : 0;
      const endDateTime = endDate
        ? new Date(endDate).setHours(23, 59, 59, 999)
        : Date.now();

      // Filter jobs by date range
      const filteredJobs = paymentJobs.filter((job) => {
        const jobDate = new Date(job.startTime).getTime();
        return jobDate >= startDateTime && jobDate <= endDateTime;
      });

      // Group by employee and calculate totals
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

    // Quick date range presets
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
          const lastMonth = new Date(
            today.getFullYear(),
            today.getMonth() - 1,
            1
          );
          const lastMonthEnd = new Date(
            today.getFullYear(),
            today.getMonth(),
            0
          );
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
        {/* Date Range Filters */}
        <Card variant="cleano_light" className="p-6">
          <div className="space-y-4">
            {/* Quick Presets */}
            <div>
              <label className="text-xs font-[350] text-[#005F6A]/70 uppercase tracking-wide mb-2 block">
                Quick Select
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="default"
                  size="sm"
                  border={false}
                  onClick={() => setDateRange("today")}
                  className="rounded-xl px-4 py-2">
                  Today
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  border={false}
                  onClick={() => setDateRange("week")}
                  className="rounded-xl px-4 py-2">
                  Last 7 Days
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  border={false}
                  onClick={() => setDateRange("month")}
                  className="rounded-xl px-4 py-2">
                  This Month
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  border={false}
                  onClick={() => setDateRange("lastMonth")}
                  className="rounded-xl px-4 py-2">
                  Last Month
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  border={false}
                  onClick={() => setDateRange("all")}
                  className="rounded-xl px-4 py-2">
                  All Time
                </Button>
              </div>
            </div>

            {/* Custom Date Range */}
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

        {/* Summary Cards */}
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

        {/* Payments Table */}
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
                      ? `${new Date(
                          startDate
                        ).toLocaleDateString()} - ${new Date(
                          endDate
                        ).toLocaleDateString()}`
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
                    // Create CSV content
                    const headers = [
                      "Employee Name",
                      "Jobs",
                      "Amount Owed",
                      "Avg Per Job",
                    ];
                    const rows = employeePayments.map((emp) => [
                      emp.name,
                      emp.jobsCount.toString(),
                      emp.totalOwed.toFixed(2),
                      (emp.totalOwed / emp.jobsCount).toFixed(2),
                    ]);
                    const csvContent = [
                      headers.join(","),
                      ...rows.map((row) => row.join(",")),
                    ].join("\n");

                    // Download CSV
                    const blob = new Blob([csvContent], { type: "text/csv" });
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `employee-payments-${
                      new Date().toISOString().split("T")[0]
                    }.csv`;
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
              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto">
                <div className="min-w-max">
                  {/* Header */}
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

                  {/* Rows */}
                  <div className="divide-y divide-[#005F6A]/4">
                    {employeePayments.map((emp) => (
                      <div
                        key={emp.id}
                        className="flex items-center hover:bg-[#005F6A]/1 transition-colors">
                        {/* Employee Name */}
                        <div className="w-[220px] p-4">
                          <p className="text-sm font-[350] text-[#005F6A] truncate">
                            {emp.name}
                          </p>
                        </div>

                        {/* Jobs Count */}
                        <div className="w-[100px] p-4">
                          <p className="text-sm font-[350] text-[#005F6A]/100">
                            {emp.jobsCount}
                          </p>
                        </div>

                        {/* Amount Owed */}
                        <div className="w-[150px] p-4">
                          <Badge
                            variant="success"
                            size="sm"
                            className="px-3 py-1.5">
                            ${emp.totalOwed.toFixed(2)}
                          </Badge>
                        </div>

                        {/* Avg per Job */}
                        <div className="w-[120px] p-4">
                          <p className="text-sm font-[350] text-[#005F6A]/60">
                            ${(emp.totalOwed / emp.jobsCount).toFixed(2)}
                          </p>
                        </div>

                        {/* Actions */}
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

              {/* Mobile Card View */}
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
                        <Badge
                          variant="success"
                          size="sm"
                          className="px-3 py-1.5">
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
      <div className="flex items-center gap-2 bg-[#005F6A]/5 rounded-2xl p-1 w-fit overflow-x-auto">
        {MENU_ITEMS.map((item) => {
          const isActive = activeView === item.id;
          return (
            <Button
              key={item.id}
              border={false}
              onClick={() => setActiveView(item.id)}
              variant={isActive ? "action" : "ghost"}
              size="md"
              className="rounded-xl px-4 md:px-6 py-3 whitespace-nowrap">
              <span className="mr-2 hidden sm:inline">{item.icon}</span>
              {item.label}
            </Button>
          );
        })}
      </div>

      {/* Content Area */}
      <div className="flex-1">
        {activeView === "overview" && <OverviewTab />}
        {activeView === "revenue" && <RevenueTab />}
        {activeView === "jobs" && <JobsTab />}
        {activeView === "inventory" && <InventoryTab />}
        {activeView === "employees" && <EmployeesTab />}
        {activeView === "payments" && <PaymentsTab />}
      </div>
    </div>
  );
}
