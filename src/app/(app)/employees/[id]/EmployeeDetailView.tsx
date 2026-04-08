"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { EmployeeModal } from "../EmployeeModal";
import {
  ArrowLeft,
  Mail,
  Phone,
  Calendar,
  DollarSign,
  CheckCircle2,
  AlertTriangle,
  Pencil,
  Briefcase,
  Package,
  History,
  User,
} from "lucide-react";

type TabView = "overview" | "jobs" | "products";

const MENU_ITEMS: Array<{ id: TabView; label: string; icon: React.ReactNode }> =
  [
    {
      id: "overview",
      label: "Overview",
      icon: <User className="w-4 h-4" />,
    },
    {
      id: "jobs",
      label: "Jobs",
      icon: <Briefcase className="w-4 h-4" />,
    },
    {
      id: "products",
      label: "Products",
      icon: <Package className="w-4 h-4" />,
    },
  ];

interface Employee {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: "OWNER" | "ADMIN" | "EMPLOYEE";
}

interface Job {
  id: string;
  clientName: string;
  jobType: string | null;
  startTime: string;
  price: number | null;
  status: string;
  paymentReceived: boolean;
}

interface ProductUsage {
  name: string;
  quantity: number;
  unit: string;
}

interface AssignedProduct {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unit: string;
  costPerUnit: number;
}

interface EmployeeDetailViewProps {
  employee: Employee;
  stats: {
    completedJobsCount: number;
    totalRevenue: number;
    totalPaid: number;
    totalTips: number;
    unpaidJobs: number;
  };
  upcomingJobs: Job[];
  recentJobs: Job[];
  topProducts: ProductUsage[];
  assignedProducts: AssignedProduct[];
}

