"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import JobModal from "../JobModal";
import { saveJob } from "../../actions/saveJob";
import { deleteJob as deleteJobAction } from "../../actions/deleteJob";
import {
  togglePaymentReceived,
  toggleInvoiceSent,
} from "../../actions/toggleJobPaymentStatus";
import {
  ArrowLeft,
  MapPin,
  Calendar,
  Clock,
  DollarSign,
  Users,
  CheckCircle2,
  FileText,
  Package,
  Pencil,
  History,
  Activity,
  AlertTriangle,
  Trash2,
  Loader,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  Briefcase,
  Receipt,
} from "lucide-react";
import { ConfirmDeleteModal } from "@/components/common/ConfirmDeleteModal";

type TabView = "details" | "financials" | "products" | "logs";

const MENU_ITEMS: Array<{ id: TabView; label: string; icon: React.ReactNode }> =
  [
    {
      id: "details",
      label: "Job Details",
      icon: <Briefcase className="w-4 h-4" />,
    },
    {
      id: "financials",
      label: "Financials",
      icon: <DollarSign className="w-4 h-4" />,
    },
    {
      id: "products",
      label: "Product Usage",
      icon: <Package className="w-4 h-4" />,
    },
    { id: "logs", label: "Logs", icon: <History className="w-4 h-4" /> },
  ];

interface Job {
  id: string;
  clientName: string;
  location: string | null;
  description: string | null;
  jobType: string | null;
  jobDate: string | null;
  startTime: string;
  endTime: string | null;
  clockInTime: string | null;
  clockOutTime: string | null;
  status: string;
  price: number | null;
  employeePay: number | null;
  totalTip: number | null;
  parking: number | null;
  paymentReceived: boolean;
  invoiceSent: boolean;
  notes: string | null;
  employee: {
    id: string;
    name: string;
  };
  cleaners: Array<{ id: string; name: string }>;
}

interface ProductUsage {
  id: string;
  quantity: number;
  notes: string | null;
  product: {
    id: string;
    name: string;
    unit: string;
    costPerUnit: number;
  };
}

interface JobLog {
  id: string;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  description: string;
  createdAt: string;
  user: {
    id: string;
    name: string;
  } | null;
}

interface User {
  id: string;
  name: string;
  email: string;
}

interface JobDetailViewProps {
  job: Job;
  productUsage: ProductUsage[];
  logs: JobLog[];
  totalLogs: number;
  logsPage: number;
  logsPerPage: number;
  totalProductCost: number;
  isAdmin: boolean;
  onDeleteJob?: () => Promise<void>;
  users: User[];
}

