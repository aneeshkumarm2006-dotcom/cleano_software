"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import JobsView from "./JobsView";
import JobModal from "./JobModal";
import { saveJob } from "../actions/saveJob";
import { deleteJob } from "../actions/deleteJob";

interface User {
  id: string;
  name: string;
  email: string;
}

interface Job {
  id: string;
  clientName: string;
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
  cleaners: Array<{ id: string; name: string }>;
}

interface JobStats {
  totalJobs: number;
  completedJobs: number;
  totalRevenue: number;
  pendingPayment: number;
}

interface JobsPageClientProps {
  initialJobs: Job[];
  initialStats: JobStats;
  initialSearch: string;
  initialStatus: string;
  initialPayment: string;
  initialPage: number;
  initialRowsPerPage: number;
  users: User[];
}

export default function JobsPageClient({
  initialJobs,
  initialStats,
  initialSearch,
  initialStatus,
  initialPayment,
  initialPage,
  initialRowsPerPage,
  users,
}: JobsPageClientProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  // Filter state
  const [searchTerm, setSearchTerm] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [paymentFilter, setPaymentFilter] = useState(initialPayment);
  const [page, setPage] = useState(initialPage);
  const [rowsPerPage, setRowsPerPage] = useState(initialRowsPerPage);

  const updateURLParams = (updates: Record<string, string | number>) => {
    const params = new URLSearchParams();

    const finalSearch =
      updates.search !== undefined ? String(updates.search) : searchTerm;
    const finalStatus =
      updates.status !== undefined ? String(updates.status) : statusFilter;
    const finalPayment =
      updates.payment !== undefined ? String(updates.payment) : paymentFilter;
    const finalPage = updates.page !== undefined ? Number(updates.page) : page;
    const finalRowsPerPage =
      updates.rowsPerPage !== undefined
        ? Number(updates.rowsPerPage)
        : rowsPerPage;

    if (finalSearch) params.set("search", finalSearch);
    if (finalStatus && finalStatus !== "all") params.set("status", finalStatus);
    if (finalPayment && finalPayment !== "all")
      params.set("payment", finalPayment);
    if (finalPage > 1) params.set("page", String(finalPage));
    if (finalRowsPerPage !== 10)
      params.set("rowsPerPage", String(finalRowsPerPage));

    router.push(`/jobs?${params.toString()}`);
  };

  const handleOpenCreateModal = () => {
    setSelectedJob(null);
    setModalMode("create");
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (job: Job) => {
    setSelectedJob(job);
    setModalMode("edit");
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedJob(null);
  };

  const handleSubmit = async (formData: FormData) => {
    const result = await saveJob(formData);
    return result;
  };

  const handleDelete = async (jobId: string) => {
    const result = await deleteJob(jobId);
    return result;
  };

  return (
    <>
      <JobsView
        jobs={initialJobs}
        stats={initialStats}
        isLoading={isLoading}
        searchTerm={searchTerm}
        statusFilter={statusFilter}
        paymentFilter={paymentFilter}
        rowsPerPage={rowsPerPage}
        page={page}
        onSearchTermChange={setSearchTerm}
        onStatusFilterChange={setStatusFilter}
        onPaymentFilterChange={setPaymentFilter}
        onRowsPerPageChange={setRowsPerPage}
        onPageChange={setPage}
        updateURLParams={updateURLParams}
        onCreateJob={handleOpenCreateModal}
        onEditJob={handleOpenEditModal}
      />
      <JobModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        job={selectedJob}
        mode={modalMode}
        users={users}
        onSubmit={handleSubmit}
        onDelete={handleDelete}
      />
    </>
  );
}
