"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import JobsView from "./JobsView";
import JobModal from "./JobModal";
import JobsSubTabs, { JobSubTab } from "./JobsSubTabs";
import ExportButton from "./ExportButton";
import { saveJob } from "../actions/saveJob";
import { deleteJob } from "../actions/deleteJob";

interface User {
  id: string;
  name: string;
  email: string;
}

interface ClientLite {
  id: string;
  name: string;
}

export interface Job {
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
  paymentType: string | null;
  discountAmount: number | null;
  bedCount: number | null;
  bathCount: number | null;
  payRateMultiplier: number | null;
  profit: number;
  profitPct: number;
  timeSpentMs: number;
  cleaners: Array<{ id: string; name: string }>;
  addOns: Array<{ id: string; name: string; price: number }>;
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
  initialSubTab: string;
  initialPage: number;
  initialRowsPerPage: number;
  users: User[];
  clients: ClientLite[];
  isAdmin: boolean;
}

export default function JobsPageClient({
  initialJobs,
  initialStats,
  initialSearch,
  initialStatus,
  initialPayment,
  initialSubTab,
  initialPage,
  initialRowsPerPage,
  users,
  clients,
  isAdmin,
}: JobsPageClientProps) {
  const router = useRouter();
  const [isLoading] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  const [searchTerm, setSearchTerm] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [paymentFilter, setPaymentFilter] = useState(initialPayment);
  const [subTab, setSubTab] = useState<JobSubTab>(
    (initialSubTab as JobSubTab) || "all"
  );
  const [page, setPage] = useState(initialPage);
  const [rowsPerPage, setRowsPerPage] = useState(initialRowsPerPage);

  // Extended filter state (admin features)
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [jobTypeFilter, setJobTypeFilter] = useState<string>("all");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");
  const [paymentTypeFilter, setPaymentTypeFilter] = useState<string>("all");

  const updateURLParams = (updates: Record<string, string | number>) => {
    const params = new URLSearchParams();
    const finalSearch =
      updates.search !== undefined ? String(updates.search) : searchTerm;
    const finalStatus =
      updates.status !== undefined ? String(updates.status) : statusFilter;
    const finalPayment =
      updates.payment !== undefined ? String(updates.payment) : paymentFilter;
    const finalSubTab =
      updates.subTab !== undefined ? String(updates.subTab) : subTab;
    const finalPage = updates.page !== undefined ? Number(updates.page) : page;
    const finalRowsPerPage =
      updates.rowsPerPage !== undefined
        ? Number(updates.rowsPerPage)
        : rowsPerPage;

    if (finalSearch) params.set("search", finalSearch);
    if (finalStatus && finalStatus !== "all") params.set("status", finalStatus);
    if (finalPayment && finalPayment !== "all")
      params.set("payment", finalPayment);
    if (finalSubTab && finalSubTab !== "all") params.set("subTab", finalSubTab);
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

  const handleSubmit = async (formData: FormData) => saveJob(formData);
  const handleDelete = async (jobId: string) => deleteJob(jobId);

  // Sub-tab filter
  const filteredBySubTab = useMemo(() => {
    const now = Date.now();
    return initialJobs.filter((job) => {
      const jobTime = new Date(job.startTime).getTime();
      switch (subTab) {
        case "upcoming":
          return (
            jobTime >= now &&
            job.status !== "COMPLETED" &&
            job.status !== "CANCELLED"
          );
        case "completed":
          return job.status === "COMPLETED";
        case "overdue":
          return (
            job.status === "COMPLETED" &&
            !job.paymentReceived &&
            now - jobTime > 7 * 24 * 60 * 60 * 1000
          );
        case "discounted":
          return (job.discountAmount || 0) > 0;
        case "free":
          return (job.price || 0) === 0;
        default:
          return true;
      }
    });
  }, [initialJobs, subTab]);

  // Extended filters
  const filteredJobs = useMemo(() => {
    return filteredBySubTab.filter((job) => {
      const jobTime = new Date(job.startTime).getTime();
      if (startDate && jobTime < new Date(startDate).getTime()) return false;
      if (endDate && jobTime > new Date(endDate).getTime() + 86400000)
        return false;
      if (jobTypeFilter !== "all" && job.jobType !== jobTypeFilter) return false;
      if (clientFilter !== "all" && job.clientId !== clientFilter) return false;
      if (
        employeeFilter !== "all" &&
        !job.cleaners.some((c) => c.id === employeeFilter)
      )
        return false;
      if (
        paymentTypeFilter !== "all" &&
        job.paymentType !== paymentTypeFilter
      )
        return false;
      return true;
    });
  }, [
    filteredBySubTab,
    startDate,
    endDate,
    jobTypeFilter,
    clientFilter,
    employeeFilter,
    paymentTypeFilter,
  ]);

  // Counts for the sub-tabs
  const subTabCounts = useMemo(() => {
    const now = Date.now();
    return {
      all: initialJobs.length,
      upcoming: initialJobs.filter(
        (j) =>
          new Date(j.startTime).getTime() >= now &&
          j.status !== "COMPLETED" &&
          j.status !== "CANCELLED"
      ).length,
      completed: initialJobs.filter((j) => j.status === "COMPLETED").length,
      overdue: initialJobs.filter(
        (j) =>
          j.status === "COMPLETED" &&
          !j.paymentReceived &&
          now - new Date(j.startTime).getTime() > 7 * 24 * 60 * 60 * 1000
      ).length,
      discounted: initialJobs.filter((j) => (j.discountAmount || 0) > 0)
        .length,
      free: initialJobs.filter((j) => (j.price || 0) === 0).length,
    } as Record<JobSubTab, number>;
  }, [initialJobs]);

  const activeFilters = {
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    jobType: jobTypeFilter,
    clientId: clientFilter,
    employeeId: employeeFilter,
    paymentType: paymentTypeFilter,
    status: statusFilter,
    discountedOnly: subTab === "discounted",
    unpaidOnly: subTab === "overdue",
  };

  return (
    <>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1">
          <JobsSubTabs
            active={subTab}
            onChange={(t) => {
              setSubTab(t);
              setPage(1);
              updateURLParams({ subTab: t, page: 1 });
            }}
            counts={subTabCounts}
          />
        </div>
        {isAdmin && (
          <div className="pt-1">
            <ExportButton filters={activeFilters} />
          </div>
        )}
      </div>

      <JobsView
        jobs={filteredJobs}
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
        onEditJob={handleOpenEditModal as any}
        clients={clients}
        users={users}
        startDate={startDate}
        endDate={endDate}
        jobTypeFilter={jobTypeFilter}
        clientFilter={clientFilter}
        employeeFilter={employeeFilter}
        paymentTypeFilter={paymentTypeFilter}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        onJobTypeFilterChange={setJobTypeFilter}
        onClientFilterChange={setClientFilter}
        onEmployeeFilterChange={setEmployeeFilter}
        onPaymentTypeFilterChange={setPaymentTypeFilter}
      />
      <JobModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        job={selectedJob as any}
        mode={modalMode}
        users={users}
        clients={clients}
        onSubmit={handleSubmit}
        onDelete={handleDelete}
      />
    </>
  );
}
