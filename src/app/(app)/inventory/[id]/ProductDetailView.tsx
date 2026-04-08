"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Input from "@/components/ui/Input";
import CustomDropdown from "@/components/ui/custom-dropdown";
import {
  ArrowLeft,
  Package,
  Users,
  History,
  Search,
  ChevronDown,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  AlertTriangle,
  Archive,
  DollarSign,
  TrendingUp,
} from "lucide-react";

type TabView = "overview" | "usage" | "assignments";

const MENU_ITEMS: Array<{ id: TabView; label: string; icon: React.ReactNode }> =
  [
    {
      id: "overview",
      label: "Overview",
      icon: <Package className="w-4 h-4" />,
    },
    {
      id: "usage",
      label: "Usage History",
      icon: <History className="w-4 h-4" />,
    },
    {
      id: "assignments",
      label: "Assignments",
      icon: <Users className="w-4 h-4" />,
    },
  ];

interface Product {
  id: string;
  name: string;
  description: string | null;
  unit: string;
  costPerUnit: number;
  stockLevel: number;
  minStock: number;
}

interface JobUsage {
  id: string;
  quantity: number;
  createdAt: string;
  job: {
    id: string;
    clientName: string;
    employee: {
      name: string;
    };
  };
}

interface EmployeeAssignment {
  id: string;
  quantity: number;
  assignedAt: string;
  notes: string | null;
  employee: {
    id: string;
    name: string;
    email: string;
  };
}

interface ProductDetailViewProps {
  product: Product;
  jobUsage: JobUsage[];
  employeeAssignments: EmployeeAssignment[];
  totalAssigned: number;
  totalUsed: number;
}