export default function EmployeeDetailView({
  employee,
  stats,
  upcomingJobs,
  recentJobs,
  topProducts,
  assignedProducts,
}: EmployeeDetailViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [activeView, setActiveView] = useState<TabView>("overview");
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Sync activeView with URL params
  useEffect(() => {
    const viewParam = (searchParams.get("tab") as TabView) || "overview";
    if (MENU_ITEMS.some((item) => item.id === viewParam)) {
      setActiveView(viewParam);
    }
  }, [searchParams]);

  const updateView = (view: TabView) => {
    setActiveView(view);
    const params = new URLSearchParams(searchParams.toString());

    if (view === "overview") {
      params.delete("tab");
    } else {
      params.set("tab", view);
    }

    const query = params.toString();
    router.replace(
      query
        ? `/employees/${employee.id}?${query}`
        : `/employees/${employee.id}`,
      { scroll: false }
    );
  };

  const getRoleBadge = (role: string) => {
    const roleConfig: Record<string, { variant: any; label: string }> = {
      OWNER: { variant: "cleano", label: "Owner" },
      ADMIN: { variant: "secondary", label: "Admin" },
      EMPLOYEE: { variant: "default", label: "Employee" },
    };
    const config = roleConfig[role] || { variant: "default", label: role };
    return (
      <Badge variant={config.variant} size="md">
        {config.label}
      </Badge>
    );
  };

  // Metric Card Component
  const MetricCard = ({
    label,
    value,
    subValue,
    variant = "default",
  }: {
    label: string;
    value: string;
    subValue?: string;
    variant?: "default" | "warning";
  }) => (
    <Card
      variant={variant === "warning" ? "warning" : "cleano_light"}
      className="p-6 h-[7rem]">
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

  // Overview Tab Content
  const OverviewTab = () => (
    <div className="space-y-6">
      {/* Contact Info */}
      <div className="w-1/2 grid grid-cols-1 gap-12">
        <Card variant="ghost" className="!p-0">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-[#005F6A]/10 rounded-lg">
              <User className="w-4 h-4 text-[#005F6A]" />
            </div>
            <h3 className="text-sm font-[350] text-[#005F6A]/80">
              Contact Information
            </h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex justify-between items-center p-3 rounded-xl bg-[#005F6A]/5">
              <span className="input-label !text-[#005F6A]/70">Email</span>
              <span className="app-title-small text-[#005F6A]">
                {employee.email}
              </span>
            </div>
            <div className="flex justify-between items-center p-3 rounded-xl bg-[#005F6A]/5">
              <span className="input-label !text-[#005F6A]/70">Phone</span>
              <span className="app-title-small text-[#005F6A]">
                {employee.phone || "-"}
              </span>
            </div>
            <div className="flex justify-between items-center p-3 rounded-xl bg-[#005F6A]/5">
              <span className="input-label !text-[#005F6A]/70">Role</span>
              {getRoleBadge(employee.role)}
            </div>
          </div>
        </Card>

        {/* Financial Summary */}
        <Card variant="ghost" className="!p-0">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-[#005F6A]/10 rounded-lg">
              <DollarSign className="w-4 h-4 text-[#005F6A]" />
            </div>
            <h3 className="input-label !text-[#005F6A]/70">
              Financial Summary
            </h3>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 rounded-xl bg-[#005F6A]/5">
              <span className="input-label !text-[#005F6A]/70">
                Total Revenue Generated
              </span>
              <span className="app-title-small text-[#005F6A]">
                ${stats.totalRevenue.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between items-center p-3 rounded-xl bg-[#005F6A]/5">
              <span className="input-label !text-[#005F6A]/70">
                Total Employee Pay
              </span>
              <span className="app-title-small text-[#005F6A]">
                ${stats.totalPaid.toFixed(2)}
              </span>
            </div>
            {stats.totalTips > 0 && (
              <div className="flex justify-between items-center p-3 rounded-xl bg-green-50">
                <span className="input-label !text-[#005F6A]/70">
                  Total Tips
                </span>
                <span className="app-title-small text-green-600">
                  +${stats.totalTips.toFixed(2)}
                </span>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Unpaid Jobs Warning */}
      {stats.unpaidJobs > 0 && (
        <div className="rounded-2xl p-4 flex items-start gap-3 bg-yellow-50 border border-yellow-200">
          <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0" />
          <div>
            <p className="text-sm text-yellow-700 font-[400]">
              {stats.unpaidJobs} unpaid job{stats.unpaidJobs > 1 ? "s" : ""}
            </p>
            <p className="text-xs text-yellow-600/70 mt-1">
              Review and process pending payments
            </p>
          </div>
        </div>
      )}
    </div>
  );

  // Jobs Tab Content
  const JobsTab = () => (
    <div className="space-y-6">
      {/* Upcoming Jobs */}
      <h2 className="text-lg font-[350] tracking-tight text-[#005F6A]">
        Upcoming Jobs
      </h2>
      {upcomingJobs.length === 0 ? (
        <Card variant="ghost" className="p-8">
          <div className="text-center">
            <div className="w-12 h-12 bg-[#005F6A]/5 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Calendar className="w-6 h-6 text-[#005F6A]/40" />
            </div>
            <p className="text-sm text-[#005F6A]/60">No upcoming jobs</p>
          </div>
        </Card>
      ) : (
        <Card variant="default" className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-[#005F6A]/10 rounded-lg">
                <Calendar className="w-4 h-4 text-[#005F6A]" />
              </div>
              <h3 className="text-sm font-[350] text-[#005F6A]/80">
                Scheduled Jobs
              </h3>
            </div>
            <Badge variant="cleano" size="sm">
              {upcomingJobs.length}
            </Badge>
          </div>
          <div className="space-y-2">
            {upcomingJobs.map((job) => (
              <div
                key={job.id}
                className="flex items-center justify-between p-3 rounded-xl bg-[#005F6A]/5">
                <div className="flex-1">
                  <p className="text-sm font-[400] text-[#005F6A]">
                    {job.clientName}
                  </p>
                  <p className="text-xs text-[#005F6A]/60">
                    {new Date(job.startTime).toLocaleDateString()} at{" "}
                    {new Date(job.startTime).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {job.jobType && (
                    <Badge variant="cleano" size="sm">
                      {job.jobType}
                    </Badge>
                  )}
                  {job.price && (
                    <span className="text-sm font-[400] text-[#005F6A]">
                      ${job.price.toFixed(2)}
                    </span>
                  )}
                  <Button
                    variant="default"
                    size="sm"
                    border={false}
                    href={`/jobs/${job.id}`}
                    className="rounded-2xl px-4 py-2.5">
                    View
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Recent Jobs */}
      <h2 className="input-label !text-[#005F6A]/70 !mb-2">Recent Jobs</h2>
      {recentJobs.length === 0 ? (
        <Card variant="ghost" className="p-8">
          <div className="text-center">
            <div className="w-12 h-12 bg-[#005F6A]/5 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <History className="w-6 h-6 text-[#005F6A]/40" />
            </div>
            <p className="text-sm text-[#005F6A]/60">No recent jobs</p>
          </div>
        </Card>
      ) : (
        <Card variant="ghost" className="!p-0">
          <div className="space-y-2">
            {recentJobs.map((job) => (
              <div
                key={job.id}
                className="flex items-center justify-between p-3 rounded-xl bg-[#005F6A]/2">
                <div className="flex-1">
                  <p className="app-title-small text-[#005F6A]">
                    {job.clientName}
                  </p>
                  <p className="app-subtitle !text-[#005F6A]/60">
                    {new Date(job.startTime).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-3">
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
                  <Button
                    variant="default"
                    size="sm"
                    border={false}
                    href={`/jobs/${job.id}`}
                    className="rounded-2xl px-4 py-2.5">
                    View
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );

  // Products Tab Content
  const ProductsTab = () => (
    <div className="space-y-6">
      {/* Most Used Products */}
      <h2 className="text-lg font-[350] tracking-tight text-[#005F6A]">
        Most Used Products
      </h2>
      {topProducts.length === 0 ? (
        <Card variant="ghost" className="p-8">
          <div className="text-center">
            <div className="w-12 h-12 bg-[#005F6A]/5 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Package className="w-6 h-6 text-[#005F6A]/40" />
            </div>
            <p className="text-sm text-[#005F6A]/60">No usage data yet</p>
          </div>
        </Card>
      ) : (
        <Card variant="default" className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-[#005F6A]/10 rounded-lg">
              <Package className="w-4 h-4 text-[#005F6A]" />
            </div>
            <h3 className="text-sm font-[350] text-[#005F6A]/80">
              Product Usage
            </h3>
          </div>
          <div className="space-y-2">
            {topProducts.map((product, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-3 rounded-xl bg-[#005F6A]/5">
                <div className="flex-1">
                  <p className="text-sm font-[400] text-[#005F6A]">
                    {product.name}
                  </p>
                  <p className="text-xs text-[#005F6A]/60">
                    {product.quantity} {product.unit}
                  </p>
                </div>
                <Badge variant="cleano" size="sm">
                  #{idx + 1}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Assigned Inventory */}
      <h2 className="text-lg font-[350] tracking-tight text-[#005F6A]">
        Assigned Inventory
      </h2>
      {assignedProducts.length === 0 ? (
        <Card variant="ghost" className="p-8">
          <div className="text-center">
            <div className="w-12 h-12 bg-[#005F6A]/5 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Briefcase className="w-6 h-6 text-[#005F6A]/40" />
            </div>
            <p className="text-sm text-[#005F6A]/60">No inventory assigned</p>
          </div>
        </Card>
      ) : (
        <Card variant="default" className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-[#005F6A]/10 rounded-lg">
                <Briefcase className="w-4 h-4 text-[#005F6A]" />
              </div>
              <h3 className="text-sm font-[350] text-[#005F6A]/80">
                Current Inventory
              </h3>
            </div>
            <Badge variant="cleano" size="sm">
              {assignedProducts.length} items
            </Badge>
          </div>
          <div className="space-y-2">
            {assignedProducts.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-3 rounded-xl bg-[#005F6A]/5">
                <div className="flex-1">
                  <p className="text-sm font-[400] text-[#005F6A]">
                    {item.productName}
                  </p>
                  <p className="text-xs text-[#005F6A]/60">
                    {item.quantity} {item.unit}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-[400] text-[#005F6A]">
                    ${(item.quantity * item.costPerUnit).toFixed(2)}
                  </span>
                  <Button
                    variant="default"
                    size="sm"
                    border={false}
                    href={`/inventory/${item.productId}`}
                    className="rounded-2xl px-4 py-2.5">
                    View
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );

  return (
    <div className="relative h-full overflow-y-auto pb-8 px-4">
      <div className="relative z-10 max-w-[80rem] w-full mx-auto space-y-6">
        {/* Back Button */}
        <Link href="/employees">
          <Button
            variant="default"
            size="sm"
            border={false}
            className="mb-2 px-6 py-3">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Employees
          </Button>
        </Link>

        {/* Header */}
        <div className="w-full flex flex-col md:flex-row items-start justify-between gap-4 my-10">
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl !font-light tracking-tight text-[#005F6A]">
                {employee.name}
              </h1>
              {getRoleBadge(employee.role)}
            </div>
            <div className="flex flex-col sm:flex-row gap-4 text-[#005F6A]/70 mt-2">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4" />
                <span className="text-sm">{employee.email}</span>
              </div>
              {employee.phone && (
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4" />
                  <span className="text-sm">{employee.phone}</span>
                </div>
              )}
            </div>
          </div>
          <Button
            variant="primary"
            size="md"
            onClick={() => setIsEditModalOpen(true)}
            border={false}
            className="px-6 py-3">
            <Pencil className="w-4 h-4 mr-2" />
            Edit Employee
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <MetricCard
            label="Jobs Completed"
            value={String(stats.completedJobsCount)}
          />
          <MetricCard
            label="Total Revenue"
            value={`$${stats.totalRevenue.toFixed(2)}`}
          />
          <MetricCard
            label="Employee Pay"
            value={`$${stats.totalPaid.toFixed(2)}`}
            subValue={
              stats.totalTips > 0
                ? `+ $${stats.totalTips.toFixed(2)} tips`
                : undefined
            }
          />
          {stats.unpaidJobs > 0 && (
            <MetricCard
              label="Unpaid Jobs"
              value={String(stats.unpaidJobs)}
              variant="warning"
            />
          )}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 bg-[#005F6A]/5 rounded-2xl p-1 w-fit overflow-x-auto">
          {MENU_ITEMS.map((item) => {
            const isActive = activeView === item.id;
            return (
              <Button
                key={item.id}
                border={false}
                onClick={() => updateView(item.id)}
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
          {activeView === "jobs" && <JobsTab />}
          {activeView === "products" && <ProductsTab />}
        </div>
      </div>

      {/* Edit Modal */}
      <EmployeeModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        employee={employee}
        mode="edit"
      />
    </div>
  );
}
