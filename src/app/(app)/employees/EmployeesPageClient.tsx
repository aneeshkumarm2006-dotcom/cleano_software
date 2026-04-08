"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import EmployeesView from "./EmployeesView";
import { EmployeeModal } from "./EmployeeModal";

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

interface EmployeesPageClientProps {
  initialEmployees: Employee[];
  initialStats: EmployeeStats;
  initialSearch: string;
  initialRole: string;
  initialJobStatus: string;
  initialPage: number;
  initialRowsPerPage: number;
}

export default function EmployeesPageClient({
  initialEmployees,
  initialStats,
  initialSearch,
  initialRole,
  initialJobStatus,
  initialPage,
  initialRowsPerPage,
}: EmployeesPageClientProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(
    null
  );

  // Filter state
  const [searchTerm, setSearchTerm] = useState(initialSearch);
  const [roleFilter, setRoleFilter] = useState(initialRole);
  const [jobStatusFilter, setJobStatusFilter] = useState(initialJobStatus);
  const [page, setPage] = useState(initialPage);
  const [rowsPerPage, setRowsPerPage] = useState(initialRowsPerPage);

  const updateURLParams = (updates: Record<string, string | number>) => {
    const params = new URLSearchParams();

    const finalSearch =
      updates.search !== undefined ? String(updates.search) : searchTerm;
    const finalRole =
      updates.role !== undefined ? String(updates.role) : roleFilter;
    const finalJobStatus =
      updates.jobStatus !== undefined
        ? String(updates.jobStatus)
        : jobStatusFilter;
    const finalPage = updates.page !== undefined ? Number(updates.page) : page;
    const finalRowsPerPage =
      updates.rowsPerPage !== undefined
        ? Number(updates.rowsPerPage)
        : rowsPerPage;

    if (finalSearch) params.set("search", finalSearch);
    if (finalRole && finalRole !== "all") params.set("role", finalRole);
    if (finalJobStatus && finalJobStatus !== "all")
      params.set("jobStatus", finalJobStatus);
    if (finalPage > 1) params.set("page", String(finalPage));
    if (finalRowsPerPage !== 10)
      params.set("rowsPerPage", String(finalRowsPerPage));

    router.push(`/employees?${params.toString()}`);
  };

  const handleOpenCreateModal = () => {
    setSelectedEmployee(null);
    setModalMode("create");
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (employee: Employee) => {
    setSelectedEmployee(employee);
    setModalMode("edit");
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedEmployee(null);
  };

  return (
    <>
      <EmployeesView
        employees={initialEmployees}
        stats={initialStats}
        isLoading={isLoading}
        searchTerm={searchTerm}
        roleFilter={roleFilter}
        jobStatusFilter={jobStatusFilter}
        rowsPerPage={rowsPerPage}
        page={page}
        onSearchTermChange={setSearchTerm}
        onRoleFilterChange={setRoleFilter}
        onJobStatusFilterChange={setJobStatusFilter}
        onRowsPerPageChange={setRowsPerPage}
        onPageChange={setPage}
        updateURLParams={updateURLParams}
        onCreateEmployee={handleOpenCreateModal}
        onEditEmployee={handleOpenEditModal}
      />
      <EmployeeModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        employee={selectedEmployee}
        mode={modalMode}
      />
    </>
  );
}