export default function JobDetailView({
  job,
  productUsage,
  logs,
  totalLogs,
  logsPage,
  logsPerPage,
  totalProductCost,
  isAdmin,
  onDeleteJob,
  users,
}: JobDetailViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Determine back navigation URL based on returnTo parameter or default to jobs
  const returnToUrl = searchParams.get("returnTo");
  const backUrl = returnToUrl ? decodeURIComponent(returnToUrl) : "/jobs";
  const backLabel = returnToUrl ? "Back to Calendar" : "Back to Jobs";

  const [activeView, setActiveView] = useState<TabView>("details");
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Payment toggle states
  const [paymentReceived, setPaymentReceived] = useState(job.paymentReceived);
  const [invoiceSent, setInvoiceSent] = useState(job.invoiceSent);
  const [isTogglingPayment, setIsTogglingPayment] = useState(false);
  const [isTogglingInvoice, setIsTogglingInvoice] = useState(false);

  // Sync activeView with URL params
  useEffect(() => {
    const viewParam = (searchParams.get("tab") as TabView) || "details";
    if (MENU_ITEMS.some((item) => item.id === viewParam)) {
      setActiveView(viewParam);
    }
  }, [searchParams]);

  const updateView = (view: TabView) => {
    setActiveView(view);
    const params = new URLSearchParams(searchParams.toString());

    if (view === "details") {
      params.delete("tab");
    } else {
      params.set("tab", view);
    }

    // Preserve logsPage when switching to logs tab
    if (view !== "logs") {
      params.delete("logsPage");
    }

    // Preserve the 'returnTo' parameter to maintain back navigation context
    // (already in params if it was there originally)

    const query = params.toString();
    router.replace(query ? `/jobs/${job.id}?${query}` : `/jobs/${job.id}`, {
      scroll: false,
    });
  };

  const handleSubmit = async (formData: FormData) => {
    const result = await saveJob(formData);
    return result;
  };

  const handleModalDelete = async (jobId: string) => {
    const result = await deleteJobAction(jobId);
    return result;
  };

  // Calculate duration
  const duration =
    job.endTime && job.startTime
      ? Math.round(
          (new Date(job.endTime).getTime() -
            new Date(job.startTime).getTime()) /
            1000 /
            60
        )
      : null;

  // Calculate net profit
  const netProfit =
    (job.price || 0) -
    (job.employeePay || 0) -
    (job.parking || 0) -
    totalProductCost;

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
      <Badge variant={config.variant} size="md">
        {config.label}
      </Badge>
    );
  };

  const getJobTypeLabel = (type: string | null) => {
    if (!type) return null;
    const labels: Record<string, string> = {
      R: "Residential",
      C: "Commercial",
      PC: "Post-Construction",
      F: "Follow-up",
    };
    return labels[type] || type;
  };

  const handleDelete = async () => {
    if (!onDeleteJob) return;
    setIsDeleting(true);
    try {
      await onDeleteJob();
    } catch (error) {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleTogglePaymentReceived = async () => {
    if (!isAdmin || isTogglingPayment) return;
    setIsTogglingPayment(true);
    const previousValue = paymentReceived;
    setPaymentReceived(!paymentReceived); // Optimistic update

    try {
      const result = await togglePaymentReceived(job.id);
      if (!result.success) {
        setPaymentReceived(previousValue); // Revert on error
      }
    } catch (error) {
      setPaymentReceived(previousValue); // Revert on error
    } finally {
      setIsTogglingPayment(false);
    }
  };

  const handleToggleInvoiceSent = async () => {
    if (!isAdmin || isTogglingInvoice) return;
    setIsTogglingInvoice(true);
    const previousValue = invoiceSent;
    setInvoiceSent(!invoiceSent); // Optimistic update

    try {
      const result = await toggleInvoiceSent(job.id);
      if (!result.success) {
        setInvoiceSent(previousValue); // Revert on error
      }
    } catch (error) {
      setInvoiceSent(previousValue); // Revert on error
    } finally {
      setIsTogglingInvoice(false);
    }
  };

  const getActionIcon = (action: string) => {
    switch (action) {
      case "CLOCKED_IN":
      case "CLOCKED_OUT":
        return <Clock className="w-4 h-4" />;
      case "STATUS_CHANGED":
        return <Activity className="w-4 h-4" />;
      case "PRODUCT_USED":
        return <Package className="w-4 h-4" />;
      case "PAYMENT_RECEIVED":
      case "INVOICE_SENT":
        return <DollarSign className="w-4 h-4" />;
      case "CLEANER_ADDED":
      case "CLEANER_REMOVED":
        return <Users className="w-4 h-4" />;
      default:
        return <FileText className="w-4 h-4" />;
    }
  };

  // Metric Card Component
  const MetricCard = ({
    label,
    value,
    variant = "default",
  }: {
    label: string;
    value: string;
    variant?: "default" | "positive" | "negative";
  }) => (
    <Card variant="cleano_light" className="p-6 h-[8rem]">
      <div className="h-full flex flex-col justify-between">
        <span className="app-title-small !text-[#005F6A]/70">{label}</span>
        <p
          className={`h2-title ${
            variant === "negative"
              ? "text-red-600"
              : variant === "positive"
              ? "text-green-600"
              : "text-[#005F6A]"
          }`}>
          {value}
        </p>
      </div>
    </Card>
  );

  const totalLogsPages = Math.ceil(totalLogs / logsPerPage);

  // Tab Content Components
  const JobDetailsTab = () => (
    <div className="space-y-6">
      {/* Details Grid */}
      <div className="w-1/2 grid grid-cols-1 gap-12">
        {/* Date & Time Card */}
        <Card variant="ghost" className="!p-0">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-[#005F6A]/10 rounded-lg">
              <Calendar className="w-4 h-4 text-[#005F6A]" />
            </div>
            <h3 className="text-sm font-[350] text-[#005F6A]/80">
              Date & Time
            </h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {job.jobDate && (
              <div className="flex justify-between items-center p-3 rounded-xl bg-[#005F6A]/2">
                <span className="input-label !text-[#005F6A]/70">Job Date</span>
                <span className="app-title-small text-[#005F6A]">
                  {new Date(job.jobDate).toLocaleDateString("en-US", {
                    weekday: "short",
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>
            )}
            {job.startTime && (
              <div className="flex justify-between items-center p-3 rounded-xl bg-[#005F6A]/2">
                <span className="input-label !text-[#005F6A]/70">
                  Start Time
                </span>
                <span className="app-title-small text-[#005F6A]">
                  {new Date(job.startTime).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true,
                  })}
                </span>
              </div>
            )}
            {job.endTime && (
              <div className="flex justify-between items-center p-3 rounded-xl bg-[#005F6A]/2">
                <span className="input-label !text-[#005F6A]/70">End Time</span>
                <span className="app-title-small text-[#005F6A]">
                  {new Date(job.endTime).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true,
                  })}
                </span>
              </div>
            )}
            {duration !== null && (
              <div className="flex justify-between items-center p-3 rounded-xl bg-[#005F6A]/5">
                <span className="input-label !text-[#005F6A]/70 flex items-center gap-1">
                  <Clock className="w-4 h-4" />
                  Duration
                </span>
                <span className="app-title-small text-[#005F6A]">
                  {Math.floor(duration / 60)}h {duration % 60}m
                </span>
              </div>
            )}
          </div>
        </Card>

        {/* Team Card */}
        <Card variant="ghost" className="!p-0">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-[#005F6A]/10 rounded-lg">
              <Users className="w-4 h-4 text-[#005F6A]" />
            </div>
            <h3 className="input-label !text-[#005F6A]/70">Team</h3>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 rounded-xl bg-[#005F6A]/2">
              <span className="input-label !text-[#005F6A]/70">Created By</span>
              <Badge variant="cleano" size="sm" className="px-2 py-1">
                {job.employee.name}
              </Badge>
            </div>
            {job.cleaners.length > 0 && (
              <div className="p-3 rounded-xl bg-[#005F6A]/2 flex items-center justify-between">
                <span className="input-label !text-[#005F6A]/70 block mb-2">
                  Assigned Cleaners
                </span>
                <div className="flex flex-wrap gap-2">
                  {job.cleaners.map((cleaner) => (
                    <Badge
                      key={cleaner.id}
                      variant="cleano"
                      size="sm"
                      className="px-2 py-1">
                      {cleaner.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Notes */}
      {job.notes && (
        <>
          <h2 className="text-lg font-[350] tracking-tight text-[#005F6A]">
            Notes
          </h2>
          <Card variant="cleano_light" className="p-6">
            <p className="text-sm text-[#005F6A]/80 whitespace-pre-wrap leading-relaxed">
              {job.notes}
            </p>
          </Card>
        </>
      )}
    </div>
  );

  const FinancialsTab = () => (
    <div className="space-y-6">
      {/* Financial Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Job Price"
          value={job.price !== null ? `$${job.price.toFixed(2)}` : "-"}
        />
        <MetricCard
          label="Employee Pay"
          value={
            job.employeePay !== null ? `-$${job.employeePay.toFixed(2)}` : "-"
          }
        />
        <MetricCard
          label="Product Cost"
          value={
            totalProductCost > 0 ? `-$${totalProductCost.toFixed(2)}` : "-"
          }
        />
        <MetricCard label="Net Profit" value={`$${netProfit.toFixed(2)}`} />
      </div>

      {/* Payment & Financials */}
      <h2 className="text-lg font-[350] tracking-tight text-[#005F6A]">
        Payment & Financials
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Payment Status */}
        <Card variant="ghost" className="!p-0">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-[#005F6A]/10 rounded-lg">
              <CheckCircle2 className="w-4 h-4 text-[#005F6A]" />
            </div>
            <h3 className="input-label !text-[#005F6A]/70">Payment Status</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Button
              type="button"
              variant={paymentReceived ? "primary" : "default"}
              border={false}
              onClick={handleTogglePaymentReceived}
              disabled={!isAdmin || isTogglingPayment}
              className="flex !justify-start gap-2 items-center px-2 py-3 rounded-xl transition-all duration-200">
              <span className="text-sm text-[#005F6A]/70 flex items-center gap-2">
                {isTogglingPayment ? (
                  <Loader className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                {paymentReceived ? "Payment Received" : "Payment Not Received"}
              </span>
            </Button>
            <Button
              type="button"
              variant={invoiceSent ? "primary" : "default"}
              onClick={handleToggleInvoiceSent}
              border={false}
              disabled={!isAdmin || isTogglingInvoice}
              className="flex !justify-start gap-2 items-center px-2 py-3 rounded-xl transition-all duration-200">
              {isTogglingInvoice ? (
                <Loader className="w-4 h-4 animate-spin" />
              ) : (
                <FileText className="w-4 h-4" />
              )}
              {invoiceSent ? "Invoice Sent" : "Invoice Not Sent"}
            </Button>
          </div>
        </Card>

        {/* Financial Breakdown */}
        <Card variant="ghost" className="!p-0">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-[#005F6A]/10 rounded-lg">
              <DollarSign className="w-4 h-4 text-[#005F6A]" />
            </div>
            <h3 className="input-label !text-[#005F6A]/70">
              Financial Details
            </h3>
          </div>
          <div className="space-y-2">
            {job.price !== null && (
              <div className="flex justify-between items-center p-3 rounded-xl bg-green-50">
                <span className="text-sm text-[#005F6A]/70">Job Price</span>
                <span className="text-sm font-[350] text-green-600">
                  + ${job.price.toFixed(2)}
                </span>
              </div>
            )}
            {job.employeePay !== null && (
              <div className="flex justify-between items-center p-3 rounded-xl bg-[#005F6A]/5">
                <span className="text-sm text-[#005F6A]/70">Employee Pay</span>
                <span className="text-sm font-[400] text-[#005F6A]">
                  - $${job.employeePay.toFixed(2)}
                </span>
              </div>
            )}
            {job.totalTip !== null && job.totalTip > 0 && (
              <div className="flex justify-between items-center p-3 rounded-xl bg-green-50">
                <span className="text-sm text-[#005F6A]/70">Tips</span>
                <span className="text-sm font-[400] text-green-600">
                  + ${job.totalTip.toFixed(2)}
                </span>
              </div>
            )}
            {job.parking !== null && job.parking > 0 && (
              <div className="flex justify-between items-center p-3 rounded-xl bg-[#005F6A]/5">
                <span className="text-sm text-[#005F6A]/70">Parking Cost</span>
                <span className="text-sm font-[400] text-[#005F6A]">
                  - ${job.parking.toFixed(2)}
                </span>
              </div>
            )}
            {totalProductCost > 0 && (
              <div className="flex justify-between items-center p-3 rounded-xl bg-[#005F6A]/5">
                <span className="text-sm text-[#005F6A]/70">Product Cost</span>
                <span className="text-sm font-[400] text-[#005F6A]">
                  - ${totalProductCost.toFixed(2)}
                </span>
              </div>
            )}
            <div className="flex justify-between items-center p-3 rounded-xl bg-[#005F6A]/10 mt-2">
              <span className="text-sm font-[400] text-[#005F6A]">
                Net Profit
              </span>
              <span className="text-base font-[400] text-[#005F6A]">
                ${netProfit.toFixed(2)}
              </span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );

  const ProductUsageTab = () => (
    <div className="space-y-6">
      {productUsage.length > 0 ? (
        <Card variant="default" className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-[#005F6A]/10 rounded-lg">
                <Package className="w-4 h-4 text-[#005F6A]" />
              </div>
              <h3 className="text-sm font-[350] text-[#005F6A]/80">
                Products Used
              </h3>
            </div>
            <Badge variant="cleano" size="sm">
              Total: ${totalProductCost.toFixed(2)}
            </Badge>
          </div>

          <div className="space-y-2">
            {productUsage.map((usage) => (
              <div
                key={usage.id}
                className="flex items-center justify-between p-3 rounded-xl bg-[#005F6A]/5">
                <div className="flex-1">
                  <p className="text-sm font-[400] text-[#005F6A]">
                    {usage.product.name}
                  </p>
                  <p className="text-xs text-[#005F6A]/60">
                    {usage.quantity} {usage.product.unit} @ $
                    {usage.product.costPerUnit.toFixed(2)}/unit
                  </p>
                </div>
                <span className="text-sm font-[400] text-[#005F6A]">
                  ${(usage.quantity * usage.product.costPerUnit).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <Card variant="ghost" className="p-8">
          <div className="text-center">
            <div className="w-12 h-12 bg-[#005F6A]/5 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Package className="w-6 h-6 text-[#005F6A]/40" />
            </div>
            <p className="text-sm text-[#005F6A]/60">
              No product usage recorded for this job
            </p>
          </div>
        </Card>
      )}
    </div>
  );

  const LogsTab = () => (
    <div className="space-y-6">
      {logs.length > 0 ? (
        <Card variant="default" className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-[#005F6A]/10 rounded-lg">
              <History className="w-4 h-4 text-[#005F6A]" />
            </div>
            <h3 className="text-sm font-[350] text-[#005F6A]/80">
              Activity History
            </h3>
          </div>

          <div className="space-y-3">
            {logs.map((log, index) => {
              const isLast = index === logs.length - 1;
              return (
                <div key={log.id} className="relative">
                  <div className="flex gap-3">
                    {!isLast && (
                      <div className="absolute left-[17px] top-10 bottom-0 w-px bg-[#005F6A]/10" />
                    )}
                    <div className="relative z-10 flex items-center justify-center w-9 h-9 rounded-full bg-[#005F6A]/10 text-[#005F6A] flex-shrink-0">
                      {getActionIcon(log.action)}
                    </div>
                    <div className="flex-1 pb-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="text-sm font-[400] text-[#005F6A]">
                            {log.description}
                          </p>
                          {log.user && (
                            <p className="text-xs text-[#005F6A]/60 mt-1">
                              by {log.user.name}
                            </p>
                          )}
                          {log.field && log.oldValue && log.newValue && (
                            <p className="text-xs text-[#005F6A]/60 mt-1">
                              {log.field}: {log.oldValue} → {log.newValue}
                            </p>
                          )}
                        </div>
                        <time className="text-xs text-[#005F6A]/60 ml-4 flex-shrink-0">
                          {new Date(log.createdAt).toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                            hour12: true,
                          })}
                        </time>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {totalLogs > logsPerPage && (
            <div className="flex items-center justify-between pt-4 mt-4 border-t border-[#005F6A]/10">
              <div className="text-xs text-[#005F6A]/70">
                Page {logsPage} of {totalLogsPages}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  href={`/jobs/${job.id}?tab=logs&logsPage=1`}
                  disabled={logsPage === 1}
                  className="px-2">
                  <ChevronsLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  href={`/jobs/${job.id}?tab=logs&logsPage=${logsPage - 1}`}
                  disabled={logsPage === 1}
                  className="px-2">
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  href={`/jobs/${job.id}?tab=logs&logsPage=${logsPage + 1}`}
                  disabled={logsPage === totalLogsPages}
                  className="px-2">
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  href={`/jobs/${job.id}?tab=logs&logsPage=${totalLogsPages}`}
                  disabled={logsPage === totalLogsPages}
                  className="px-2">
                  <ChevronsRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      ) : (
        <Card variant="ghost" className="p-8">
          <div className="text-center">
            <div className="w-12 h-12 bg-[#005F6A]/5 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <History className="w-6 h-6 text-[#005F6A]/40" />
            </div>
            <p className="text-sm text-[#005F6A]/60">No activity logs yet</p>
          </div>
        </Card>
      )}
    </div>
  );

  return (
    <div className="relative h-full overflow-y-auto pb-8 px-4">
      <div className="relative z-10 max-w-[80rem] w-full mx-auto space-y-6">
        {/* Back Button */}
        <Link href={backUrl} className="">
          <Button
            variant="default"
            size="sm"
            border={false}
            className="mb-2 px-6 py-3">
            <ArrowLeft className="w-4 h-4 mr-2" />
            {backLabel}
          </Button>
        </Link>

        {/* Header */}
        <div className="w-full flex flex-col md:flex-row items-start justify-between gap-4 my-10">
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl !font-light tracking-tight text-[#005F6A]">
                {job.clientName}
              </h1>
              {getStatusBadge(job.status)}
              {job.jobType && (
                <Badge variant="cleano" size="md" className="px-2 py-1">
                  {getJobTypeLabel(job.jobType)}
                </Badge>
              )}
            </div>
            {job.location && (
              <div className="flex items-center gap-2 text-[#005F6A]/70 mt-2">
                <MapPin className="w-4 h-4" />
                <span className="text-sm">{job.location}</span>
              </div>
            )}
            {job.description && (
              <p className="text-sm text-[#005F6A]/60 mt-2">
                {job.description}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="md"
              onClick={() => setIsEditModalOpen(true)}
              border={false}
              className="px-6 py-3">
              <Pencil className="w-4 h-4 mr-2" />
              Edit Job
            </Button>
            {isAdmin && (
              <Button
                variant="destructive"
                size="md"
                border={false}
                onClick={() => setShowDeleteConfirm(true)}
                className="px-6 py-3">
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Job
              </Button>
            )}
          </div>
        </div>

        {/* Payment Warning */}
        {job.status === "COMPLETED" && !job.paymentReceived && (
          <div className="rounded-2xl p-4 flex items-center gap-3 bg-yellow-50">
            <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0" />
            <p className="text-sm text-yellow-700 font-[350]">
              Payment pending for this completed job
            </p>
          </div>
        )}

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
          {activeView === "details" && <JobDetailsTab />}
          {activeView === "financials" && <FinancialsTab />}
          {activeView === "products" && <ProductUsageTab />}
          {activeView === "logs" && <LogsTab />}
        </div>
      </div>

      {/* Edit Job Modal */}
      <JobModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        job={job}
        mode="edit"
        users={users}
        onSubmit={handleSubmit}
        onDelete={handleModalDelete}
      />

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <ConfirmDeleteModal
          isOpen={showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(false)}
          onConfirm={handleDelete}
          fileName={job.clientName || "this job"}
          title="Delete Job"
          message="This action cannot be undone. All job data will be permanently removed."
        />
      )}
    </div>
  );
}
