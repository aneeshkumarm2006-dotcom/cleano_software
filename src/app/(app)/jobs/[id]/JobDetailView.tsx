"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Button from "@/components/ui/Button";
import JobModal from "../JobModal";
import { saveJob } from "../../actions/saveJob";
import { deleteJob as deleteJobAction } from "../../actions/deleteJob";
import { togglePaymentReceived } from "../../actions/toggleJobPaymentStatus";
import { chargeJob } from "../../actions/chargeJob";
import { sendAddCardLink } from "../../actions/sendAddCardLink";
import { resendReceipt } from "../../actions/resendReceipt";
import { generateInvoiceFromJob } from "../../actions/generateInvoiceFromJob";
import { markJobComplete } from "../../actions/markJobComplete";
import { createRatingToken } from "../../actions/createRatingToken";
import { setAfterPhotoOverride } from "../../actions/setAfterPhotoOverride";
import {
  ArrowLeft, MapPin, Clock, DollarSign, Users,
  CheckCircle2, Package, Pencil, History, Activity,
  AlertTriangle, Trash2, Loader, Briefcase, Receipt, Camera, X,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, FileText,
  Star, Copy, Check, Inbox, RotateCcw, XCircle,
} from "lucide-react";
import { resolveJobRequest } from "../../actions/resolveJobRequest";
import { fmtDateTime, fmtTime } from "@/lib/time";
import { assignCleaners } from "../../actions/assignCleaners";
import { ConfirmDeleteModal } from "@/components/common/ConfirmDeleteModal";
import Modal from "@/components/ui/Modal";
import { cancelJobByAdmin } from "../../actions/cancelJobByAdmin";
import { issueRefund } from "../../actions/issueRefund";

type TabView = "details" | "financials" | "products" | "logs" | "requests";

const TABS: Array<{ id: TabView; label: string; icon: React.ReactNode }> = [
  { id: "details",    label: "Job details",    icon: <Briefcase size={15} /> },
  { id: "financials", label: "Financials",     icon: <DollarSign size={15} /> },
  { id: "products",   label: "Product usage",  icon: <Package size={15} /> },
  { id: "logs",       label: "Logs",           icon: <History size={15} /> },
  { id: "requests",   label: "Requests",       icon: <Inbox size={15} /> },
];

interface Job {
  id: string;
  clientName: string;
  clientId?: string | null;
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
  isCashJob?: boolean;
  invoiceSent: boolean;
  notes: string | null;
  paymentType?: string | null;
  discountAmount?: number | null;
  bedCount?: number | null;
  bathCount?: number | null;
  payRateMultiplier?: number | null;
  depositPaid?: boolean;
  depositPaymentIntentId?: string | null;
  refundedAmount?: number | null;
  stripePaymentIntentId?: string | null;
  addOns?: Array<{ id: string; name: string; price: number }>;
  employee: { id: string; name: string };
  cleaners: Array<{ id: string; name: string }>;
  cancellationRequestedAt?: string | null;
  rescheduleRequestedAt?: string | null;
  afterPhotoConsent?: boolean;
  afterPhotoConsentAt?: string | null;
  afterPhotoConsentVersion?: string | null;
  afterPhotoOverrideAt?: string | null;
  ratingTokens?: Array<{
    id: string;
    usedAt: string | Date | null;
    ratingStars: number | null;
    ratherNotAnswer: boolean;
    emailSentAt: string | Date | null;
  }>;
}

interface ClientLite {
  id: string;
  name: string;
  email?: string | null;
  address?: string | null;
  discountPercent?: number | null;
  defaultPaymentMethodId?: string | null;
}

interface ProductUsage {
  id: string;
  quantity: number;
  notes: string | null;
  product: { id: string; name: string; unit: string; costPerUnit: number; };
}

interface JobLog {
  id: string;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  description: string;
  createdAt: string;
  user: { id: string; name: string; } | null;
}

interface JobPhoto {
  id: string;
  url: string;
  caption: string | null;
  createdAt: string;
  employee: { id: string; name: string; };
}

interface User { id: string; name: string; email: string; }

