import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import {
  Briefcase,
  DollarSign,
  Users,
  Package,
  AlertTriangle,
  TrendingUp,
  Calendar,
  Clock,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";

export default async function DashboardPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  const { user } = session;
  const userWithRole = user as typeof user & {
    role: "OWNER" | "ADMIN" | "EMPLOYEE";
  };
  const isAdmin =
    userWithRole.role === "OWNER" || userWithRole.role === "ADMIN";

  // Fetch dashboard data
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const startOfToday = new Date(now.setHours(0, 0, 0, 0));

  // Jobs metrics
  const [
    totalJobs,
    completedJobs,
    inProgressJobs,
    pendingPaymentJobs,
    todaysJobs,
    upcomingJobs,
    recentJobs,
  ] = await Promise.all([
    db.job.count(),
    db.job.count({ where: { status: "COMPLETED" } }),
    db.job.count({ where: { status: "IN_PROGRESS" } }),
    db.job.count({
      where: { status: "COMPLETED", paymentReceived: false },
    }),
    db.job.count({
      where: {
        jobDate: {
          gte: startOfToday,
          lt: new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000),
        },
      },
    }),
    db.job.findMany({
      where: {
        jobDate: { gte: new Date() },
        status: { in: ["CREATED", "SCHEDULED"] },
      },
      orderBy: { jobDate: "asc" },
      take: 5,
      include: {
        cleaners: { select: { id: true, name: true } },
      },
    }),
    db.job.findMany({
      where: { status: "COMPLETED" },
      orderBy: { updatedAt: "desc" },
      take: 5,
      include: {
        cleaners: { select: { id: true, name: true } },
      },
    }),
  ]);

  // Revenue calculation
  const revenueData = await db.job.aggregate({
    where: { status: { in: ["COMPLETED", "PAID"] } },
    _sum: { price: true },
  });
  const totalRevenue = revenueData._sum.price || 0;

  // Monthly revenue
  const monthlyRevenueData = await db.job.aggregate({
    where: {
      status: { in: ["COMPLETED", "PAID"] },
      createdAt: { gte: thirtyDaysAgo },
    },
    _sum: { price: true },
  });
  const monthlyRevenue = monthlyRevenueData._sum.price || 0;

  // Employee metrics (admin only)
  let employeeCount = 0;
  let activeEmployees = 0;
  if (isAdmin) {
    [employeeCount, activeEmployees] = await Promise.all([
      db.user.count(),
      db.user.count({
        where: {
          cleaningJobs: {
            some: { status: "IN_PROGRESS" },
          },
        },
      }),
    ]);
  }

  // Inventory metrics (admin only)
  let totalProducts = 0;
  let lowStockProducts: Array<{
    id: string;
    name: string;
    stockLevel: number;
    minStock: number;
    unit: string;
  }> = [];
  let totalInventoryValue = 0;
  if (isAdmin) {
    const products = await db.product.findMany();
    totalProducts = products.length;
    lowStockProducts = products
      .filter((p) => p.stockLevel <= p.minStock)
      .slice(0, 5);
    totalInventoryValue = products.reduce(
      (sum, p) => sum + p.stockLevel * p.costPerUnit,
      0
    );
  }

  // User's personal stats (for employees)
  let myJobsCount = 0;
  let myCompletedJobs = 0;
  let myUpcomingJobs: typeof upcomingJobs = [];
  if (!isAdmin) {
    [myJobsCount, myCompletedJobs, myUpcomingJobs] = await Promise.all([
      db.job.count({
        where: { cleaners: { some: { id: user.id } } },
      }),
      db.job.count({
        where: {
          cleaners: { some: { id: user.id } },
          status: "COMPLETED",
        },
      }),
      db.job.findMany({
        where: {
          cleaners: { some: { id: user.id } },
          jobDate: { gte: new Date() },
          status: { in: ["CREATED", "SCHEDULED"] },
        },
        orderBy: { jobDate: "asc" },
        take: 5,
        include: {
          cleaners: { select: { id: true, name: true } },
        },
      }),
    ]);
  }

  // Metric Card Component
  const MetricCard = ({
    label,
    value,
    subValue,
    icon: Icon,
    variant = "default",
    href,
  }: {
    label: string;
    value: string;
    subValue?: string;
    icon: React.ElementType;
    variant?: "default" | "warning";
    href?: string;
  }) => {
    const content = (
      <Card
        variant={variant === "warning" ? "warning" : "cleano_light"}
        className={`p-6 h-[7rem] ${
          href ? "hover:bg-[#005F6A]/8 transition-colors cursor-pointer" : ""
        }`}>
        <div className="h-full flex flex-col justify-between">
          <span
            className={`app-title-small ${
              variant === "warning" ? "text-yellow-700" : "!text-[#005F6A]/70"
            }`}>
            {label}
          </span>
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

    if (href) {
      return <Link href={href}>{content}</Link>;
    }
    return content;
  };

  return (
    <div className="space-y-8 p-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl !font-light tracking-tight text-[#005F6A]">
          Welcome back, {user.name}!
        </h1>
        <p className="text-sm text-[#005F6A]/70 mt-1">
          Here&apos;s what&apos;s happening with your business today
        </p>
      </div>

      {/* Admin/Owner Metrics */}
      {isAdmin ? (
        <>
          {/* Primary Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              label="Total Revenue"
              value={`$${totalRevenue.toFixed(2)}`}
              subValue={`$${monthlyRevenue.toFixed(2)} this month`}
              icon={DollarSign}
              href="/jobs"
            />
            <MetricCard
              label="Total Jobs"
              value={String(totalJobs)}
              subValue={`${completedJobs} completed`}
              icon={Briefcase}
              href="/jobs"
            />
            <MetricCard
              label="Employees"
              value={String(employeeCount)}
              subValue={`${activeEmployees} active now`}
              icon={Users}
              href="/employees"
            />
            <MetricCard
              label="Products"
              value={String(totalProducts)}
              subValue={`$${totalInventoryValue.toFixed(0)} value`}
              icon={Package}
              href="/inventory"
            />
          </div>

          {/* Secondary Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              label="Today's Jobs"
              value={String(todaysJobs)}
              icon={Calendar}
              href="/jobs"
            />
            <MetricCard
              label="In Progress"
              value={String(inProgressJobs)}
              icon={Clock}
              href="/jobs?status=IN_PROGRESS"
            />
            {pendingPaymentJobs > 0 && (
              <MetricCard
                label="Pending Payment"
                value={String(pendingPaymentJobs)}
                icon={AlertTriangle}
                variant="warning"
                href="/jobs?payment=pending"
              />
            )}
            {lowStockProducts.length > 0 && (
              <MetricCard
                label="Low Stock Items"
                value={String(lowStockProducts.length)}
                icon={AlertTriangle}
                variant="warning"
                href="/inventory?status=low"
              />
            )}
          </div>

          {/* Two Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Upcoming Jobs */}
            <Card variant="default" className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-[#005F6A]/10 rounded-lg">
                    <Calendar className="w-4 h-4 text-[#005F6A]" />
                  </div>
                  <h2 className="text-sm font-[350] text-[#005F6A]/80">
                    Upcoming Jobs
                  </h2>
                </div>
                <Link href="/jobs">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-[#005F6A]/60">
                    View All
                    <ArrowRight className="w-3 h-3 ml-1" />
                  </Button>
                </Link>
              </div>

              {upcomingJobs.length === 0 ? (
                <div className="text-center py-8">
                  <div className="w-12 h-12 bg-[#005F6A]/5 rounded-2xl flex items-center justify-center mx-auto mb-3">
                    <Calendar className="w-6 h-6 text-[#005F6A]/40" />
                  </div>
                  <p className="text-sm text-[#005F6A]/60">No upcoming jobs</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {upcomingJobs.map((job) => (
                    <Link
                      key={job.id}
                      href={`/jobs/${job.id}`}
                      className="flex items-center justify-between p-3 rounded-xl bg-[#005F6A]/5 hover:bg-[#005F6A]/8 transition-colors">
                      <div className="flex-1">
                        <p className="text-sm font-[400] text-[#005F6A]">
                          {job.clientName}
                        </p>
                        <p className="text-xs text-[#005F6A]/60">
                          {job.jobDate
                            ? new Date(job.jobDate).toLocaleDateString()
                            : "No date"}{" "}
                          •{" "}
                          {job.cleaners.length > 0
                            ? job.cleaners.map((c) => c.name).join(", ")
                            : "Unassigned"}
                        </p>
                      </div>
                      {job.price && (
                        <span className="text-sm font-[400] text-[#005F6A]">
                          ${job.price.toFixed(2)}
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              )}
            </Card>

            {/* Recent Completed Jobs */}
            <Card variant="default" className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-[#005F6A]/10 rounded-lg">
                    <CheckCircle2 className="w-4 h-4 text-[#005F6A]" />
                  </div>
                  <h2 className="text-sm font-[350] text-[#005F6A]/80">
                    Recent Completed
                  </h2>
                </div>
                <Link href="/jobs?status=COMPLETED">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-[#005F6A]/60">
                    View All
                    <ArrowRight className="w-3 h-3 ml-1" />
                  </Button>
                </Link>
              </div>

              {recentJobs.length === 0 ? (
                <div className="text-center py-8">
                  <div className="w-12 h-12 bg-[#005F6A]/5 rounded-2xl flex items-center justify-center mx-auto mb-3">
                    <CheckCircle2 className="w-6 h-6 text-[#005F6A]/40" />
                  </div>
                  <p className="text-sm text-[#005F6A]/60">
                    No completed jobs yet
                  </p>
                </div>
              ) : (
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
                          {new Date(job.updatedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={job.paymentReceived ? "success" : "warning"}
                          size="sm"
                          className="px-2 py-1">
                          {job.paymentReceived ? "Paid" : "Unpaid"}
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
              )}
            </Card>
          </div>

          {/* Low Stock Alert */}
          {lowStockProducts.length > 0 && (
            <Card variant="warning" className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-yellow-100 rounded-lg">
                    <AlertTriangle className="w-4 h-4 text-yellow-600" />
                  </div>
                  <h2 className="text-sm font-[350] text-yellow-700">
                    Low Stock Alert
                  </h2>
                </div>
                <Link href="/inventory?status=low">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-yellow-700">
                    View All
                    <ArrowRight className="w-3 h-3 ml-1" />
                  </Button>
                </Link>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {lowStockProducts.map((product) => (
                  <Link
                    key={product.id}
                    href={`/inventory/${product.id}`}
                    className="p-3 rounded-xl bg-yellow-50 border border-yellow-200 hover:bg-yellow-100 transition-colors">
                    <p className="text-sm font-[400] text-yellow-800">
                      {product.name}
                    </p>
                    <p className="text-xs text-yellow-600 mt-1">
                      {product.stockLevel} / {product.minStock} {product.unit}
                    </p>
                  </Link>
                ))}
              </div>
            </Card>
          )}

          {/* Quick Actions */}
          <div>
            <h2 className="text-lg font-[350] tracking-tight text-[#005F6A] mb-4">
              Quick Actions
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <QuickAction title="New Job" href="/jobs" icon={Briefcase} />
              <QuickAction title="Employees" href="/employees" icon={Users} />
              <QuickAction title="Inventory" href="/inventory" icon={Package} />
              <QuickAction
                title="Analytics"
                href="/analytics"
                icon={TrendingUp}
              />
              <QuickAction title="All Jobs" href="/jobs" icon={Calendar} />
              <QuickAction
                title="Settings"
                href="/settings"
                icon={CheckCircle2}
              />
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Employee View */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <MetricCard
              label="My Total Jobs"
              value={String(myJobsCount)}
              icon={Briefcase}
              href="/my-jobs"
            />
            <MetricCard
              label="Completed"
              value={String(myCompletedJobs)}
              icon={CheckCircle2}
              href="/my-jobs"
            />
            <MetricCard
              label="Upcoming"
              value={String(myUpcomingJobs.length)}
              icon={Calendar}
              href="/my-jobs"
            />
          </div>

          {/* My Upcoming Jobs */}
          <Card variant="default" className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-[#005F6A]/10 rounded-lg">
                  <Calendar className="w-4 h-4 text-[#005F6A]" />
                </div>
                <h2 className="text-sm font-[350] text-[#005F6A]/80">
                  My Upcoming Jobs
                </h2>
              </div>
              <Link href="/my-jobs">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-[#005F6A]/60">
                  View All
                  <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
              </Link>
            </div>

            {myUpcomingJobs.length === 0 ? (
              <div className="text-center py-8">
                <div className="w-12 h-12 bg-[#005F6A]/5 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <Calendar className="w-6 h-6 text-[#005F6A]/40" />
                </div>
                <p className="text-sm text-[#005F6A]/60">No upcoming jobs</p>
              </div>
            ) : (
              <div className="space-y-2">
                {myUpcomingJobs.map((job) => (
                  <Link
                    key={job.id}
                    href={`/my-jobs/${job.id}`}
                    className="flex items-center justify-between p-3 rounded-xl bg-[#005F6A]/5 hover:bg-[#005F6A]/8 transition-colors">
                    <div className="flex-1">
                      <p className="text-sm font-[400] text-[#005F6A]">
                        {job.clientName}
                      </p>
                      <p className="text-xs text-[#005F6A]/60">
                        {job.jobDate
                          ? new Date(job.jobDate).toLocaleDateString()
                          : "No date"}{" "}
                        at{" "}
                        {new Date(job.startTime).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    {job.jobType && (
                      <Badge variant="cleano" size="sm">
                        {job.jobType}
                      </Badge>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </Card>

          {/* Quick Actions for Employee */}
          <div>
            <h2 className="text-lg font-[350] tracking-tight text-[#005F6A] mb-4">
              Quick Actions
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <QuickAction title="My Jobs" href="/my-jobs" icon={Briefcase} />
              <QuickAction
                title="Request Inventory"
                href="/my-requests"
                icon={Package}
              />
              <QuickAction
                title="Settings"
                href="/settings"
                icon={CheckCircle2}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function QuickAction({
  title,
  href,
  icon: Icon,
}: {
  title: string;
  href: string;
  icon: React.ElementType;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center justify-center p-4 bg-white rounded-2xl border border-[#005F6A]/10 hover:border-[#005F6A]/20 hover:bg-[#005F6A]/5 transition-colors gap-2">
      <div className="p-2 bg-[#005F6A]/10 rounded-xl">
        <Icon className="w-5 h-5 text-[#005F6A]" />
      </div>
      <span className="text-sm font-[350] text-[#005F6A]">{title}</span>
    </Link>
  );
}