export default function ProductDetailView({
  product,
  jobUsage,
  employeeAssignments,
  totalAssigned,
  totalUsed,
}: ProductDetailViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [activeView, setActiveView] = useState<TabView>("overview");
  const [searchTerm, setSearchTerm] = useState("");
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [page, setPage] = useState(1);

  const isLowStock = product.stockLevel <= product.minStock;
  const totalInventory = product.stockLevel + totalAssigned;
  const totalValue = totalInventory * product.costPerUnit;

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
      query ? `/inventory/${product.id}?${query}` : `/inventory/${product.id}`,
      { scroll: false }
    );
  };

  // Filter assignments based on search
  const filteredAssignments = employeeAssignments.filter((assignment) => {
    const searchLower = searchTerm.toLowerCase();
    return (
      !searchTerm ||
      assignment.employee.name.toLowerCase().includes(searchLower) ||
      assignment.employee.email.toLowerCase().includes(searchLower) ||
      (assignment.notes && assignment.notes.toLowerCase().includes(searchLower))
    );
  });

  // Pagination
  const totalAssignments = filteredAssignments.length;
  const totalPages = Math.ceil(totalAssignments / rowsPerPage);
  const startIndex = (page - 1) * rowsPerPage;
  const endIndex = startIndex + rowsPerPage;
  const paginatedAssignments = filteredAssignments.slice(startIndex, endIndex);

  const goToPage = (newPage: number) => {
    setPage(newPage);
  };

  const changeRowsPerPage = (newRowsPerPage: number) => {
    setRowsPerPage(newRowsPerPage);
    setPage(1);
  };

  // Metric Card Component
  const MetricCard = ({
    label,
    value,
    variant = "default",
  }: {
    label: string;
    value: string;
    variant?: "default" | "error" | "warning";
  }) => (
    <Card
      variant={
        variant === "error"
          ? "error"
          : variant === "warning"
          ? "warning"
          : "cleano_light"
      }
      className="p-6 h-[7rem]">
      <div className="h-full flex flex-col justify-between">
        <span
          className={`app-title-small ${
            variant === "error"
              ? "text-red-600"
              : variant === "warning"
              ? "text-yellow-700"
              : "!text-[#005F6A]/70"
          }`}>
          {label}
        </span>
        <p
          className={`h2-title ${
            variant === "error"
              ? "text-red-600"
              : variant === "warning"
              ? "text-yellow-700"
              : "text-[#005F6A]"
          }`}>
          {value}
        </p>
      </div>
    </Card>
  );

  // Overview Tab Content
  const OverviewTab = () => (
    <div className="space-y-6">
      {/* Stock Details Card */}
      <div className="w-1/2 grid grid-cols-1 gap-12">
        <Card variant="ghost" className="!p-0">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-[#005F6A]/10 rounded-lg">
              <Archive className="w-4 h-4 text-[#005F6A]" />
            </div>
            <h3 className="text-sm font-[350] text-[#005F6A]/80">
              Stock Details
            </h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex justify-between items-center p-3 rounded-xl bg-[#005F6A]/2">
              <span className="input-label !text-[#005F6A]/70">
                Warehouse Stock
              </span>
              <span className="app-title-small text-[#005F6A]">
                {product.stockLevel} {product.unit}
              </span>
            </div>
            <div className="flex justify-between items-center p-3 rounded-xl bg-[#005F6A]/2">
              <span className="input-label !text-[#005F6A]/70">
                Min. Threshold
              </span>
              <span className="app-title-small text-[#005F6A]">
                {product.minStock} {product.unit}
              </span>
            </div>
            <div className="flex justify-between items-center p-3 rounded-xl bg-[#005F6A]/2">
              <span className="input-label !text-[#005F6A]/70">
                Assigned to Employees
              </span>
              <span className="app-title-small text-[#005F6A]">
                {totalAssigned} {product.unit}
              </span>
            </div>
            <div className="flex justify-between items-center p-3 rounded-xl bg-[#005F6A]/5">
              <span className="input-label !text-[#005F6A]/70">Status</span>
              {isLowStock ? (
                <Badge variant="error" size="sm" className="px-2 py-1">
                  Low Stock
                </Badge>
              ) : (
                <Badge variant="success" size="sm" className="px-2 py-1">
                  In Stock
                </Badge>
              )}
            </div>
          </div>
        </Card>

        {/* Pricing Card */}
        <Card variant="ghost" className="!p-0">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-[#005F6A]/10 rounded-lg">
              <DollarSign className="w-4 h-4 text-[#005F6A]" />
            </div>
            <h3 className="input-label !text-[#005F6A]/70">Pricing</h3>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 rounded-xl bg-[#005F6A]/2">
              <span className="input-label !text-[#005F6A]/70">
                Cost per Unit
              </span>
              <span className="app-title-small text-[#005F6A]">
                ${product.costPerUnit.toFixed(2)} / {product.unit}
              </span>
            </div>
            <div className="flex justify-between items-center p-3 rounded-xl bg-[#005F6A]/2">
              <span className="input-label !text-[#005F6A]/70">
                Total Inventory Value
              </span>
              <span className="app-title-small text-[#005F6A]">
                ${totalValue.toFixed(2)}
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* Low Stock Warning */}
      {isLowStock && (
        <div className="rounded-2xl p-4 flex items-start gap-3 bg-red-50 border border-red-200">
          <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />
          <div>
            <p className="text-sm text-red-700 font-[400]">
              Stock is below minimum threshold
            </p>
            <p className="text-xs text-red-600/70 mt-1">
              Consider restocking this product soon
            </p>
          </div>
        </div>
      )}

      {/* Description */}
      {product.description && (
        <>
          <h2 className="input-label !text-[#005F6A]/70">Description</h2>
          <Card variant="cleano_light" className="p-6">
            <p className="text-sm text-[#005F6A]/80 whitespace-pre-wrap leading-relaxed">
              {product.description}
            </p>
          </Card>
        </>
      )}
    </div>
  );

  // Usage History Tab Content
  const UsageHistoryTab = () => (
    <div className="space-y-6">
      {jobUsage.length > 0 ? (
        <Card variant="default" className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-[#005F6A]/10 rounded-lg">
                <TrendingUp className="w-4 h-4 text-[#005F6A]" />
              </div>
              <h3 className="text-sm font-[350] text-[#005F6A]/80">
                Usage in Jobs
              </h3>
            </div>
            <Badge variant="cleano" size="sm">
              Total: {totalUsed} {product.unit}
            </Badge>
          </div>

          <div className="space-y-2">
            {jobUsage.map((usage) => (
              <div
                key={usage.id}
                className="flex items-center justify-between p-3 rounded-xl bg-[#005F6A]/5">
                <div className="flex-1">
                  <p className="text-sm font-[400] text-[#005F6A]">
                    {usage.job.clientName}
                  </p>
                  <p className="text-xs text-[#005F6A]/60">
                    {usage.job.employee.name} •{" "}
                    {new Date(usage.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="cleano" size="sm">
                    {usage.quantity} {product.unit}
                  </Badge>
                  <Button
                    variant="default"
                    size="sm"
                    border={false}
                    href={`/jobs/${usage.job.id}`}
                    className="rounded-2xl px-4 py-2.5">
                    View
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <Card variant="ghost" className="p-8">
          <div className="text-center">
            <div className="w-12 h-12 bg-[#005F6A]/5 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <History className="w-6 h-6 text-[#005F6A]/40" />
            </div>
            <p className="text-sm text-[#005F6A]/60">
              No usage recorded for this product
            </p>
          </div>
        </Card>
      )}
    </div>
  );

  // Assignments Tab Content
  const AssignmentsTab = () => (
    <div className="space-y-6">
      {employeeAssignments.length === 0 ? (
        <Card variant="ghost" className="p-8">
          <div className="text-center">
            <div className="w-12 h-12 bg-[#005F6A]/5 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Users className="w-6 h-6 text-[#005F6A]/40" />
            </div>
            <p className="text-sm font-[350] text-[#005F6A]/70">
              No assignments found
            </p>
            <p className="text-xs font-[350] text-[#005F6A]/60 mt-1">
              This product is not currently assigned to any employees
            </p>
          </div>
        </Card>
      ) : (
        <>
          {/* Search and Filters */}
          <div className="flex flex-col lg:flex-row gap-2">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-[#005F6A]/60 z-[100] w-4 h-4" />
                <Input
                  placeholder="Search by employee name, email, or notes..."
                  value={searchTerm}
                  size="md"
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setPage(1);
                  }}
                  className="pl-10 h-[42px] py-3 placeholder:!text-[#005F6A]/40 placeholder:!font-[350]"
                  variant="form"
                  border={false}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <CustomDropdown
                trigger={
                  <Button
                    variant="default"
                    size="md"
                    border={false}
                    className="min-w-20 h-[42px] px-4 py-3 flex items-center justify-between w-fit">
                    <span className="text-sm font-[350]">
                      {rowsPerPage} / page
                    </span>
                    <ChevronDown className="w-4 h-4 ml-2 flex-shrink-0" />
                  </Button>
                }
                options={[
                  { label: "5", onClick: () => changeRowsPerPage(5) },
                  { label: "10", onClick: () => changeRowsPerPage(10) },
                  { label: "25", onClick: () => changeRowsPerPage(25) },
                  { label: "50", onClick: () => changeRowsPerPage(50) },
                ]}
                maxHeight="12rem"
              />
            </div>
          </div>

          {/* Assignments Table */}
          <div className="bg-white rounded-2xl">
            {/* Desktop Table */}
            <div className="hidden lg:block overflow-x-auto rounded-t-2xl">
              <div className="min-w-max">
                {/* Header */}
                <div className="flex bg-[#005F6A]/5 rounded-t-2xl">
                  {[
                    { label: "Employee", className: "w-[200px] text-left" },
                    { label: "Email", className: "w-[250px] text-left" },
                    { label: "Quantity", className: "w-[120px] text-left" },
                    { label: "Value", className: "w-[120px] text-left" },
                    {
                      label: "Assigned Date",
                      className: "w-[140px] text-left",
                    },
                    { label: "Notes", className: "w-[200px] text-left" },
                    { label: "Actions", className: "w-[120px] text-left" },
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
                  {paginatedAssignments.length === 0 ? (
                    <div className="p-8 text-center text-sm font-[350] text-[#005F6A]/70">
                      No assignments found matching your search
                    </div>
                  ) : (
                    paginatedAssignments.map((assignment) => (
                      <div
                        key={assignment.id}
                        className="flex items-center hover:bg-[#005F6A]/1 transition-colors">
                        <div className="w-[200px] p-4">
                          <p className="app-title-small truncate">
                            {assignment.employee.name}
                          </p>
                        </div>
                        <div className="w-[250px] p-4">
                          <p className="app-title-small !text-[#005F6A]/50 truncate">
                            {assignment.employee.email}
                          </p>
                        </div>
                        <div className="w-[120px] p-4">
                          <Badge variant="cleano" size="sm">
                            {assignment.quantity} {product.unit}
                          </Badge>
                        </div>
                        <div className="w-[120px] p-4">
                          <p className="app-title-small text-[#005F6A]">
                            $
                            {(
                              assignment.quantity * product.costPerUnit
                            ).toFixed(2)}
                          </p>
                        </div>
                        <div className="w-[140px] p-4">
                          <p className="app-title-small !text-[#005F6A]/50">
                            {new Date(
                              assignment.assignedAt
                            ).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="w-[200px] p-4">
                          <p className="app-title-small !text-[#005F6A]/40 truncate">
                            {assignment.notes || "-"}
                          </p>
                        </div>
                        <div className="w-[120px] p-4">
                          <Button
                            variant="default"
                            size="sm"
                            border={false}
                            href={`/employees/${assignment.employee.id}`}
                            className="rounded-2xl px-4 py-2.5">
                            View
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Footer Totals */}
                {paginatedAssignments.length > 0 && (
                  <div className="flex bg-[#005F6A]/5 border-t border-[#005F6A]/10">
                    <div className="w-[200px] p-4">
                      <p className="app-title-small">Total Assigned</p>
                    </div>
                    <div className="w-[250px] p-4"></div>
                    <div className="w-[120px] p-4">
                      <p className="app-title-small">
                        {totalAssigned} {product.unit}
                      </p>
                    </div>
                    <div className="w-[120px] p-4">
                      <p className="app-title-small">
                        ${(totalAssigned * product.costPerUnit).toFixed(2)}
                      </p>
                    </div>
                    <div className="w-[460px] p-4"></div>
                  </div>
                )}
              </div>
            </div>

            {/* Mobile Card View */}
            <div className="lg:hidden space-y-3 p-4">
              {paginatedAssignments.map((assignment) => (
                <Card
                  key={assignment.id}
                  variant="cleano_light"
                  className="p-4">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-[400] text-[#005F6A]">
                          {assignment.employee.name}
                        </p>
                        <p className="text-xs text-[#005F6A]/60 mt-0.5">
                          {assignment.employee.email}
                        </p>
                      </div>
                      <Badge variant="cleano" size="sm">
                        {assignment.quantity} {product.unit}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-xs text-[#005F6A]/60">
                      <span>
                        {new Date(assignment.assignedAt).toLocaleDateString()}
                      </span>
                      <span className="text-sm font-[400] text-[#005F6A]">
                        $
                        {(assignment.quantity * product.costPerUnit).toFixed(2)}
                      </span>
                    </div>
                    {assignment.notes && (
                      <p className="text-xs text-[#005F6A]/50">
                        {assignment.notes}
                      </p>
                    )}
                    <Button
                      variant="default"
                      size="sm"
                      border={false}
                      href={`/employees/${assignment.employee.id}`}
                      className="w-full justify-center rounded-2xl px-4 py-2">
                      View Employee
                    </Button>
                  </div>
                </Card>
              ))}
            </div>

            {/* Pagination */}
            {totalAssignments > 0 && (
              <div className="flex items-center justify-between p-2 px-3 bg-[#005F6A]/4 rounded-b-2xl">
                <div className="text-xs text-[#005F6A]/70 font-[350]">
                  Showing {startIndex + 1} to{" "}
                  {Math.min(endIndex, totalAssignments)} of {totalAssignments}{" "}
                  assignments
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
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
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
                    })}
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
        </>
      )}
    </div>
  );

  return (
    <div className="relative h-full overflow-y-auto pb-8 px-4">
      <div className="relative z-10 max-w-[80rem] w-full mx-auto space-y-6">
        {/* Back Button */}
        <Link href="/inventory">
          <Button
            variant="default"
            size="sm"
            border={false}
            className="mb-2 px-6 py-3">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Inventory
          </Button>
        </Link>

        {/* Header */}
        <div className="w-full flex flex-col md:flex-row items-start justify-between gap-4 my-10">
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl !font-light tracking-tight text-[#005F6A]">
                {product.name}
              </h1>
              {isLowStock && (
                <Badge variant="error" size="md">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  Low Stock
                </Badge>
              )}
            </div>
            {product.description && (
              <p className="text-sm text-[#005F6A]/60 mt-2">
                {product.description}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-sm text-[#005F6A]/60 !mb-2">Cost per unit</p>
            <p className="text-xl font-[350] text-[#005F6A]">
              ${product.costPerUnit.toFixed(2)} / {product.unit}
            </p>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <MetricCard
            label="In Warehouse"
            value={`${product.stockLevel} ${product.unit}`}
            variant={isLowStock ? "error" : "default"}
          />
          <MetricCard
            label="Assigned"
            value={`${totalAssigned} ${product.unit}`}
          />
          <MetricCard
            label="Total Inventory"
            value={`${totalInventory.toFixed(0)} ${product.unit}`}
          />
          <MetricCard label="Total Value" value={`$${totalValue.toFixed(2)}`} />
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
          {activeView === "usage" && <UsageHistoryTab />}
          {activeView === "assignments" && <AssignmentsTab />}
        </div>
      </div>
    </div>
  );
}
