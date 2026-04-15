"use client";

import React from "react";
import {
  Search,
  ChevronDown,
  Briefcase,
  Loader,
  Eye,
  Pencil,
  Plus,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  CheckCircle2,
  FileText,
  AlertTriangle,
  DollarSign,
  Calendar,
  Clock,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Badge from "@/components/ui/Badge";
import CustomDropdown from "@/components/ui/custom-dropdown";

interface Job {
  id: string;
  clientName: string;
  clientId: string | null;
  location: string | null;
  description: string | null;
  jobType: string | null;
  jobDate: string | null;
  startTime: string;
  endTime: string | null;
  status: string;
  price: number | null;
  employeePay: number | null;
  totalTip: number | null;
  parking: number | null;
  notes: string | null;
  paymentReceived: boolean;
  invoiceSent: boolean;
  paymentType?: string | null;
  discountAmount?: number | null;
  bedCount?: number | null;
  bathCount?: number | null;
  payRateMultiplier?: number | null;
  profit?: number;
  profitPct?: number;
  timeSpentMs?: number;
  cleaners: Array<{ id: string; name: string }>;
  addOns?: Array<{ id: string; name: string; price: number }>;
}

interface ClientLite {
  id: string;
  name: string;
}

interface UserLite {
  id: string;
  name: string;
  email: string;
}

interface JobStats {
  totalJobs: number;
  completedJobs: number;
  totalRevenue: number;
  pendingPayment: number;
}

interface JobsViewProps {
  jobs: Job[];
  stats: JobStats;
  isLoading: boolean;
  // Search and filters
  searchTerm: string;
  statusFilter: string;
  paymentFilter: string;
  rowsPerPage: number;
  page: number;
  // Handlers
  onSearchTermChange: (term: string) => void;
  onStatusFilterChange: (filter: string) => void;
  onPaymentFilterChange: (filter: string) => void;
  onRowsPerPageChange: (rowsPerPage: number) => void;
  onPageChange: (page: number) => void;
  // URL update function
  updateURLParams: (updates: Record<string, string | number>) => void;
  // Modal handlers
  onCreateJob: () => void;
  onEditJob: (job: Job) => void;
  // Extended filter controls
  clients?: ClientLite[];
  users?: UserLite[];
  startDate?: string;
  endDate?: string;
  jobTypeFilter?: string;
  clientFilter?: string;
  employeeFilter?: string;
  paymentTypeFilter?: string;
  onStartDateChange?: (v: string) => void;
  onEndDateChange?: (v: string) => void;
  onJobTypeFilterChange?: (v: string) => void;
  onClientFilterChange?: (v: string) => void;
  onEmployeeFilterChange?: (v: string) => void;
  onPaymentTypeFilterChange?: (v: string) => void;
}

export default function JobsView({
  jobs,
  stats,
  isLoading,
  searchTerm,
  statusFilter,
  paymentFilter,
  rowsPerPage,
  page,
  onSearchTermChange,
  onStatusFilterChange,
  onPaymentFilterChange,
  onRowsPerPageChange,
  onPageChange,
  updateURLParams,
  onCreateJob,
  onEditJob,
  clients = [],
  users = [],
  startDate = "",
  endDate = "",
  jobTypeFilter = "all",
  clientFilter = "all",
  employeeFilter = "all",
  paymentTypeFilter = "all",
  onStartDateChange,
  onEndDateChange,
  onJobTypeFilterChange,
  onClientFilterChange,
  onEmployeeFilterChange,
  onPaymentTypeFilterChange,
}: JobsViewProps) {
  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { variant: any; label: string }> = {
      CREATED: { variant: "default", label: "Created" },
      SCHEDULED: { variant: "warning", label: "Scheduled" },
      IN_PROGRESS: { variant: "secondary", label: "In Progress" },
      COMPLETED: { variant: "success", label: "Completed" },
      PAID: { variant: "cleano", label: "Paid" },
      CANCELLED: { variant: "error", label: "Cancelled" },
    };
    const config = statusConfig[status] || {
      variant: "default",
      label: status,
    };
    return (
      <Badge variant={config.variant} className="px-2 py-1" size="sm">
        {config.label}
      </Badge>
    );
  };

  const getJobTypeBadge = (jobType: string | null) => {
    if (!jobType) return null;
    const typeConfig: Record<string, { variant: any; label: string }> = {
      R: { variant: "secondary", label: "R" },
      C: { variant: "default", label: "C" },
      PC: { variant: "warning", label: "PC" },
      F: { variant: "cleano", label: "F" },
    };
    const config = typeConfig[jobType] || {
      variant: "default",
      label: jobType,
    };
    return (
      <Badge variant={config.variant} className="px-2 py-1" size="sm">
        {config.label}
      </Badge>
    );
  };

  // Calculate overtime
  const calculateOvertime = (job: Job) => {
    if (!job.endTime) return null;
    const start = new Date(job.startTime);
    const end = new Date(job.endTime);
    const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    const standardHours = 8;
    const overtime = Math.max(0, durationHours - standardHours);
    return overtime > 0 ? overtime.toFixed(1) : null;
  };

  // Enhanced filtering logic
  const filteredJobs = jobs.filter((job) => {
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch =
      !searchTerm ||
      job.clientName.toLowerCase().includes(searchLower) ||
      (job.location && job.location.toLowerCase().includes(searchLower));

    const matchesStatus = statusFilter === "all" || job.status === statusFilter;

    const matchesPayment = (() => {
      if (paymentFilter === "all") return true;
      if (paymentFilter === "paid") return job.paymentReceived;
      if (paymentFilter === "pending")
        return !job.paymentReceived && job.status === "COMPLETED";
      return true;
    })();

    return matchesSearch && matchesStatus && matchesPayment;
  });

  // Pagination logic
  const totalJobs = filteredJobs.length;
  const totalPages = Math.ceil(totalJobs / rowsPerPage);
  const startIndex = (page - 1) * rowsPerPage;
  const endIndex = startIndex + rowsPerPage;
  const paginatedJobs = filteredJobs.slice(startIndex, endIndex);

  const goToPage = (newPage: number) => {
    onPageChange(newPage);
    updateURLParams({ page: newPage });
  };

  const changeRowsPerPage = (newRowsPerPage: number) => {
    onRowsPerPageChange(newRowsPerPage);
    onPageChange(1);
    updateURLParams({ rowsPerPage: newRowsPerPage, page: 1 });
  };

  // Metric Card Component
  const MetricCard = ({
    label,
    value,
    icon: Icon,
    variant = "default",
  }: {
    label: string;
    value: string;
    icon: any;
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
        <p
          className={`h2-title ${
            variant === "warning" ? "text-yellow-700" : "text-[#005F6A]"
          }`}>
          {value}
        </p>
      </div>
    </Card>
  );

  return (
    <div className="">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl !font-light tracking-tight text-[#005F6A]">
            Cleaning Jobs
          </h1>
          <p className="text-sm text-[#005F6A]/70 !font-light mt-1">
            Manage your cleaning jobs and track your revenue
          </p>
        </div>
        <Button
          variant="primary"
          size="md"
          border={false}
          onClick={onCreateJob}
          className="rounded-2xl px-6 py-3">
          <Plus className="w-4 h-4 mr-2" />
          Create New Job
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          label="Total Jobs"
          value={String(stats.totalJobs)}
          icon={Briefcase}
        />
        <MetricCard
          label="Completed"
          value={String(stats.completedJobs)}
          icon={CheckCircle2}
        />
        <MetricCard
          label="Total Revenue"
          value={`$${stats.totalRevenue.toFixed(2)}`}
          icon={DollarSign}
        />
        {stats.pendingPayment > 0 && (
          <MetricCard
            label="Pending Payment"
            value={String(stats.pendingPayment)}
            icon={AlertTriangle}
            variant="warning"
          />
        )}
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col lg:flex-row gap-2 mb-6">
        {/* Search */}
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-[#005F6A]/60 z-[100] w-4 h-4" />
            <Input
              placeholder="Search by client name or location..."
              value={searchTerm}
              size="md"
              onChange={(e) => {
                onSearchTermChange(e.target.value);
                onPageChange(1);
                updateURLParams({ search: e.target.value, page: 1 });
              }}
              className="pl-10 h-[42px] py-3 placeholder:!text-[#005F6A]/40 placeholder:!font-[350]"
              variant="form"
              border={false}
            />
          </div>
        </div>

        {/* Filters Row */}
        <div className="flex items-center gap-2">
          {/* Status Filter */}
          <CustomDropdown
            trigger={
              <Button
                variant="default"
                size="md"
                border={false}
                type="button"
                className="min-w-32 h-[42px] px-4 py-3 flex items-center justify-between w-fit">
                <span className="text-left w-full text-sm font-[350]">
                  {[
                    { value: "all", label: "All Status" },
                    { value: "CREATED", label: "Created" },
                    { value: "SCHEDULED", label: "Scheduled" },
                    { value: "IN_PROGRESS", label: "In Progress" },
                    { value: "COMPLETED", label: "Completed" },
                    { value: "CANCELLED", label: "Cancelled" },
                  ].find((opt) => opt.value === statusFilter)?.label ||
                    "All Status"}
                </span>
                <ChevronDown className="w-4 h-4 ml-2 flex-shrink-0" />
              </Button>
            }
            options={[
              {
                label: "All Status",
                onClick: () => {
                  onStatusFilterChange("all");
                  onPageChange(1);
                  updateURLParams({ status: "all", page: 1 });
                },
              },
              {
                label: "Created",
                onClick: () => {
                  onStatusFilterChange("CREATED");
                  onPageChange(1);
                  updateURLParams({ status: "CREATED", page: 1 });
                },
              },
              {
                label: "Scheduled",
                onClick: () => {
                  onStatusFilterChange("SCHEDULED");
                  onPageChange(1);
                  updateURLParams({ status: "SCHEDULED", page: 1 });
                },
              },
              {
                label: "In Progress",
                onClick: () => {
                  onStatusFilterChange("IN_PROGRESS");
                  onPageChange(1);
                  updateURLParams({ status: "IN_PROGRESS", page: 1 });
                },
              },
              {
                label: "Completed",
                onClick: () => {
                  onStatusFilterChange("COMPLETED");
                  onPageChange(1);
                  updateURLParams({ status: "COMPLETED", page: 1 });
                },
              },
              {
                label: "Cancelled",
                onClick: () => {
                  onStatusFilterChange("CANCELLED");
                  onPageChange(1);
                  updateURLParams({ status: "CANCELLED", page: 1 });
                },
              },
            ]}
            maxHeight="16rem"
          />

          {/* Payment Filter */}
          <CustomDropdown
            trigger={
              <Button
                variant="default"
                size="md"
                border={false}
                type="button"
                className="min-w-34 h-[42px] px-4 py-3 flex items-center justify-between w-fit">
                <span className="text-left w-full text-sm font-[350]">
                  {[
                    { value: "all", label: "All Payment" },
                    { value: "paid", label: "Paid" },
                    { value: "pending", label: "Pending" },
                  ].find((opt) => opt.value === paymentFilter)?.label ||
                    "All Payment"}
                </span>
                <ChevronDown className="w-4 h-4 ml-2 flex-shrink-0" />
              </Button>
            }
            options={[
              {
                label: "All Payment",
                onClick: () => {
                  onPaymentFilterChange("all");
                  onPageChange(1);
                  updateURLParams({ payment: "all", page: 1 });
                },
              },
              {
                label: "Paid",
                onClick: () => {
                  onPaymentFilterChange("paid");
                  onPageChange(1);
                  updateURLParams({ payment: "paid", page: 1 });
                },
              },
              {
                label: "Pending",
                onClick: () => {
                  onPaymentFilterChange("pending");
                  onPageChange(1);
                  updateURLParams({ payment: "pending", page: 1 });
                },
              },
            ]}
            maxHeight="12rem"
          />

          {/* Rows Per Page */}
          <CustomDropdown
            trigger={
              <Button
                variant="default"
                size="md"
                border={false}
                className="min-w-20 h-[42px] px-4 py-3 flex items-center justify-between w-fit">
                <span className="text-sm font-[350]">{rowsPerPage} / page</span>
                <ChevronDown className="w-4 h-4 ml-2 flex-shrink-0" />
              </Button>
            }
            options={[
              { label: "5", onClick: () => changeRowsPerPage(5) },
              { label: "10", onClick: () => changeRowsPerPage(10) },
              { label: "25", onClick: () => changeRowsPerPage(25) },
              { label: "50", onClick: () => changeRowsPerPage(50) },
              { label: "100", onClick: () => changeRowsPerPage(100) },
            ]}
            className="min-w-20"
            maxHeight="12rem"
          />
        </div>
      </div>

      {/* Extended Filters Row */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="date"
          value={startDate}
          onChange={(e) => onStartDateChange?.(e.target.value)}
          className="h-[38px] px-3 rounded-xl bg-[#005F6A]/5 text-sm text-[#005F6A] border-0 focus:outline-none focus:ring-1 focus:ring-[#005F6A]/20"
          placeholder="Start date"
        />
        <span className="text-xs text-[#005F6A]/50">to</span>
        <input
          type="date"
          value={endDate}
          onChange={(e) => onEndDateChange?.(e.target.value)}
          className="h-[38px] px-3 rounded-xl bg-[#005F6A]/5 text-sm text-[#005F6A] border-0 focus:outline-none focus:ring-1 focus:ring-[#005F6A]/20"
          placeholder="End date"
        />

        <CustomDropdown
          trigger={
            <Button
              variant="default"
              size="sm"
              border={false}
              type="button"
              className="h-[38px] px-3 flex items-center gap-2">
              <span className="text-xs font-[350]">
                Type:{" "}
                {jobTypeFilter === "all" ? "All" : jobTypeFilter}
              </span>
              <ChevronDown className="w-3 h-3" />
            </Button>
          }
          options={[
            { label: "All Types", onClick: () => onJobTypeFilterChange?.("all") },
            { label: "Residential (R)", onClick: () => onJobTypeFilterChange?.("R") },
            { label: "Commercial (C)", onClick: () => onJobTypeFilterChange?.("C") },
            { label: "Post-Construction (PC)", onClick: () => onJobTypeFilterChange?.("PC") },
            { label: "Follow-up (F)", onClick: () => onJobTypeFilterChange?.("F") },
          ]}
          maxHeight="14rem"
        />

        {clients.length > 0 && (
          <CustomDropdown
            trigger={
              <Button
                variant="default"
                size="sm"
                border={false}
                type="button"
                className="h-[38px] px-3 flex items-center gap-2 max-w-[200px]">
                <span className="text-xs font-[350] truncate">
                  Client:{" "}
                  {clientFilter === "all"
                    ? "All"
                    : clients.find((c) => c.id === clientFilter)?.name || "—"}
                </span>
                <ChevronDown className="w-3 h-3" />
              </Button>
            }
            options={[
              { label: "All Clients", onClick: () => onClientFilterChange?.("all") },
              ...clients.map((c) => ({
                label: c.name,
                onClick: () => onClientFilterChange?.(c.id),
              })),
            ]}
            maxHeight="18rem"
          />
        )}

        {users.length > 0 && (
          <CustomDropdown
            trigger={
              <Button
                variant="default"
                size="sm"
                border={false}
                type="button"
                className="h-[38px] px-3 flex items-center gap-2 max-w-[200px]">
                <span className="text-xs font-[350] truncate">
                  Employee:{" "}
                  {employeeFilter === "all"
                    ? "All"
                    : users.find((u) => u.id === employeeFilter)?.name || "—"}
                </span>
                <ChevronDown className="w-3 h-3" />
              </Button>
            }
            options={[
              { label: "All Employees", onClick: () => onEmployeeFilterChange?.("all") },
              ...users.map((u) => ({
                label: u.name,
                onClick: () => onEmployeeFilterChange?.(u.id),
              })),
            ]}
            maxHeight="18rem"
          />
        )}

        <CustomDropdown
          trigger={
            <Button
              variant="default"
              size="sm"
              border={false}
              type="button"
              className="h-[38px] px-3 flex items-center gap-2">
              <span className="text-xs font-[350]">
                Pay:{" "}
                {paymentTypeFilter === "all" ? "All" : paymentTypeFilter}
              </span>
              <ChevronDown className="w-3 h-3" />
            </Button>
          }
          options={[
            { label: "All Payment Types", onClick: () => onPaymentTypeFilterChange?.("all") },
            { label: "Cash", onClick: () => onPaymentTypeFilterChange?.("CASH") },
            { label: "Cheque", onClick: () => onPaymentTypeFilterChange?.("CHEQUE") },
            { label: "E-Transfer", onClick: () => onPaymentTypeFilterChange?.("E_TRANSFER") },
            { label: "Credit Card", onClick: () => onPaymentTypeFilterChange?.("CREDIT_CARD") },
            { label: "Other", onClick: () => onPaymentTypeFilterChange?.("OTHER") },
          ]}
          maxHeight="14rem"
        />

        {(startDate ||
          endDate ||
          jobTypeFilter !== "all" ||
          clientFilter !== "all" ||
          employeeFilter !== "all" ||
          paymentTypeFilter !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            border={false}
            className="h-[38px] px-3 text-xs"
            onClick={() => {
              onStartDateChange?.("");
              onEndDateChange?.("");
              onJobTypeFilterChange?.("all");
              onClientFilterChange?.("all");
              onEmployeeFilterChange?.("all");
              onPaymentTypeFilterChange?.("all");
            }}>
            Clear
          </Button>
        )}
      </div>

      {/* Loading State */}
      {isLoading ? (
        <div className="bg-white rounded-2xl">
          <div className="text-center py-12">
            <Loader className="w-4 h-4 animate-spin text-[#005F6A] mx-auto mb-2" />
            <span className="text-sm text-[#005F6A]/70">Loading jobs...</span>
          </div>
        </div>
      ) : (
        <div className="mt-2">
          {totalJobs === 0 ? (
            <div className="bg-white rounded-2xl">
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-[#005F6A]/5 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Briefcase className="w-8 h-8 text-[#005F6A]/40" />
                </div>
                <p className="text-sm font-[350] text-[#005F6A]/70">
                  No jobs found
                </p>
                <p className="text-xs font-[350] text-[#005F6A]/60 mt-1">
                  Create your first job to get started
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl">
              {/* Desktop Table View */}
              <div className="hidden lg:block overflow-x-auto rounded-t-2xl">
                <div className="min-w-max">
                  {/* Header */}
                  <div className="flex bg-[#005F6A]/5 rounded-t-2xl">
                    {[
                      { label: "Date", className: "w-[100px] text-left" },
                      { label: "Client", className: "w-[180px] text-left" },
                      { label: "Type", className: "w-[60px] text-center" },
                      { label: "Cleaners", className: "w-[160px] text-left" },
                      { label: "Time", className: "w-[110px] text-center" },
                      { label: "Price", className: "w-[110px] text-right" },
                      { label: "Discount", className: "w-[100px] text-right" },
                      { label: "Profit %", className: "w-[90px] text-right" },
                      { label: "Pay Type", className: "w-[110px] text-center" },
                      { label: "Status", className: "w-[110px] text-center" },
                      { label: "Paid", className: "w-[90px] text-center" },
                      { label: "Actions", className: "w-[160px] text-left" },
                    ].map((col) => (
                      <div
                        key={col.label}
                        className={`p-4 text-xs font-[350] !text-[#005F6A]/40 uppercase !tracking-wider ${col.className}`}>
                        {col.label}
                      </div>
                    ))}
                  </div>

                  {/* Rows */}
                  <div className="divide-y divide-[#005F6A]/4">
                    {paginatedJobs.map((job) => {
                      const formatTimeSpent = (ms: number) => {
                        if (!ms || ms <= 0) return "-";
                        const totalMin = Math.round(ms / 60000);
                        const h = Math.floor(totalMin / 60);
                        const m = totalMin % 60;
                        return h > 0 ? `${h}h ${m}m` : `${m}m`;
                      };
                      return (
                        <div
                          key={job.id}
                          className="flex items-center hover:bg-[#005F6A]/1 transition-colors">
                          {/* Date */}
                          <div className="w-[100px] p-4">
                            <p className="app-title-small !text-[#005F6A]/50">
                              {job.jobDate
                                ? new Date(job.jobDate).toLocaleDateString()
                                : new Date(job.startTime).toLocaleDateString()}
                            </p>
                          </div>

                          {/* Client */}
                          <div className="w-[180px] p-4">
                            <p className="app-title-small truncate">
                              {job.clientName}
                            </p>
                            {job.location && (
                              <p className="app-subtitle !text-[#005F6A]/50 truncate">
                                {job.location}
                              </p>
                            )}
                          </div>

                          {/* Type */}
                          <div className="w-[60px] p-4 flex justify-center">
                            {getJobTypeBadge(job.jobType) || (
                              <span className="!app-subtitle !text-[#005F6A]/40">
                                -
                              </span>
                            )}
                          </div>

                          {/* Cleaners */}
                          <div className="w-[160px] p-4">
                            <p
                              className="app-title-small truncate"
                              title={
                                job.cleaners.map((c) => c.name).join(", ") ||
                                "-"
                              }>
                              {job.cleaners.length > 0
                                ? job.cleaners.map((c) => c.name).join(", ")
                                : "-"}
                            </p>
                          </div>

                          {/* Time Spent */}
                          <div className="w-[110px] p-4 text-center">
                            <p className="app-title-small !text-[#005F6A]/70">
                              {formatTimeSpent(job.timeSpentMs || 0)}
                            </p>
                          </div>

                          {/* Price */}
                          <div className="w-[110px] p-4 text-right">
                            <p className="app-title-small !text-[#005F6A]">
                              {job.price !== null && job.price !== undefined
                                ? `$${job.price.toFixed(2)}`
                                : "-"}
                            </p>
                          </div>

                          {/* Discount */}
                          <div className="w-[100px] p-4 text-right">
                            {job.discountAmount && job.discountAmount > 0 ? (
                              <span className="text-sm font-[400] text-yellow-600">
                                −${job.discountAmount.toFixed(2)}
                              </span>
                            ) : (
                              <span className="!app-subtitle !text-[#005F6A]/40">
                                -
                              </span>
                            )}
                          </div>

                          {/* Profit % */}
                          <div className="w-[90px] p-4 text-right">
                            {typeof job.profitPct === "number" &&
                            (job.price || 0) > 0 ? (
                              <span
                                className={`text-sm font-[400] ${
                                  job.profitPct >= 0
                                    ? "text-green-600"
                                    : "text-red-600"
                                }`}>
                                {job.profitPct.toFixed(0)}%
                              </span>
                            ) : (
                              <span className="!app-subtitle !text-[#005F6A]/40">
                                -
                              </span>
                            )}
                          </div>

                          {/* Payment Type */}
                          <div className="w-[110px] p-4 text-center">
                            {job.paymentType ? (
                              <Badge variant="default" size="sm">
                                {job.paymentType.replace("_", " ")}
                              </Badge>
                            ) : (
                              <span className="!app-subtitle !text-[#005F6A]/40">
                                -
                              </span>
                            )}
                          </div>

                          {/* Status */}
                          <div className="w-[110px] p-4 flex justify-center">
                            {getStatusBadge(job.status)}
                          </div>

                          {/* Paid (Payment flags) */}
                          <div className="w-[90px] p-4 flex justify-center gap-1">
                            <div title="Payment Received">
                              <CheckCircle2
                                strokeWidth={1.2}
                                className={`w-4 h-4 ${
                                  job.paymentReceived
                                    ? "text-[#005F6A]"
                                    : "text-[#005F6A]/20"
                                }`}
                              />
                            </div>
                            <div title="Invoice Sent">
                              <FileText
                                className={`w-4 h-4 ${
                                  job.invoiceSent
                                    ? "text-[#005F6A]"
                                    : "text-[#005F6A]/20"
                                }`}
                                strokeWidth={1.2}
                              />
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="w-[160px] p-4">
                            <div className="flex items-center gap-2">
                              <Button
                                variant="default"
                                size="sm"
                                border={false}
                                onClick={() => onEditJob(job)}
                                className="rounded-2xl px-4 py-2.5">
                                Edit
                              </Button>
                              <Button
                                variant="primary"
                                size="sm"
                                border={false}
                                href={`/jobs/${job.id}`}
                                className="rounded-2xl px-4 py-2.5">
                                View
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Mobile Card View */}
              <div className="lg:hidden space-y-3 p-4">
                {paginatedJobs.map((job) => (
                  <Card key={job.id} variant="cleano_light" className="p-4">
                    <div className="space-y-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-[400] text-[#005F6A]">
                            {job.clientName}
                          </p>
                          {job.location && (
                            <p className="text-xs text-[#005F6A]/60 mt-0.5">
                              {job.location}
                            </p>
                          )}
                        </div>
                        {getStatusBadge(job.status)}
                      </div>

                      <div className="flex items-center justify-between text-xs text-[#005F6A]/60">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-3 h-3" />
                          <span>
                            {job.jobDate
                              ? new Date(job.jobDate).toLocaleDateString()
                              : new Date(job.startTime).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Clock className="w-3 h-3" />
                          <span>
                            {new Date(job.startTime).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-sm font-[400] text-[#005F6A]">
                          {job.price ? `$${job.price.toFixed(2)}` : "-"}
                        </span>
                        <div className="flex items-center gap-1">
                          <CheckCircle2
                            className={`w-4 h-4 ${
                              job.paymentReceived
                                ? "text-[#005F6A]"
                                : "text-[#005F6A]/20"
                            }`}
                          />
                          <FileText
                            className={`w-4 h-4 ${
                              job.invoiceSent
                                ? "text-[#005F6A]"
                                : "text-[#005F6A]/20"
                            }`}
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="default"
                          size="sm"
                          border={false}
                          onClick={() => onEditJob(job)}
                          className="rounded-2xl px-4 py-2 flex-1">
                          Edit
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          border={false}
                          href={`/jobs/${job.id}`}
                          className="rounded-2xl px-4 py-2 flex-1">
                          View
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>

              {/* Pagination */}
              {totalJobs > 0 && (
                <div className="flex items-center justify-between p-2 px-3 bg-[#005F6A]/4 rounded-b-2xl">
                  <div className="text-xs text-[#005F6A]/70 font-[350]">
                    Showing {startIndex + 1} to {Math.min(endIndex, totalJobs)}{" "}
                    of {totalJobs} jobs
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => goToPage(1)}
                      disabled={page === 1}
                      className="px-2">
                      <ChevronsLeft className="w-4 h-4" />
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => goToPage(page - 1)}
                      disabled={page === 1}
                      className="px-2">
                      <ChevronLeft className="w-4 h-4" />
                    </Button>

                    <div className="flex items-center gap-1">
                      {Array.from(
                        { length: Math.min(5, totalPages) },
                        (_, i) => {
                          let pageNum;
                          if (totalPages <= 5) {
                            pageNum = i + 1;
                          } else if (page <= 3) {
                            pageNum = i + 1;
                          } else if (page >= totalPages - 2) {
                            pageNum = totalPages - 4 + i;
                          } else {
                            pageNum = page - 2 + i;
                          }

                          return (
                            <Button
                              key={pageNum}
                              variant={page === pageNum ? "cleano" : "default"}
                              border={false}
                              size="md"
                              onClick={() => goToPage(pageNum)}
                              className="px-3 min-w-8 rounded-xl">
                              <span className="text-sm font-[350] text-[#005F6A]">
                                {pageNum}
                              </span>
                            </Button>
                          );
                        }
                      )}
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => goToPage(page + 1)}
                      disabled={page === totalPages || totalPages === 0}
                      className="px-2">
                      <ChevronRight className="w-4 h-4" />
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => goToPage(totalPages)}
                      disabled={page === totalPages || totalPages === 0}
                      className="px-2">
                      <ChevronsRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
