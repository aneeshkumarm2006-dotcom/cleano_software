"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import JobsView from "./JobsView";
import JobModal from "./JobModal";
import ExportButton from "./ExportButton";
import ImportCsvButton from "@/components/csv/ImportCsvButton";
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
  email?: string | null;
  address?: string | null;
  discountPercent?: number | null;
  defaultPaymentMethodId?: string | null;
}

export interface Job {
  id: string;
  clientName: string;
  clientId: string | null;
  location: string | null;
  aptNumber?: string | null;
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
  isCashJob?: boolean;
  usesFixedPrice?: boolean;
  discountAmount: number | null;
  /** Canonical revenue inputs (see src/lib/metrics-shared). */
  refundedAmount: number | null;
  deletedAt: string | null;
  bedCount: number | null;
  bathCount: number | null;
  halfBathCount: number | null;
  payRateMultiplier: number | null;
  profit: number;
  profitPct: number;
  timeSpentMs: number;
  cleaners: Array<{ id: string; name: string }>;
  addOns: Array<{ id: string; name: string; price: number }>;
}

interface JobsPageClientProps {
  initialJobs: Job[];
  initialSearch: string;
  initialStatus: string;
  initialPayment: string;
  initialSubTab: string;
  initialPage: number;
  initialRowsPerPage: number;
  users: User[];
  cleaners?: User[];
  clients: ClientLite[];
  addOnCatalog?: Array<{ id: string; name: string; price: number }>;
  isAdmin: boolean;
  archived?: boolean;
}

export default function JobsPageClient({
  initialJobs,
  initialSearch,
  initialStatus,
  initialPayment,
  initialPage,
  initialRowsPerPage,
  users,
  cleaners = [],
  clients,
  addOnCatalog = [],
  isAdmin,
  archived = false,
}: JobsPageClientProps) {
  const router = useRouter();
  const [isLoading] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  const [searchTerm, setSearchTerm] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [paymentFilter, setPaymentFilter] = useState(initialPayment);
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

    router.push(`/admin/jobs?${params.toString()}`);
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

  // The Jobs list now has a SINGLE status/tab row, owned by JobsView (it renders
  // the stat cards + tabs and applies the tab predicate to the same list it
  // counts). JobsPageClient only owns the extended filter STATE below, which it
  // hands to JobsView; it no longer pre-filters the job list itself. This is the
  // fix for the duplicate tab rows with conflicting counts.
  const activeFilters = {
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    jobType: jobTypeFilter,
    clientId: clientFilter,
    employeeId: employeeFilter,
    paymentType: paymentTypeFilter,
    status: statusFilter,
  };

  return (
    <>
      <div className="flex items-start justify-end gap-3 mb-2">
        {isAdmin && (
          <div className="pt-1 flex gap-2 items-center">
            <button
              type="button"
              onClick={() =>
                router.push(archived ? "/admin/jobs" : "/admin/jobs?archived=1")
              }
              className="afilter-toggle"
              style={archived ? { background: "var(--primary)", color: "#fff", borderColor: "var(--primary)" } : undefined}
            >
              {archived ? "Active jobs" : "Archived"}
            </button>
            {!archived && (
              <>
                <ImportCsvButton entity="jobs" />
                <ExportButton filters={activeFilters} />
              </>
            )}
          </div>
        )}
      </div>

      <JobsView
        jobs={initialJobs}
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
        cleaners={cleaners}
        archived={archived}
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
        addOnCatalog={addOnCatalog}
        onSubmit={handleSubmit}
        onDelete={handleDelete}
      />
    </>
  );
}