interface JobDetailViewProps {
  job: Job;
  productUsage: ProductUsage[];
  logs: JobLog[];
  photos?: JobPhoto[];
  totalLogs: number;
  logsPage: number;
  logsPerPage: number;
  totalProductCost: number;
  isAdmin: boolean;
  onDeleteJob?: () => Promise<void>;
  users: User[];
  clients?: ClientLite[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function avatarBg(name: string): string {
  const palette = ['#2c6e75','#1a5c63','#3d7f87','#0e4a52','#4f9097','#246a72'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0x7fffffff;
  return palette[h % palette.length];
}

function initials(name: string): string {
  return name.split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; color: string; dot: string }> = {
    CREATED:     { label: 'Created',     bg: '#f3f4f6', color: '#374151', dot: '#9ca3af' },
    SCHEDULED:   { label: 'Scheduled',   bg: '#dbeafe', color: '#1e40af', dot: '#3b82f6' },
    IN_PROGRESS: { label: 'In Progress', bg: '#fef3c7', color: '#92400e', dot: '#f59e0b' },
    COMPLETED:   { label: 'Completed',   bg: '#d1fae5', color: '#065f46', dot: '#10b981' },
    PAID:        { label: 'Paid',        bg: '#d1fae5', color: '#065f46', dot: '#059669' },
    CANCELLED:   { label: 'Cancelled',   bg: '#fee2e2', color: '#991b1b', dot: '#ef4444' },
  };
  const c = map[status] || { label: status, bg: '#f3f4f6', color: '#374151', dot: '#9ca3af' };
  return (
    <span className="pill" style={{ background: c.bg, color: c.color }}>
      <span className="pill-dot" style={{ background: c.dot }} />
      {c.label}
    </span>
  );
}

function TypePill({ type }: { type: string | null }) {
  if (!type) return null;
  const labels: Record<string, string> = { R: 'Residential', C: 'Commercial', PC: 'Post-Construction', F: 'Follow-up' };
  const bgs: Record<string, { bg: string; color: string }> = {
    R:  { bg: 'var(--primary-10)', color: 'var(--primary)' },
    C:  { bg: '#dbeafe',           color: '#1e40af' },
    PC: { bg: '#fef3c7',           color: '#92400e' },
    F:  { bg: '#f3f4f6',           color: '#374151' },
  };
  const s = bgs[type] || { bg: '#f3f4f6', color: '#374151' };
  return <span className="pill" style={{ background: s.bg, color: s.color }}>{labels[type] || type}</span>;
}

function payTypeLabel(type: string | null | undefined): string {
  const map: Record<string, string> = {
    CASH: 'Cash', CHEQUE: 'Cheque', E_TRANSFER: 'E-Transfer',
    CREDIT_CARD: 'Card on file', OTHER: 'Other',
  };
  return type ? (map[type] || type.replace(/_/g, ' ')) : '—';
}

function getActionIcon(action: string) {
  switch (action) {
    case 'CLOCKED_IN': case 'CLOCKED_OUT': return <Clock size={14} />;
    case 'STATUS_CHANGED': return <Activity size={14} />;
    case 'PRODUCT_USED': return <Package size={14} />;
    case 'PAYMENT_RECEIVED': case 'INVOICE_SENT': return <DollarSign size={14} />;
    case 'CLEANER_ADDED': case 'CLEANER_REMOVED': return <Users size={14} />;
    default: return <FileText size={14} />;
  }
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function JobDetailView({
  job,
  productUsage,
  logs,
  photos = [],
  totalLogs,
  logsPage,
  logsPerPage,
  totalProductCost,
  isAdmin,
  onDeleteJob,
  users,
  clients = [],
}: JobDetailViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const returnToUrl = searchParams.get("returnTo");
  const backUrl   = returnToUrl ? decodeURIComponent(returnToUrl) : "/jobs";
  const backLabel = returnToUrl ? "Back to Calendar" : "Back to Jobs";

  const [activeView,       setActiveView]       = useState<TabView>("details");

  // Requests tab — pending cancellation/reschedule action modal
  const [requestModal, setRequestModal] = useState<{
    kind: "cancellation" | "reschedule";
    decision: "approve" | "deny";
  } | null>(null);
  const [requestNote, setRequestNote] = useState("");
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  function openRequestModal(
    kind: "cancellation" | "reschedule",
    decision: "approve" | "deny"
  ) {
    setRequestNote("");
    setRequestError(null);
    setRequestModal({ kind, decision });
  }

  // Inline cleaner-assignment modal (Team card on Job details tab)
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignSelected, setAssignSelected] = useState<Set<string>>(new Set());
  const [assignSearch, setAssignSearch] = useState("");
  const [assignSubmitting, setAssignSubmitting] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  function openAssignModal() {
    setAssignSelected(new Set(job.cleaners.map((c) => c.id)));
    setAssignSearch("");
    setAssignError(null);
    setAssignOpen(true);
  }

  async function confirmAssign() {
    setAssignSubmitting(true);
    setAssignError(null);
    const res = await assignCleaners({
      jobId: job.id,
      cleanerIds: Array.from(assignSelected),
    });
    setAssignSubmitting(false);
    if (!res.success) {
      setAssignError(res.error || "Failed to assign");
      return;
    }
    setAssignOpen(false);
    router.refresh();
  }

  async function confirmRequestResolve() {
    if (!requestModal) return;
    setRequestSubmitting(true);
    setRequestError(null);
    const res = await resolveJobRequest({
      jobId: job.id,
      kind: requestModal.kind,
      decision: requestModal.decision,
      note: requestNote.trim() || undefined,
    });
    setRequestSubmitting(false);
    if (!res.success) {
      setRequestError(res.error || "Failed to resolve");
      return;
    }
    setRequestModal(null);
    router.refresh();
  }
  const [isDeleting,       setIsDeleting]       = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isEditModalOpen,  setIsEditModalOpen]  = useState(false);
  const [lightboxIdx,      setLightboxIdx]      = useState<number | null>(null);
  const [paymentReceived,  setPaymentReceived]  = useState(job.paymentReceived);
  const [invoiceSent,      setInvoiceSent]      = useState(job.invoiceSent);
  const [isTogglingPayment, setIsTogglingPayment] = useState(false);
  const [isTogglingInvoice, setIsTogglingInvoice] = useState(false);
  const [isMarkingComplete, setIsMarkingComplete] = useState(false);
  const [reviewLink, setReviewLink] = useState<string | null>(null);
  const [isSendingReview, setIsSendingReview] = useState(false);
  const [reviewCopied, setReviewCopied] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(job.status);
  const [afterPhotoOverrideAt, setAfterPhotoOverrideAt] = useState<string | null>(
    job.afterPhotoOverrideAt ?? null
  );
  const [isTogglingPhotoOverride, setIsTogglingPhotoOverride] = useState(false);
  // Cancel-with-prompt and Refund modals.
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [refundDepositOnCancel, setRefundDepositOnCancel] = useState(true);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const refundedSoFar = job.refundedAmount ?? 0;
  const depositRemaining = job.depositPaid ? Math.max(0, 20 - refundedSoFar) : 0;
  const refundCap = job.stripePaymentIntentId
    ? Math.max(0, (job.price ?? 0) - refundedSoFar)
    : depositRemaining;

  const [showRefundModal, setShowRefundModal] = useState(false);
  const [isRefunding, setIsRefunding] = useState(false);
  const [refundAmount, setRefundAmount] = useState<string>(
    String(refundCap.toFixed(2))
  );
  const [refundReason, setRefundReason] = useState("");
  const [refundError, setRefundError] = useState<string | null>(null);

  const handleCancelJob = async () => {
    setCancelError(null);
    setIsCancelling(true);
    const res = await cancelJobByAdmin({
      jobId: job.id,
      refundDeposit: refundDepositOnCancel && depositRemaining > 0,
      reason: cancelReason.trim() || undefined,
    });
    setIsCancelling(false);
    if (!res.success) {
      setCancelError(res.error || "Failed to cancel");
      return;
    }
    setShowCancelModal(false);
    setCurrentStatus("CANCELLED");
    router.refresh();
  };

  const handleIssueRefund = async () => {
    setRefundError(null);
    const amt = parseFloat(refundAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setRefundError("Enter a positive amount");
      return;
    }
    setIsRefunding(true);
    const res = await issueRefund({
      jobId: job.id,
      amount: amt,
      reason: refundReason.trim() || undefined,
    });
    setIsRefunding(false);
    if (!res.success) {
      setRefundError(res.error || "Failed to refund");
      return;
    }
    setShowRefundModal(false);
    router.refresh();
  };

  // Lightbox keyboard nav
  useEffect(() => {
    if (lightboxIdx === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape')      setLightboxIdx(null);
      if (e.key === 'ArrowLeft')   setLightboxIdx(i => i === null ? null : (i - 1 + photos.length) % photos.length);
      if (e.key === 'ArrowRight')  setLightboxIdx(i => i === null ? null : (i + 1) % photos.length);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxIdx, photos.length]);

  // Sync tab with URL
  useEffect(() => {
    const viewParam = (searchParams.get("tab") as TabView) || "details";
    if (TABS.some(t => t.id === viewParam)) setActiveView(viewParam);
  }, [searchParams]);

  const updateView = (view: TabView) => {
    setActiveView(view);
    const params = new URLSearchParams(searchParams.toString());
    if (view === "details") { params.delete("tab"); } else { params.set("tab", view); }
    if (view !== "logs") params.delete("logsPage");
    const query = params.toString();
    router.replace(query ? `/jobs/${job.id}?${query}` : `/jobs/${job.id}`, { scroll: false });
  };

  const handleSubmit = async (formData: FormData) => {
    return saveJob(formData);
  };

  const handleModalDelete = async (jobId: string) => {
    return deleteJobAction(jobId);
  };

  const handleDelete = async () => {
    if (!onDeleteJob) return;
    setIsDeleting(true);
    try { await onDeleteJob(); } catch { setIsDeleting(false); setShowDeleteConfirm(false); }
  };

  const handleTogglePaymentReceived = async () => {
    if (!isAdmin || isTogglingPayment) return;
    setIsTogglingPayment(true);
    const prev = paymentReceived;
    setPaymentReceived(!prev);
    try {
      const result = await togglePaymentReceived(job.id);
      if (!result.success) setPaymentReceived(prev);
    } catch { setPaymentReceived(prev); }
    finally { setIsTogglingPayment(false); }
  };

  const handleMarkComplete = async () => {
    if (isMarkingComplete) return;
    setIsMarkingComplete(true);
    const result = await markJobComplete(job.id);
    if (result.success) setCurrentStatus("COMPLETED");
    setIsMarkingComplete(false);
  };

  const handleGetReviewLink = async () => {
    if (isSendingReview) return;
    setIsSendingReview(true);
    const result = await createRatingToken({ jobId: job.id });
    if (result.success && result.token) {
      const link = `${window.location.origin}/rate/${result.token}`;
      setReviewLink(link);
    }
    setIsSendingReview(false);
  };

  const handleTogglePhotoOverride = async () => {
    if (isTogglingPhotoOverride) return;
    setIsTogglingPhotoOverride(true);
    const next = afterPhotoOverrideAt === null;
    const result = await setAfterPhotoOverride(job.id, next);
    if (result.success) {
      setAfterPhotoOverrideAt(next ? new Date().toISOString() : null);
    }
    setIsTogglingPhotoOverride(false);
  };

  const handleCopyReviewLink = () => {
    if (!reviewLink) return;
    navigator.clipboard.writeText(reviewLink);
    setReviewCopied(true);
    setTimeout(() => setReviewCopied(false), 2000);
  };

  const handleGenerateInvoice = async () => {
    if (!isAdmin || isTogglingInvoice) return;
    setIsTogglingInvoice(true);
    try {
      const result = await generateInvoiceFromJob(job.id);
      if (result.success && result.invoiceId) {
        setInvoiceSent(true);
        router.push(`/invoices/${result.invoiceId}`);
      }
    } catch { /* silently fail */ }
    finally { setIsTogglingInvoice(false); }
  };

  // Derived values
  const duration = job.endTime && job.startTime
    ? Math.round((new Date(job.endTime).getTime() - new Date(job.startTime).getTime()) / 60000)
    : null;

  const netProfit = (job.price || 0) - (job.employeePay || 0) - (job.parking || 0) - totalProductCost;
  const grossRevenue = (job.price || 0) - (job.discountAmount || 0);
  const totalLogsPages = Math.ceil(totalLogs / logsPerPage);

  const showPayWarning = job.status === "COMPLETED" && !paymentReceived;

  // Date hero values
  const jobDateObj = job.jobDate ? new Date(job.jobDate) : new Date(job.startTime);
  const dayOfWeek = jobDateObj.toLocaleDateString('en-US', { weekday: 'long' });
  const dayNum    = jobDateObj.toLocaleDateString('en-US', { day: 'numeric' });
  const mon       = jobDateObj.toLocaleDateString('en-US', { month: 'short' });
  const startTimeStr = fmtTime(job.startTime);
  const endTimeStr   = job.endTime ? fmtTime(job.endTime) : null;

  // ── Tab content ────────────────────────────────────────────────────────────

  const DetailsTab = () => (
    <div className="tab-panel">
      {/* Date & Time */}
      <div className="dcard">
        <div className="dcard-head">
          <h3>Date &amp; time</h3>
        </div>
        <div className="date-hero">
          <div className="date-block">
            <span className="mon">{mon}</span>
            <span className="day">{dayNum}</span>
          </div>
          <div className="date-meta">
            <div className="day-of-week">{dayOfWeek}</div>
            <div className="time">
              {startTimeStr}{endTimeStr ? ` — ${endTimeStr}` : ''}
            </div>
            {duration !== null && (
              <div className="duration">{Math.floor(duration / 60)}h {duration % 60}m</div>
            )}
          </div>
        </div>
        {job.addOns && job.addOns.length > 0 && (
          <div style={{ paddingTop: 12, borderTop: '1px solid var(--primary-10)' }}>
            <div className="label" style={{ marginBottom: 8 }}>Add-ons</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {job.addOns.map(a => (
                <span key={a.id} style={{ fontSize: 12, padding: '4px 10px', background: 'var(--cream)', borderRadius: 999, color: 'var(--primary-70)', fontWeight: 500 }}>
                  {a.name} · ${a.price.toFixed(2)}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Team */}
      <div className="dcard">
        <div className="dcard-head">
          <h3>Team</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {job.cleaners.length > 0 && (
              <span style={{ fontSize: 12, color: 'var(--primary-50)' }}>{job.cleaners.length} assigned</span>
            )}
            {isAdmin && (
              <button
                type="button"
                onClick={openAssignModal}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--primary-10)',
                  borderRadius: 999,
                  padding: '5px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--primary)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}>
                <Users className="w-3 h-3" />
                {job.cleaners.length === 0 ? 'Assign cleaners' : 'Change'}
              </button>
            )}
          </div>
        </div>
        <div className="team-list">
          <div className="team-row">
            <div className="avatar avatar-lg" style={{ background: avatarBg(job.employee.name) }}>
              {initials(job.employee.name)}
            </div>
            <div className="team-meta">
              <div className="name">{job.employee.name}</div>
              <div className="role">Created by</div>
            </div>
          </div>
          {job.cleaners.map(c => (
            <div key={c.id} className="team-row">
              <div className="avatar avatar-lg" style={{ background: avatarBg(c.name) }}>
                {initials(c.name)}
              </div>
              <div className="team-meta">
                <div className="name">{c.name}</div>
                <div className="role">Cleaner</div>
              </div>
            </div>
          ))}
          {job.cleaners.length === 0 && (
            <p style={{ color: 'var(--primary-50)', fontSize: 14, padding: '4px 0' }}>No cleaners assigned yet.</p>
          )}
        </div>
      </div>

      {/* Notes */}
      <div className="dcard tab-panel-wide">
        <div className="dcard-head"><h3>Notes</h3></div>
        <p style={{ margin: 0, fontSize: 14.5, color: 'var(--ink-soft)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
          {job.notes || <span style={{ color: 'var(--primary-50)', fontStyle: 'italic' }}>No notes for this job.</span>}
        </p>
      </div>

      {/* Location */}
      {job.location && (
        <div className="dcard tab-panel-wide">
          <div className="dcard-head"><h3>Location</h3></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--ink)' }}>
            <MapPin size={16} style={{ color: 'var(--primary-50)' }} />
            {job.location}
          </div>
        </div>
      )}
    </div>
  );

  const FinancialsTab = () => (
    <div>
      <div className="astat-grid" style={{ marginBottom: 24 }}>
        <div className="astat">
          <div className="astat-head"><span>Price</span></div>
          <div className="astat-value">{job.price !== null ? `$${job.price.toFixed(2)}` : '—'}</div>
          {(job.discountAmount || 0) > 0 && <div className="astat-delta">Discount −${job.discountAmount!.toFixed(2)}</div>}
        </div>
        <div className="astat">
          <div className="astat-head"><span>Employee pay</span></div>
          <div className="astat-value">{job.employeePay !== null ? `$${job.employeePay.toFixed(2)}` : '—'}</div>
          <div className="astat-delta">{job.cleaners.length} cleaner{job.cleaners.length === 1 ? '' : 's'}</div>
        </div>
        <div className="astat">
          <div className="astat-head"><span>Product cost</span></div>
          <div className="astat-value">{totalProductCost > 0 ? `$${totalProductCost.toFixed(2)}` : '—'}</div>
          <div className="astat-delta">{productUsage.length} item{productUsage.length === 1 ? '' : 's'} used</div>
        </div>
        <div className="astat">
          <div className="astat-head"><span>Net profit</span></div>
          <div className="astat-value" style={{ color: netProfit >= 0 ? 'var(--emerald-600)' : 'var(--error)' }}>
            ${netProfit.toFixed(2)}
          </div>
        </div>
      </div>

      <div className="tab-panel" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
        {/* Breakdown */}
        <div className="dcard">
          <div className="dcard-head">
            <h3>Breakdown</h3>
            <Button
              variant="default" size="sm" border={false}
              onClick={handleGenerateInvoice}
              disabled={!isAdmin || isTogglingInvoice}
              className="rounded-lg px-3 py-1.5 text-xs"
            >
              {isTogglingInvoice ? <Loader size={12} className="animate-spin mr-1" /> : <Receipt size={12} className="mr-1" />}
              {invoiceSent ? 'View Invoice' : 'Invoice'}
            </Button>
          </div>
          <div>
            {job.price !== null && (
              <div className="finrow">
                <span className="finrow-label">Base price</span>
                <span className="finrow-value">${job.price.toFixed(2)}</span>
              </div>
            )}
            {(job.discountAmount || 0) > 0 && (
              <div className="finrow negative">
                <span className="finrow-label">Discount</span>
                <span className="finrow-value">−${job.discountAmount!.toFixed(2)}</span>
              </div>
            )}
            <div className="finrow">
              <span className="finrow-label"><strong>Gross revenue</strong></span>
              <span className="finrow-value">${grossRevenue.toFixed(2)}</span>
            </div>
            {job.employeePay !== null && (
              <div className="finrow negative">
                <span className="finrow-label">Employee pay · {job.cleaners.length} cleaner{job.cleaners.length === 1 ? '' : 's'}</span>
                <span className="finrow-value">−${job.employeePay.toFixed(2)}</span>
              </div>
            )}
            {totalProductCost > 0 && (
              <div className="finrow negative">
                <span className="finrow-label">Product cost</span>
                <span className="finrow-value">−${totalProductCost.toFixed(2)}</span>
              </div>
            )}
            {(job.parking || 0) > 0 && (
              <div className="finrow negative">
                <span className="finrow-label">Parking</span>
                <span className="finrow-value">−${job.parking!.toFixed(2)}</span>
              </div>
            )}
            {(job.totalTip || 0) > 0 && (
              <div className="finrow">
                <span className="finrow-label">Tips</span>
                <span className="finrow-value" style={{ color: 'var(--emerald-600)' }}>+${job.totalTip!.toFixed(2)}</span>
              </div>
            )}
            <div className="finrow total">
              <span className="finrow-label">Net profit</span>
              <span className="finrow-value">${netProfit.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Payment */}
        <div className="dcard">
          <div className="dcard-head">
            <h3>Payment</h3>
            <span style={{ fontSize: 11, color: 'var(--primary-50)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {payTypeLabel(job.paymentType)}
            </span>
          </div>

          {job.depositPaid && (
            <div className="pay-toggle" style={{ background: 'rgba(0,95,106,0.06)', borderRadius: 10, marginBottom: 4 }}>
              <div className="pay-toggle-info">
                <div className="icon-bubble" style={{ background: 'rgba(22,163,74,0.12)' }}>
                  <CheckCircle2 size={18} style={{ color: '#16a34a' }} />
                </div>
                <div className="label-stack">
                  <span className="top">Deposit paid</span>
                  <span className="bottom">$20.00 collected at booking{job.depositPaymentIntentId ? ` · ${job.depositPaymentIntentId}` : ''}</span>
                </div>
              </div>
            </div>
          )}

          <div className="pay-toggle">
            <div className="pay-toggle-info">
              <div className="icon-bubble">
                {isTogglingPayment
                  ? <Loader size={18} className="animate-spin" />
                  : <CheckCircle2 size={18} />
                }
              </div>
              <div className="label-stack">
                <span className="top">Mark as paid</span>
                <span className="bottom">{paymentReceived ? `Paid · $${grossRevenue.toFixed(2)}` : 'Not paid yet'}</span>
              </div>
            </div>
            {isAdmin && (
              <button
                type="button"
                className={`tswitch ${paymentReceived ? 'on' : ''}`}
                onClick={handleTogglePaymentReceived}
                disabled={isTogglingPayment}
                role="switch"
                aria-checked={paymentReceived}
                aria-label="Toggle paid status"
              />
            )}
          </div>

          <div className="pay-toggle">
            <div className="pay-toggle-info">
              <div className="icon-bubble">
                {isTogglingInvoice
                  ? <Loader size={18} className="animate-spin" />
                  : <Receipt size={18} />
                }
              </div>
              <div className="label-stack">
                <span className="top">Invoice sent</span>
                <span className="bottom">{invoiceSent ? 'Invoice emailed to client.' : 'Not sent yet.'}</span>
              </div>
            </div>
            {isAdmin && (
              <button
                type="button"
                className={`tswitch ${invoiceSent ? 'on' : ''}`}
                onClick={handleGenerateInvoice}
                disabled={isTogglingInvoice}
                role="switch"
                aria-checked={invoiceSent}
                aria-label="Toggle invoice sent"
              />
            )}
          </div>

          {!paymentReceived && isAdmin && !job.isCashJob && (
            <ChargeButton jobId={job.id} amount={grossRevenue} />
          )}

          {isAdmin && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
              <SendAddCardLinkButton jobId={job.id} />
              {paymentReceived && <ResendReceiptButton jobId={job.id} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const ProductUsageTab = () => (
    <div className="tab-panel" style={{ gridTemplateColumns: '1fr' }}>
      <div className="dcard">
        <div className="dcard-head">
          <h3>Products used · {productUsage.length}</h3>
          {totalProductCost > 0 && (
            <span style={{ fontSize: 13, color: 'var(--primary-60)', fontWeight: 600 }}>
              Total ${totalProductCost.toFixed(2)}
            </span>
          )}
        </div>
        {productUsage.length === 0 ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--primary-50)', fontSize: 14 }}>
            No products logged for this job.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="prow" style={{ background: 'transparent', border: 0, padding: '8px 16px', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--primary-60)', fontWeight: 700 }}>
              <span>Product</span>
              <span className="pnum">Qty</span>
              <span className="pnum">Unit cost</span>
              <span className="pnum">Total</span>
            </div>
            {productUsage.map(u => (
              <div key={u.id} className="prow">
                <div>
                  <div className="pname">{u.product.name}</div>
                  <div className="pmeta">per {u.product.unit}</div>
                </div>
                <span className="pnum">{u.quantity}</span>
                <span className="pnum">${u.product.costPerUnit.toFixed(2)}</span>
                <span className="pnum">${(u.quantity * u.product.costPerUnit).toFixed(2)}</span>
              </div>
            ))}
            <div className="finrow total" style={{ paddingTop: 18, marginTop: 6 }}>
              <span className="finrow-label">Total product cost</span>
              <span className="finrow-value">${totalProductCost.toFixed(2)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const LogsTab = () => (
    <div className="tab-panel">
      {/* Photos */}
      <div className="dcard">
        <div className="dcard-head">
          <h3>Job photos · {photos.length}</h3>
        </div>
        {photos.length === 0 ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--primary-50)', fontSize: 14 }}>
            No photos for this job yet.
          </div>
        ) : (
          <div className="photo-grid">
            {photos.map((photo, idx) => (
              <button
                key={photo.id}
                type="button"
                className="photo-cell"
                onClick={() => setLightboxIdx(idx)}
                aria-label={photo.caption || `Job photo ${idx + 1}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt={photo.caption || 'Job photo'} loading="lazy" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Activity */}
      <div className="dcard">
        <div className="dcard-head">
          <h3>Activity · {totalLogs}</h3>
        </div>
        {logs.length === 0 ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--primary-50)', fontSize: 14 }}>
            No activity logged yet.
          </div>
        ) : (
          <>
            <div className="timeline">
              {logs.map(log => (
                <div key={log.id} className="tline-item">
                  <div className="tline-dot">{getActionIcon(log.action)}</div>
                  <div>
                    <div className="tline-text">{log.description}</div>
                    {log.user && <div className="tline-actor">by {log.user.name}</div>}
                    {log.field && log.oldValue && log.newValue && (
                      <div className="tline-actor">{log.field}: {log.oldValue} → {log.newValue}</div>
                    )}
                  </div>
                  <div className="tline-ts">
                    {new Date(log.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    <br />
                    <span style={{ fontSize: 11, color: 'var(--primary-40)' }}>
                      {new Date(log.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {totalLogs > logsPerPage && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid var(--primary-10)', fontSize: 12, color: 'var(--primary-60)' }}>
                <span>Page {logsPage} of {totalLogsPages}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <a href={`/jobs/${job.id}?tab=logs&logsPage=1`} className="apager-btn" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, opacity: logsPage === 1 ? 0.35 : 1, pointerEvents: logsPage === 1 ? 'none' : 'auto' }}>
                    <ChevronsLeft size={14} />
                  </a>
                  <a href={`/jobs/${job.id}?tab=logs&logsPage=${logsPage - 1}`} className="apager-btn" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, opacity: logsPage === 1 ? 0.35 : 1, pointerEvents: logsPage === 1 ? 'none' : 'auto' }}>
                    <ChevronLeft size={14} />
                  </a>
                  <a href={`/jobs/${job.id}?tab=logs&logsPage=${logsPage + 1}`} className="apager-btn" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, opacity: logsPage === totalLogsPages ? 0.35 : 1, pointerEvents: logsPage === totalLogsPages ? 'none' : 'auto' }}>
                    <ChevronRight size={14} />
                  </a>
                  <a href={`/jobs/${job.id}?tab=logs&logsPage=${totalLogsPages}`} className="apager-btn" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, opacity: logsPage === totalLogsPages ? 0.35 : 1, pointerEvents: logsPage === totalLogsPages ? 'none' : 'auto' }}>
                    <ChevronsRight size={14} />
                  </a>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  // ── Requests tab ───────────────────────────────────────────────────────────
  const RequestsTab = () => {
    const hasCancel = !!job.cancellationRequestedAt;
    const hasReschedule = !!job.rescheduleRequestedAt;
    const empty = !hasCancel && !hasReschedule;

    return (
      <div className="tab-panel">
        <div className="dcard tab-panel-wide">
          <div className="dcard-head">
            <h3>Customer requests</h3>
          </div>

          {empty ? (
            <div
              style={{
                padding: '56px 24px',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 16,
              }}
            >
              {/* Inline illustration — empty inbox */}
              <svg
                width="120"
                height="120"
                viewBox="0 0 120 120"
                fill="none"
                aria-hidden="true"
              >
                <circle cx="60" cy="60" r="56" fill="var(--primary-5)" />
                <path
                  d="M30 52v32a6 6 0 006 6h48a6 6 0 006-6V52L72 28H42L30 52z"
                  fill="#fff"
                  stroke="var(--primary)"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                />
                <path
                  d="M30 52h22l4 8h8l4-8h22"
                  stroke="var(--primary)"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                  fill="none"
                />
                <path
                  d="M48 38h24M50 44h20"
                  stroke="var(--primary-40)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
                <circle cx="92" cy="32" r="10" fill="#10b981" />
                <path
                  d="M88 32l3 3 6-6"
                  stroke="#fff"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
              <div>
                <p
                  style={{
                    margin: 0,
                    fontSize: 15,
                    fontWeight: 600,
                    color: 'var(--primary-deep)',
                  }}
                >
                  All caught up
                </p>
                <p
                  style={{
                    margin: '6px 0 0',
                    fontSize: 13,
                    color: 'var(--primary-50)',
                    maxWidth: 360,
                  }}
                >
                  No cancellation or reschedule requests for this booking. The
                  customer hasn't asked to change anything.
                </p>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {hasCancel && (
                <div
                  style={{
                    border: '1px solid var(--primary-10)',
                    borderRadius: 14,
                    padding: 18,
                    background: '#fff',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                    <div>
                      <span
                        style={{
                          display: 'inline-block',
                          fontSize: 10.5,
                          fontWeight: 700,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          background: 'rgba(220, 38, 38, 0.10)',
                          color: '#b91c1c',
                          padding: '3px 8px',
                          borderRadius: 6,
                        }}
                      >
                        Cancellation requested
                      </span>
                      <p style={{ margin: '10px 0 0', fontSize: 13.5, color: 'var(--ink)' }}>
                        <strong>{job.clientName}</strong> asked to cancel this booking on{' '}
                        {fmtDateTime(job.cancellationRequestedAt!)}.
                      </p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => openRequestModal('cancellation', 'approve')}
                      style={{
                        padding: '9px 18px',
                        borderRadius: 999,
                        border: 0,
                        background: 'var(--primary-deep)',
                        color: '#fff',
                        fontSize: 13.5,
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Approve cancellation
                    </button>
                    <button
                      type="button"
                      onClick={() => openRequestModal('cancellation', 'deny')}
                      style={{
                        padding: '9px 18px',
                        borderRadius: 999,
                        border: '1px solid var(--primary-10)',
                        background: '#fff',
                        color: 'var(--primary-60)',
                        fontSize: 13.5,
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Deny
                    </button>
                  </div>
                </div>
              )}

              {hasReschedule && (
                <div
                  style={{
                    border: '1px solid var(--primary-10)',
                    borderRadius: 14,
                    padding: 18,
                    background: '#fff',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                    <div>
                      <span
                        style={{
                          display: 'inline-block',
                          fontSize: 10.5,
                          fontWeight: 700,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          background: 'rgba(59, 130, 246, 0.12)',
                          color: '#1d4ed8',
                          padding: '3px 8px',
                          borderRadius: 6,
                        }}
                      >
                        Reschedule requested
                      </span>
                      <p style={{ margin: '10px 0 0', fontSize: 13.5, color: 'var(--ink)' }}>
                        <strong>{job.clientName}</strong> asked to reschedule this booking on{' '}
                        {fmtDateTime(job.rescheduleRequestedAt!)}.
                      </p>
                      <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--primary-50)' }}>
                        Any preferred date or note left by the customer is recorded in the Logs tab.
                      </p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => openRequestModal('reschedule', 'approve')}
                      style={{
                        padding: '9px 18px',
                        borderRadius: 999,
                        border: 0,
                        background: 'var(--primary-deep)',
                        color: '#fff',
                        fontSize: 13.5,
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Approve reschedule
                    </button>
                    <button
                      type="button"
                      onClick={() => openRequestModal('reschedule', 'deny')}
                      style={{
                        padding: '9px 18px',
                        borderRadius: 999,
                        border: '1px solid var(--primary-10)',
                        background: '#fff',
                        color: 'var(--primary-60)',
                        fontSize: 13.5,
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Deny
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="admin-font relative h-full overflow-y-auto pb-8 px-4">
      <div className="relative z-10 max-w-[80rem] w-full mx-auto" style={{ paddingTop: 32 }}>

        {/* Back button */}
        <a href={backUrl} className="jdetail-back">
          <ArrowLeft size={14} /> {backLabel}
        </a>

        {/* Header */}
        <div className="jdetail-head">
          <div className="jdetail-head-left">
            <h1 className="jdetail-title">{job.clientName}</h1>
            <div className="jdetail-meta-row">
              <StatusPill status={job.status} />
              <TypePill type={job.jobType} />
              <span style={{ fontSize: 11.5, color: 'var(--primary-50)', fontFamily: 'monospace' }}>{job.id}</span>
            </div>
            {(job.location || job.description) && (
              <p className="jdetail-desc">
                {job.location}
                {job.description ? <> · <span style={{ color: 'var(--ink-soft)' }}>{job.description}</span></> : null}
              </p>
            )}
          </div>
          <div className="jdetail-actions">
            {isAdmin && !["COMPLETED", "CANCELLED"].includes(currentStatus) && (
              <Button
                variant="default" border={false}
                onClick={handleMarkComplete}
                disabled={isMarkingComplete}
                className="rounded-xl px-4 py-2"
              >
                <CheckCircle2 size={14} className="mr-2" />
                {isMarkingComplete ? "Saving…" : "Mark Complete"}
              </Button>
            )}
            {isAdmin && currentStatus === "COMPLETED" && (
              <Button
                variant="default" border={false}
                onClick={handleGetReviewLink}
                disabled={isSendingReview}
                className="rounded-xl px-4 py-2"
              >
                <Star size={14} className="mr-2" />
                {isSendingReview ? "Generating…" : "Get Review Link"}
              </Button>
            )}
            <Button
              variant="default" border={false}
              onClick={() => setIsEditModalOpen(true)}
              className="rounded-xl px-4 py-2"
            >
              <Pencil size={14} className="mr-2" /> Edit
            </Button>
            {isAdmin && (
              <Button
                variant="default" border={false}
                onClick={() => router.push(`/jobs/new?duplicate=${job.id}`)}
                className="rounded-xl px-4 py-2"
              >
                <Copy size={14} className="mr-2" /> Duplicate
              </Button>
            )}
            {isAdmin && (paymentReceived || depositRemaining > 0) && (
              <Button
                variant="default" border={false}
                onClick={() => {
                  setRefundError(null);
                  setRefundAmount(String(refundCap.toFixed(2)));
                  setRefundReason("");
                  setShowRefundModal(true);
                }}
                className="rounded-xl px-4 py-2"
              >
                <DollarSign size={14} className="mr-2" /> Refund
              </Button>
            )}
            {isAdmin && !["COMPLETED", "CANCELLED"].includes(currentStatus) && (
              <Button
                variant="cancel" border={false}
                onClick={() => {
                  setCancelError(null);
                  setCancelReason("");
                  setRefundDepositOnCancel(depositRemaining > 0);
                  setShowCancelModal(true);
                }}
                className="rounded-xl px-4 py-2"
              >
                <X size={14} className="mr-2" /> Cancel
              </Button>
            )}
            {isAdmin && (
              <Button
                variant="destructive" border={false}
                onClick={() => setShowDeleteConfirm(true)}
                disabled={isDeleting}
                className="rounded-xl px-4 py-2"
              >
                <Trash2 size={14} className="mr-2" /> Delete
              </Button>
            )}
          </div>
        </div>

        {/* Payment warning banner */}
        {showPayWarning && (
          <div className="banner banner-amber">
            <AlertTriangle size={18} style={{ flex: '0 0 auto', marginTop: 1 }} />
            <div style={{ flex: 1 }}>
              <strong>Payment outstanding.</strong> This job was completed but hasn't been paid.
              {!job.isCashJob ? ' Card may be on file — charge anytime.' : ''}
            </div>
            {isAdmin && !job.isCashJob && <ChargeButton jobId={job.id} amount={grossRevenue} compact />}
          </div>
        )}

        {/* Customer rating status */}
        {(() => {
          const rt = job.ratingTokens?.[0];
          if (!rt) return null;
          let label: string;
          let bg = '#f1f5f9', border = '#cbd5e1', color = '#334155', dot = '#64748b';
          if (rt.usedAt && rt.ratingStars != null) {
            label = `Customer rated ${rt.ratingStars} ★`;
            bg = '#ecfdf5'; border = '#6ee7b7'; color = '#065f46'; dot = '#10b981';
          } else if (rt.ratherNotAnswer) {
            label = 'Customer declined to rate ("Rather not answer")';
          } else if (rt.emailSentAt) {
            label = 'Rating requested — awaiting customer response';
            bg = '#fffbeb'; border = '#fcd34d'; color = '#92400e'; dot = '#f59e0b';
          } else {
            label = 'Rating link created — not yet sent';
          }
          return (
            <div className="banner" style={{ background: bg, borderColor: border, color }}>
              <Star size={16} style={{ flex: '0 0 auto', color: dot }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{label}</strong>
              </div>
            </div>
          );
        })()}

        {/* After-photo consent status */}
        {(() => {
          const consented = !!job.afterPhotoConsent;
          const overridden = afterPhotoOverrideAt !== null;
          const allowed = consented || overridden;
          const detail = consented
            ? `Customer consented at booking${
                job.afterPhotoConsentVersion ? ` (${job.afterPhotoConsentVersion})` : ""
              }.`
            : overridden
            ? "No customer consent — enabled by admin override."
            : "Customer did not consent. Cleaners are blocked from uploading after-photos.";
          return (
            <div
              className="banner"
              style={{
                background: allowed ? '#ecfdf5' : '#fef2f2',
                borderColor: allowed ? '#6ee7b7' : '#fca5a5',
                color: allowed ? '#065f46' : '#991b1b',
              }}>
              <Camera size={16} style={{ flex: '0 0 auto', color: allowed ? '#10b981' : '#ef4444' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>After-photos {allowed ? 'allowed' : 'not permitted'}.</strong>{' '}
                {detail}
              </div>
              {isAdmin && !consented && (
                <button
                  type="button"
                  onClick={handleTogglePhotoOverride}
                  disabled={isTogglingPhotoOverride}
                  style={{
                    fontSize: 12, padding: '4px 10px', borderRadius: 8, border: 'none',
                    cursor: 'pointer', flexShrink: 0,
                    background: overridden ? '#991b1b' : '#10b981', color: '#fff',
                  }}>
                  {isTogglingPhotoOverride
                    ? 'Saving…'
                    : overridden ? 'Remove override' : 'Override · allow photos'}
                </button>
              )}
            </div>
          );
        })()}

        {/* Review link banner */}
        {reviewLink && (
          <div className="banner" style={{ background: '#ecfdf5', borderColor: '#6ee7b7', color: '#065f46' }}>
            <Star size={16} style={{ flex: '0 0 auto', color: '#10b981' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>Review link ready.</strong> Share this with the client:
              <div style={{ fontFamily: 'monospace', fontSize: 12, marginTop: 4, wordBreak: 'break-all', opacity: 0.8 }}>
                {reviewLink}
              </div>
            </div>
            <button
              type="button"
              onClick={handleCopyReviewLink}
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '4px 10px', borderRadius: 8, background: '#10b981', color: '#fff', border: 'none', cursor: 'pointer', flexShrink: 0 }}
            >
              {reviewCopied ? <Check size={13} /> : <Copy size={13} />}
              {reviewCopied ? "Copied!" : "Copy"}
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="dtabs">
          {TABS.map(t => {
            const requestBadge =
              t.id === 'requests'
                ? (job.cancellationRequestedAt ? 1 : 0) +
                  (job.rescheduleRequestedAt ? 1 : 0)
                : 0;
            return (
              <button
                key={t.id}
                type="button"
                className={`dtab ${activeView === t.id ? 'active' : ''}`}
                onClick={() => updateView(t.id)}
              >
                {t.icon} {t.label}
                {requestBadge > 0 && (
                  <span
                    style={{
                      marginLeft: 6,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minWidth: 18,
                      height: 18,
                      padding: '0 6px',
                      borderRadius: 999,
                      background: '#dc2626',
                      color: '#fff',
                      fontSize: 10.5,
                      fontWeight: 700,
                    }}
                  >
                    {requestBadge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        {activeView === 'details'    && <DetailsTab />}
        {activeView === 'financials' && <FinancialsTab />}
        {activeView === 'products'   && <ProductUsageTab />}
        {activeView === 'logs'       && <LogsTab />}
        {activeView === 'requests'   && <RequestsTab />}
      </div>

      {/* Resolve request modal (notes + approve/deny) */}
      {requestModal && (
        <div
          onClick={() => !requestSubmitting && setRequestModal(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 60, 70, 0.55)",
            backdropFilter: "blur(2px)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 16,
              maxWidth: 480,
              width: "100%",
              padding: 28,
              boxShadow: "0 20px 60px rgba(0, 60, 70, 0.25)",
            }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
              <div>
                <h2 style={{ fontFamily: "var(--font-serif, serif)", fontSize: 24, color: "var(--primary-deep)", margin: "0 0 6px", fontWeight: 400 }}>
                  {requestModal.decision === "approve"
                    ? `Approve ${requestModal.kind}?`
                    : `Deny ${requestModal.kind}?`}
                </h2>
                <p style={{ fontSize: 13.5, color: "var(--primary-60)", margin: 0, lineHeight: 1.5 }}>
                  {requestModal.kind === "cancellation" && requestModal.decision === "approve"
                    ? "Approve this cancellation? The job will be marked as CANCELLED."
                    : `Mark this ${requestModal.kind} request as ${requestModal.decision === "approve" ? "approved" : "denied"}?`}
                </p>
              </div>
              <button type="button" onClick={() => !requestSubmitting && setRequestModal(null)}
                style={{ background: "transparent", border: 0, cursor: "pointer", color: "var(--primary-50)", padding: 4 }} aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div style={{ marginTop: 22 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--primary-60)", marginBottom: 8 }}>
                {requestModal.decision === "deny"
                  ? "Reason (optional, shown to the customer)"
                  : "Note (optional, shown to the customer)"}
              </label>
              <textarea
                value={requestNote}
                onChange={(e) => setRequestNote(e.target.value)}
                placeholder={requestModal.decision === "deny"
                  ? "e.g. We're outside our cancellation window — please contact us if you'd like to discuss."
                  : "Any extra context to share with the customer."}
                rows={4}
                disabled={requestSubmitting}
                style={{
                  width: "100%",
                  borderRadius: 12,
                  border: "1px solid var(--primary-10)",
                  padding: "10px 12px",
                  fontSize: 14,
                  fontFamily: "inherit",
                  color: "var(--ink)",
                  resize: "vertical",
                  outline: "none",
                }}
              />
            </div>

            {requestError && (
              <div style={{ marginTop: 14, fontSize: 13, color: "#dc2626", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "8px 12px" }}>
                {requestError}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
              <button type="button" onClick={() => !requestSubmitting && setRequestModal(null)} disabled={requestSubmitting}
                style={{ background: "transparent", border: 0, padding: "10px 14px", fontSize: 14, fontWeight: 600, color: "var(--primary-60)", cursor: requestSubmitting ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
                Cancel
              </button>
              <button type="button" onClick={confirmRequestResolve} disabled={requestSubmitting}
                style={{
                  padding: "10px 22px",
                  borderRadius: 999,
                  border: 0,
                  background: requestModal.decision === "approve" ? "var(--primary-deep)" : "#b91c1c",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 600,
                  fontFamily: "inherit",
                  cursor: requestSubmitting ? "not-allowed" : "pointer",
                  opacity: requestSubmitting ? 0.6 : 1,
                }}>
                {requestSubmitting ? "Working…" : requestModal.decision === "approve" ? "Approve" : "Deny"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign cleaners modal */}
      {assignOpen && (
        <div
          onClick={() => !assignSubmitting && setAssignOpen(false)}
          style={{
            position: "fixed", inset: 0,
            background: "rgba(0, 60, 70, 0.55)",
            backdropFilter: "blur(2px)",
            zIndex: 100,
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16,
          }}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 16,
              maxWidth: 520,
              width: "100%",
              maxHeight: "82vh",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 20px 60px rgba(0, 60, 70, 0.25)",
              overflow: "hidden",
            }}>
            <div style={{ padding: "24px 28px 16px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
              <div>
                <h2 style={{ fontFamily: "var(--font-serif, serif)", fontSize: 22, color: "var(--primary-deep)", margin: "0 0 4px", fontWeight: 400 }}>
                  Assign cleaners
                </h2>
                <p style={{ fontSize: 13, color: "var(--primary-60)", margin: 0, lineHeight: 1.5 }}>
                  Pick one or more cleaners for this booking. They'll be notified by email and in-app.
                </p>
              </div>
              <button type="button" onClick={() => !assignSubmitting && setAssignOpen(false)}
                style={{ background: "transparent", border: 0, cursor: "pointer", color: "var(--primary-50)", padding: 4 }} aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div style={{ padding: "0 28px 12px" }}>
              <input
                type="search"
                placeholder="Search cleaners by name…"
                value={assignSearch}
                onChange={(e) => setAssignSearch(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  border: "1px solid var(--primary-10)",
                  borderRadius: 10,
                  fontSize: 14,
                  fontFamily: "inherit",
                  outline: "none",
                }}
              />
            </div>

            <div style={{ overflow: "auto", padding: "4px 12px 12px", flex: 1 }}>
              {(() => {
                const q = assignSearch.trim().toLowerCase();
                const candidates = users
                  .filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
                  // Hide the admin/owner from the candidate list — only EMPLOYEE-level roles.
                  // We don't have role on User here, but `users` prop is pre-filtered server-side
                  // for the Edit modal so it's already cleaners.
                  ;
                if (candidates.length === 0) {
                  return (
                    <p style={{ textAlign: "center", color: "var(--primary-50)", fontSize: 13, padding: 20 }}>
                      No cleaners match this search.
                    </p>
                  );
                }
                return candidates.map((u) => {
                  const selected = assignSelected.has(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => {
                        setAssignSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(u.id)) next.delete(u.id);
                          else next.add(u.id);
                          return next;
                        });
                      }}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "10px 16px",
                        background: selected ? "var(--primary-5)" : "transparent",
                        border: 0,
                        borderRadius: 10,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        textAlign: "left",
                        margin: "2px 0",
                      }}>
                      <span style={{
                        width: 36, height: 36, borderRadius: 999,
                        background: avatarBg(u.name),
                        color: "#fff",
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        fontSize: 13, fontWeight: 600, flexShrink: 0,
                      }}>{initials(u.name)}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>{u.name}</span>
                        <span style={{ display: "block", fontSize: 11.5, color: "var(--primary-50)" }}>{u.email}</span>
                      </span>
                      <span style={{
                        width: 22, height: 22, borderRadius: 6,
                        border: selected ? "0" : "1.5px solid var(--primary-10)",
                        background: selected ? "var(--primary-deep)" : "transparent",
                        color: "#fff",
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0,
                      }}>
                        {selected && <Check className="w-3.5 h-3.5" />}
                      </span>
                    </button>
                  );
                });
              })()}
            </div>

            {assignError && (
              <div style={{ margin: "0 28px 12px", fontSize: 13, color: "#dc2626", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "8px 12px" }}>
                {assignError}
              </div>
            )}

            <div style={{ padding: "12px 28px 20px", borderTop: "1px solid var(--primary-10)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 12.5, color: "var(--primary-50)" }}>
                {assignSelected.size} selected
              </span>
              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" onClick={() => !assignSubmitting && setAssignOpen(false)} disabled={assignSubmitting}
                  style={{ background: "transparent", border: 0, padding: "10px 14px", fontSize: 14, fontWeight: 600, color: "var(--primary-60)", cursor: assignSubmitting ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
                  Cancel
                </button>
                <button type="button" onClick={confirmAssign} disabled={assignSubmitting}
                  style={{
                    padding: "10px 22px",
                    borderRadius: 999, border: 0,
                    background: "var(--primary-deep)", color: "#fff",
                    fontSize: 14, fontWeight: 600,
                    fontFamily: "inherit",
                    cursor: assignSubmitting ? "not-allowed" : "pointer",
                    opacity: assignSubmitting ? 0.6 : 1,
                  }}>
                  {assignSubmitting ? "Assigning…" : `Assign ${assignSelected.size} cleaner${assignSelected.size === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      <JobModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        job={job as any}
        mode="edit"
        users={users}
        clients={clients}
        onSubmit={handleSubmit}
        onDelete={handleModalDelete}
      />

      {/* Delete confirm */}
      {showDeleteConfirm && (
        <ConfirmDeleteModal
          isOpen={showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(false)}
          onConfirm={handleDelete}
          fileName={job.clientName || 'this job'}
          title="Delete Job"
          message="This action cannot be undone. All job data will be permanently removed."
        />
      )}

      {/* Cancel cleaning */}
      <Modal isOpen={showCancelModal} onClose={() => !isCancelling && setShowCancelModal(false)} title="Cancel cleaning?">
        <div className="space-y-4">
          <p className="text-sm text-[#005F6A]/70">
            This sets the job status to <strong>Cancelled</strong> and logs the change. The customer&apos;s saved card is not charged.
          </p>
          <div>
            <label className="block text-xs font-semibold text-[#005F6A]/70 mb-1">Reason (optional)</label>
            <textarea
              className="w-full rounded-xl border border-[#005F6A]/15 bg-[#005F6A]/5 px-3 py-2 text-sm outline-none focus:bg-white focus:border-[#005F6A]/40"
              rows={2}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="e.g. Customer requested, weather, scheduling conflict…"
            />
          </div>
          {depositRemaining > 0 && (
            <label className="flex items-center gap-2 text-sm text-[#005F6A] cursor-pointer">
              <input
                type="checkbox"
                checked={refundDepositOnCancel}
                onChange={(e) => setRefundDepositOnCancel(e.target.checked)}
              />
              <span>Also refund the ${depositRemaining.toFixed(2)} deposit</span>
            </label>
          )}
          {cancelError && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {cancelError}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="cancel" border={false} onClick={() => setShowCancelModal(false)} disabled={isCancelling}>
              Keep booking
            </Button>
            <Button variant="destructive" border={false} onClick={handleCancelJob} disabled={isCancelling}>
              {isCancelling ? "Cancelling…" : "Cancel cleaning"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Refund modal */}
      <Modal isOpen={showRefundModal} onClose={() => !isRefunding && setShowRefundModal(false)} title="Issue refund">
        <div className="space-y-4">
          <p className="text-sm text-[#005F6A]/70">
            {job.stripePaymentIntentId
              ? `Refundable: $${refundCap.toFixed(2)} (already refunded $${refundedSoFar.toFixed(2)}).`
              : depositRemaining > 0
              ? `Deposit refundable: $${depositRemaining.toFixed(2)} of $20.00.`
              : "Nothing left to refund."}
          </p>
          <div>
            <label className="block text-xs font-semibold text-[#005F6A]/70 mb-1">Amount ($)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              max={refundCap}
              value={refundAmount}
              onChange={(e) => setRefundAmount(e.target.value)}
              className="w-full rounded-xl border border-[#005F6A]/15 bg-[#005F6A]/5 px-3 py-2 text-sm outline-none focus:bg-white focus:border-[#005F6A]/40"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#005F6A]/70 mb-1">Reason (optional)</label>
            <textarea
              className="w-full rounded-xl border border-[#005F6A]/15 bg-[#005F6A]/5 px-3 py-2 text-sm outline-none focus:bg-white focus:border-[#005F6A]/40"
              rows={2}
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
              placeholder="Reason shown to customer in their refund email."
            />
          </div>
          {refundError && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {refundError}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="cancel" border={false} onClick={() => setShowRefundModal(false)} disabled={isRefunding}>
              Cancel
            </Button>
            <Button variant="action" border={false} onClick={handleIssueRefund} disabled={isRefunding || refundCap <= 0}>
              {isRefunding ? "Refunding…" : "Issue refund"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Photo lightbox */}
      {lightboxIdx !== null && photos[lightboxIdx] && (
        <div className="admin-lightbox" onClick={() => setLightboxIdx(null)}>
          <button type="button" className="admin-lightbox-close" onClick={() => setLightboxIdx(null)} aria-label="Close">
            <X size={18} />
          </button>
          {photos.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setLightboxIdx(i => i === null ? null : (i - 1 + photos.length) % photos.length); }}
                className="admin-lightbox-close"
                style={{ left: 24, right: 'auto' }}
                aria-label="Previous"
              >
                <ChevronLeft size={20} />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setLightboxIdx(i => i === null ? null : (i + 1) % photos.length); }}
                className="admin-lightbox-close"
                style={{ right: 80 }}
                aria-label="Next"
              >
                <ChevronRight size={20} />
              </button>
            </>
          )}
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '90vh' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photos[lightboxIdx].url} alt={photos[lightboxIdx].caption || 'Job photo'} style={{ maxWidth: '100%', maxHeight: '85vh', borderRadius: 12, objectFit: 'contain' }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Charge button ──────────────────────────────────────────────────────────────

function ChargeButton({ jobId, amount, compact }: { jobId: string; amount: number; compact?: boolean }) {
  const [busy,   setBusy]   = useState(false);
  const [open,   setOpen]   = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  async function handleCharge() {
    setBusy(true);
    setResult(null);
    const res = await chargeJob(jobId);
    setBusy(false);
    if (res.success) {
      setOpen(false);
      setResult({ ok: true, msg: `Charged $${(res as any).amount?.toFixed(2)}` });
    } else {
      setResult({ ok: false, msg: (res as any).error ?? "Failed to charge" });
    }
  }

  if (result?.ok) {
    return <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--emerald-600)', background: 'var(--emerald-100)', padding: '4px 12px', borderRadius: 8 }}>{result.msg}</span>;
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={() => { setResult(null); setOpen(true); }}
          disabled={busy}
          style={{ fontSize: compact ? 12 : 13, fontWeight: 600, background: '#d97706', color: '#fff', border: 0, borderRadius: 8, padding: compact ? '4px 12px' : '8px 16px', cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1 }}
        >
          {busy ? 'Charging…' : `Charge · $${amount.toFixed(2)}`}
        </button>
      </div>

      <Modal isOpen={open} onClose={() => !busy && setOpen(false)} title="Charge client?">
        <div className="space-y-4">
          <p className="text-sm text-[#005F6A]/70">
            This will charge the client&apos;s saved card via Stripe. The customer will receive a receipt email automatically.
          </p>
          <div className="rounded-xl bg-[#005F6A]/5 px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-[#005F6A]/70">Amount</span>
            <span className="text-lg font-semibold text-[#005F6A]">${amount.toFixed(2)}</span>
          </div>
          {result && !result.ok && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {result.msg}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="cancel" border={false} onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="action" border={false} onClick={handleCharge} disabled={busy}>
              {busy ? "Charging…" : `Charge · $${amount.toFixed(2)}`}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

// ── Send "Add card" link button ──────────────────────────────────────────
function SendAddCardLinkButton({ jobId }: { jobId: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    const res = await sendAddCardLink({ jobId });
    if (res.success) {
      setMsg({ ok: true, text: "Add-card link emailed to the customer." });
    } else {
      setMsg({ ok: false, text: res.error ?? "Could not send link." });
    }
    setBusy(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Button
        variant="default"
        border={false}
        onClick={handleClick}
        disabled={busy}
        className="px-4 py-2 text-sm bg-[#fce7f3] text-[#9d174d] hover:bg-[#fbcfe8]">
        {busy ? "Sending…" : 'Send "Add card" link'}
      </Button>
      {msg && (
        <span
          style={{
            fontSize: 11,
            color: msg.ok ? "var(--primary)" : "#dc2626",
            fontWeight: 600,
          }}>
          {msg.text}
        </span>
      )}
    </div>
  );
}

// ── Resend receipt button ────────────────────────────────────────────────
function ResendReceiptButton({ jobId }: { jobId: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    const res = await resendReceipt(jobId);
    if (res.success) {
      setMsg({ ok: true, text: "Receipt re-sent." });
    } else {
      setMsg({ ok: false, text: res.error ?? "Could not resend." });
    }
    setBusy(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Button
        variant="default"
        border={false}
        onClick={handleClick}
        disabled={busy}
        className="px-4 py-2 text-sm bg-[#e0e7ff] text-[#3730a3] hover:bg-[#c7d2fe]">
        {busy ? "Resending…" : "Resend Receipt"}
      </Button>
      {msg && (
        <span
          style={{
            fontSize: 11,
            color: msg.ok ? "var(--primary)" : "#dc2626",
            fontWeight: 600,
          }}>
          {msg.text}
        </span>
      )}
    </div>
  );
}
