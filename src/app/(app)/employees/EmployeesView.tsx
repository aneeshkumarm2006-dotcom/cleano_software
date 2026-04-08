"use client";

import React from "react";
import {
  Search,
  ChevronDown,
  Users,
  Loader,
  Plus,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  Briefcase,
  DollarSign,
  AlertTriangle,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Badge from "@/components/ui/Badge";
import CustomDropdown from "@/components/ui/custom-dropdown";

interface Employee {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: "OWNER" | "ADMIN" | "EMPLOYEE";
  completedJobsCount: number;
  activeJobsCount: number;
  totalRevenue: number;
  unpaidJobs: number;
}

interface EmployeeStats {
  totalEmployees: number;
  admins: number;
  activeEmployees: number;
  totalRevenue: number;
}

interface EmployeesViewProps {
  employees: Employee[];
  stats: EmployeeStats;
  isLoading: boolean;
  // Search and filters
  searchTerm: string;
  roleFilter: string;
  jobStatusFilter: string;
  rowsPerPage: number;
  page: number;
  // Handlers
  onSearchTermChange: (term: string) => void;
  onRoleFilterChange: (filter: string) => void;
  onJobStatusFilterChange: (filter: string) => void;
  onRowsPerPageChange: (rowsPerPage: number) => void;
  onPageChange: (page: number) => void;
  // URL update function
  updateURLParams: (updates: Record<string, string | number>) => void;
  // Modal handlers
  onCreateEmployee: () => void;
  onEditEmployee: (employee: Employee) => void;
}

export default function EmployeesView({
  employees,
  stats,
  isLoading,
  searchTerm,
  roleFilter,
  jobStatusFilter,
  rowsPerPage,
  page,
  onSearchTermChange,
  onRoleFilterChange,
  onJobStatusFilterChange,
  onRowsPerPageChange,
  onPageChange,
  updateURLParams,
  onCreateEmployee,
  onEditEmployee,
}: EmployeesViewProps) {
  const getRoleBadge = (role: string) => {
    const roleConfig: Record<string, { variant: any; label: string }> = {
      OWNER: { variant: "cleano", label: "Owner" },
      ADMIN: { variant: "secondary", label: "Admin" },
      EMPLOYEE: { variant: "default", label: "Employee" },
    };
    const config = roleConfig[role] || { variant: "default", label: role };
    return (
      <Badge variant={config.variant} className="px-2 py-1" size="sm">
        {config.label}
      </Badge>
    );
  };

  // Enhanced filtering logic
  const filteredEmployees = employees.filter((employee) => {
    // Search filter
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch =
      !searchTerm ||
      employee.name.toLowerCase().includes(searchLower) ||
      employee.email.toLowerCase().includes(searchLower) ||
      (employee.phone && employee.phone.includes(searchTerm));

    // Role filter
    const matchesRole = roleFilter === "all" || employee.role === roleFilter;

    // Job status filter
    const matchesJobStatus = (() => {
      if (jobStatusFilter === "all") return true;
      if (jobStatusFilter === "active") return employee.activeJobsCount > 0;
      if (jobStatusFilter === "completed")
        return employee.completedJobsCount > 0;
      if (jobStatusFilter === "unpaid") return employee.unpaidJobs > 0;
      return true;
    })();

    return matchesSearch && matchesRole && matchesJobStatus;
  });

  // Pagination logic
  const totalEmployees = filteredEmployees.length;
  const totalPages = Math.ceil(totalEmployees / rowsPerPage);
  const startIndex = (page - 1) * rowsPerPage;
  const endIndex = startIndex + rowsPerPage;
  const paginatedEmployees = filteredEmployees.slice(startIndex, endIndex);

  // Helper functions for pagination
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
    variant = "default",
  }: {
    label: string;
    value: string;
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
            Employees
          </h1>
          <p className="text-sm text-[#005F6A]/70 !font-light mt-1">
            Manage your team members and their assignments
          </p>
        </div>
        <Button
          variant="primary"
          size="md"
          border={false}
          onClick={onCreateEmployee}
          className="rounded-2xl px-6 py-3">
          <Plus className="w-4 h-4 mr-2" />
          Add Employee
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          label="Total Employees"
          value={String(stats.totalEmployees)}
        />
        <MetricCard label="Admins" value={String(stats.admins)} />
        <MetricCard label="Active Now" value={String(stats.activeEmployees)} />
        <MetricCard
          label="Total Revenue"
          value={`$${stats.totalRevenue.toFixed(2)}`}
        />
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col lg:flex-row gap-2 mb-6">
        {/* Search */}
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-[#005F6A]/60 z-[100] w-4 h-4" />
            <Input
              placeholder="Search by name, email, or phone..."
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
          {/* Role Filter */}
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
                    { value: "all", label: "All Roles" },
                    { value: "OWNER", label: "Owner" },
                    { value: "ADMIN", label: "Admin" },
                    { value: "EMPLOYEE", label: "Employee" },
                  ].find((opt) => opt.value === roleFilter)?.label ||
                    "All Roles"}
                </span>
                <ChevronDown className="w-4 h-4 ml-2 flex-shrink-0" />
              </Button>
            }
            options={[
              {
                label: "All Roles",
                onClick: () => {
                  onRoleFilterChange("all");
                  onPageChange(1);
                  updateURLParams({ role: "all", page: 1 });
                },
              },
              {
                label: "Owner",
                onClick: () => {
                  onRoleFilterChange("OWNER");
                  onPageChange(1);
                  updateURLParams({ role: "OWNER", page: 1 });
                },
              },
              {
                label: "Admin",
                onClick: () => {
                  onRoleFilterChange("ADMIN");
                  onPageChange(1);
                  updateURLParams({ role: "ADMIN", page: 1 });
                },
              },
              {
                label: "Employee",
                onClick: () => {
                  onRoleFilterChange("EMPLOYEE");
                  onPageChange(1);
                  updateURLParams({ role: "EMPLOYEE", page: 1 });
                },
              },
            ]}
            maxHeight="12rem"
          />

          {/* Job Status Filter */}
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
                    { value: "active", label: "Active Jobs" },
                    { value: "completed", label: "Has Completed" },
                    { value: "unpaid", label: "Has Unpaid" },
                  ].find((opt) => opt.value === jobStatusFilter)?.label ||
                    "All Status"}
                </span>
                <ChevronDown className="w-4 h-4 ml-2 flex-shrink-0" />
              </Button>
            }
            options={[
              {
                label: "All Status",
                onClick: () => {
                  onJobStatusFilterChange("all");
                  onPageChange(1);
                  updateURLParams({ jobStatus: "all", page: 1 });
                },
              },
              {
                label: "Active Jobs",
                onClick: () => {
                  onJobStatusFilterChange("active");
                  onPageChange(1);
                  updateURLParams({ jobStatus: "active", page: 1 });
                },
              },
              {
                label: "Has Completed",
                onClick: () => {
                  onJobStatusFilterChange("completed");
                  onPageChange(1);
                  updateURLParams({ jobStatus: "completed", page: 1 });
                },
              },
              {
                label: "Has Unpaid",
                onClick: () => {
                  onJobStatusFilterChange("unpaid");
                  onPageChange(1);
                  updateURLParams({ jobStatus: "unpaid", page: 1 });
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
            ]}
            className="min-w-20"
            maxHeight="12rem"
          />
        </div>
      </div>

      {/* Loading State */}
      {isLoading ? (
        <div className="bg-white rounded-2xl">
          <div className="text-center py-12">
            <Loader className="w-4 h-4 animate-spin text-[#005F6A] mx-auto mb-2" />
            <span className="text-sm text-[#005F6A]/70">
              Loading employees...
            </span>
          </div>
        </div>
      ) : (
        <div className="mt-2">
          {totalEmployees === 0 ? (
            <div className="bg-white rounded-2xl">
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-[#005F6A]/5 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Users className="w-8 h-8 text-[#005F6A]/40" />
                </div>
                <p className="text-sm font-[350] text-[#005F6A]/70">
                  No employees found
                </p>
                <p className="text-xs font-[350] text-[#005F6A]/60 mt-1">
                  Add employees to get started
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
                      { label: "Name", className: "w-[200px] text-left" },
                      { label: "Email", className: "w-[220px] text-left" },
                      { label: "Phone", className: "w-[140px] text-left" },
                      { label: "Role", className: "w-[100px] text-left" },
                      {
                        label: "Completed",
                        className: "w-[100px] text-center",
                      },
                      { label: "Active", className: "w-[100px] text-center" },
                      { label: "Revenue", className: "w-[120px] text-right" },
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
                    {paginatedEmployees.map((employee) => (
                      <div
                        key={employee.id}
                        className="flex items-center hover:bg-[#005F6A]/1 transition-colors">
                        {/* Name */}
                        <div className="w-[200px] p-4">
                          <p className="app-title-small truncate">
                            {employee.name}
                          </p>
                        </div>

                        {/* Email */}
                        <div className="w-[220px] p-4">
                          <p className="app-title-small !text-[#005F6A]/50 truncate">
                            {employee.email}
                          </p>
                        </div>

                        {/* Phone */}
                        <div className="w-[140px] p-4">
                          <p className="app-title-small !text-[#005F6A]/50 truncate">
                            {employee.phone || "-"}
                          </p>
                        </div>

                        {/* Role */}
                        <div className="w-[100px] p-4">
                          {getRoleBadge(employee.role)}
                        </div>

                        {/* Completed Jobs */}
                        <div className="w-[100px] p-4 text-center">
                          <p className="app-title-small !text-[#005F6A]/70">
                            {employee.completedJobsCount}
                          </p>
                        </div>

                        {/* Active Jobs */}
                        <div className="w-[100px] p-4 text-center">
                          {employee.activeJobsCount > 0 ? (
                            <Badge
                              variant="success"
                              size="sm"
                              className="px-2 py-1">
                              {employee.activeJobsCount}
                            </Badge>
                          ) : (
                            <span className="app-title-small !text-[#005F6A]/40">
                              -
                            </span>
                          )}
                        </div>

                        {/* Revenue */}
                        <div className="w-[120px] p-4 text-right">
                          <p className="app-title-small text-[#005F6A]">
                            ${employee.totalRevenue.toFixed(2)}
                          </p>
                        </div>

                        {/* Actions */}
                        <div className="w-[160px] p-4">
                          <div className="flex items-center gap-2">
                            <Button
                              variant="default"
                              size="sm"
                              border={false}
                              onClick={() => onEditEmployee(employee)}
                              className="rounded-2xl px-4 py-2.5">
                              Edit
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              border={false}
                              href={`/employees/${employee.id}`}
                              className="rounded-2xl px-4 py-2.5">
                              View
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Mobile Card View */}
              <div className="lg:hidden space-y-3 p-4">
                {paginatedEmployees.map((employee) => (
                  <Card
                    key={employee.id}
                    variant="cleano_light"
                    className="p-4">
                    <div className="space-y-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-[400] text-[#005F6A]">
                            {employee.name}
                          </p>
                          <p className="text-xs text-[#005F6A]/60 mt-0.5">
                            {employee.email}
                          </p>
                        </div>
                        {getRoleBadge(employee.role)}
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="bg-[#005F6A]/5 rounded-xl p-2">
                          <p className="text-xs text-[#005F6A]/60">Completed</p>
                          <p className="text-sm font-[400] text-[#005F6A]">
                            {employee.completedJobsCount}
                          </p>
                        </div>
                        <div className="bg-[#005F6A]/5 rounded-xl p-2">
                          <p className="text-xs text-[#005F6A]/60">Active</p>
                          <p className="text-sm font-[400] text-[#005F6A]">
                            {employee.activeJobsCount}
                          </p>
                        </div>
                        <div className="bg-[#005F6A]/5 rounded-xl p-2">
                          <p className="text-xs text-[#005F6A]/60">Revenue</p>
                          <p className="text-sm font-[400] text-[#005F6A]">
                            ${employee.totalRevenue.toFixed(0)}
                          </p>
                        </div>
                      </div>

                      {employee.unpaidJobs > 0 && (
                        <div className="flex items-center gap-2 text-amber-600 bg-amber-50 rounded-xl p-2">
                          <AlertTriangle className="w-4 h-4" />
                          <span className="text-xs font-[400]">
                            {employee.unpaidJobs} unpaid job
                            {employee.unpaidJobs > 1 ? "s" : ""}
                          </span>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="default"
                          size="sm"
                          border={false}
                          onClick={() => onEditEmployee(employee)}
                          className="rounded-2xl px-4 py-2 flex-1">
                          Edit
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          border={false}
                          href={`/employees/${employee.id}`}
                          className="rounded-2xl px-4 py-2 flex-1">
                          View
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>

              {/* Pagination */}
              {totalEmployees > 0 && (
                <div className="flex items-center justify-between p-2 px-3 bg-[#005F6A]/4 rounded-b-2xl">
                  <div className="text-xs text-[#005F6A]/70 font-[350]">
                    Showing {startIndex + 1} to{" "}
                    {Math.min(endIndex, totalEmployees)} of {totalEmployees}{" "}
                    employees
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
