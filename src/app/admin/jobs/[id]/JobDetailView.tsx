"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import Button from "@/components/ui/Button";
import JobModal from "../JobModal";

// Live "on the way" map (#10). Leaflet needs browser APIs, so load client-only.
const LiveLocationMap = dynamic(() => import("./LiveLocationMap"), {
  ssr: false,
});
import { saveJob } from "../../actions/saveJob";
import { deleteJob as deleteJobAction } from "../../actions/deleteJob";
import { togglePaymentReceived } from "../../actions/toggleJobPaymentStatus";
import { chargeJob } from "../../actions/chargeJob";
import { sendAddCardLink } from "../../actions/sendAddCardLink";
import { resendReceipt } from "../../actions/resendReceipt";
import { generateInvoiceFromJob } from "../../actions/generateInvoiceFromJob";
import { markJobComplete } from "../../actions/markJobComplete";
import { simpleJobStatus } from "@/lib/metrics-shared";
import { createRatingToken } from "../../actions/createRatingToken";
import { setAfterPhotosEnabled } from "../../actions/setAfterPhotoOverride";
import { setJobPriorityLabel } from "../../actions/setJobPriorityLabel";
import { submitRating } from "../../actions/submitRating";
import { updateJobNotificationPrefs } from "../../actions/updateJobNotificationPrefs";
import {
  ArrowLeft, MapPin, Clock, DollarSign, Users,
  CheckCircle2, Package, Pencil, History, Activity,
  AlertTriangle, Trash2, Loader, Briefcase, Receipt, Camera, X,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, FileText,
  Star, Copy, Check, Inbox, RotateCcw, XCircle, Navigation, Bell,
} from "lucide-react";
import { resolveJobRequest } from "../../actions/resolveJobRequest";
import { fmtDate, fmtDateTime, fmtTime } from "@/lib/time";
import { discountReasonLabel, isMissingReason } from "@/lib/discount-reasons";
import {
  resolveClockEntry,
  formatWorkedDuration,
  openShiftMinutes,
  isStaleOpenShift,
  summariseBreaks,
  activeMinutes,
} from "@/lib/time-tracking";
import { avatarColor, initials } from "@/lib/avatar";
import { assignCleaners } from "../../actions/assignCleaners";
import { ConfirmDeleteModal } from "@/components/common/ConfirmDeleteModal";
import Modal from "@/components/ui/Modal";
import { cancelJobByAdmin } from "../../actions/cancelJobByAdmin";
import { setCleanerJobPay } from "../../actions/setCleanerJobPay";
import ClockTimeEditor from "./ClockTimeEditor";
import RatingExclusionControl from "./RatingExclusionControl";
import { issueRefund } from "../../actions/issueRefund";
import JobChatThread from "@/components/JobChatThread";
import JobChatModeration from "@/components/JobChatModeration";
import { normalizeJobType, jobTypeLabel } from "@/lib/calendar-labels";

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
  priorityLabel: string | null;
  jobDate: string | null;
  startTime: string;
  endTime: string | null;
  clockInTime: string | null;
  clockOutTime: string | null;
  onMyWayAt: string | null;
  onMyWayLat: number | null;
  onMyWayLng: number | null;
  onMyWayLocationAt: string | null;
  status: string;
  price: number | null;
  subtotalAmount?: number | null;
  gstAmount?: number | null;
  qstAmount?: number | null;
  totalAmount?: number | null;
  employeePay: number | null;
  totalTip: number | null;
  parking: number | null;
  paymentReceived: boolean;
  isCashJob?: boolean;
  /** Per-job sales-tax exemption (item 7). */
  taxExempt?: boolean;
  /** Why a discount was applied (item 29). */
  discountReason?: string | null;
  /** Breaks taken on this job, per cleaner (item 26). */
  breaks?: Array<{
    cleanerId: string;
    startedAt: string;
    endedAt: string | null;
  }>;
  usesFixedPrice?: boolean;
  notifyClient?: boolean;
  notifyProvider?: boolean;
  invoiceSent: boolean;
  notes: string | null;
  paymentType?: string | null;
  discountAmount?: number | null;
  bedCount?: number | null;
  bathCount?: number | null;
  halfBathCount?: number | null;
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

interface ReviewPhoto {
  id: string;
  url: string;
  rating: number | null;
  createdAt: string;
}

interface User { id: string; name: string; email: string; }

/** Per-cleaner live status row (item 9). Missing for legacy jobs — the view
 *  derives a fallback from the job-level clock fields instead. */
interface AssignmentLite {
  cleanerId: string;
  status: string;
  onMyWayAt: string | null;
  clockInTime: string | null;
  clockOutTime: string | null;
}

/** Star rating attached to this job (customer review or admin-set). */
interface JobRatingLite {
  id: string;
  employeeId: string;
  employeeName: string;
  rating: number;
  notes: string | null;
  /** Staff member who set it manually; null for customer-submitted ratings. */
  raterName: string | null;
  createdAt: string;
  /** Set when an admin excluded this rating from the cleaner's score (item 5). */
  excludedAt?: string | null;
  excludedByName?: string | null;
  excludedReason?: string | null;
}

interface JobDetailViewProps {
  job: Job;
  productUsage: ProductUsage[];
  logs: JobLog[];
  photos?: JobPhoto[];
  reviewPhotos?: ReviewPhoto[];
  totalLogs: number;
  logsPage: number;
  logsPerPage: number;
  totalProductCost: number;
  /** Current admin-configured GST/QST rates (percent, e.g. 5 / 9.975). */
  taxRates: { gstRate: number; qstRate: number };
  isAdmin: boolean;
  onDeleteJob?: () => Promise<void>;
  users: User[];
  clients?: ClientLite[];
  currentUserName?: string;
  assignments?: AssignmentLite[];
  /** Cleaner id → pay share (tier-based proportional split incl. tip). */
  payShares?: Record<string, number>;
  /** Manual per-cleaner pay overrides (JobAssignment.payAmount). */
  payOverrides?: Record<string, number | null>;
  jobRatings?: JobRatingLite[];
  /** Admin setting `tracking.gpsEnabled` — gates the live on-the-way map. */
  gpsEnabled?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Same derived-status pill as the Jobs table (spec's three operational
// statuses) — the detail page must never disagree with the list row.
function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; color: string; dot: string }> = {
    SCHEDULED:   { label: 'Scheduled',   bg: '#dbeafe', color: '#1e40af', dot: '#3b82f6' },
    IN_PROGRESS: { label: 'In Progress', bg: '#fef3c7', color: '#92400e', dot: '#f59e0b' },
    COMPLETED:   { label: 'Completed',   bg: '#d1fae5', color: '#065f46', dot: '#10b981' },
    PAID:        { label: 'Paid',        bg: '#059669', color: '#ffffff', dot: '#a7f3d0' },
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

// Colors keyed off the NORMALIZED category so imported ("MOVE_IN_OUT") and
// manual ("Move-in / Move-out") jobTypes render the same pill; jobTypeLabel()
// keeps raw enum text out of the UI.
const TYPE_PILL_COLORS: Record<string, { bg: string; color: string }> = {
  RESIDENTIAL:       { bg: 'var(--primary-10)', color: 'var(--primary)' },
  DEEP:              { bg: '#ede9fe',           color: '#5b21b6' },
  MOVE_IN:           { bg: '#dcfce7',           color: '#166534' },
  MOVE_OUT:          { bg: '#dcfce7',           color: '#166534' },
  MOVE_IN_OUT:       { bg: '#dcfce7',           color: '#166534' },
  COMMERCIAL:        { bg: '#dbeafe',           color: '#1e40af' },
  POST_CONSTRUCTION: { bg: '#fef3c7',           color: '#92400e' },
  AIRBNB:            { bg: '#ffe4e6',           color: '#9f1239' },
  FOLLOW_UP:         { bg: '#f3f4f6',           color: '#374151' },
};

function TypePill({ type }: { type: string | null }) {
  if (!type) return null;
  const category = normalizeJobType(type);
  const s = (category && TYPE_PILL_COLORS[category]) || { bg: '#f3f4f6', color: '#374151' };
  return <span className="pill" style={{ background: s.bg, color: s.color }}>{jobTypeLabel(type)}</span>;
}

function CashJobPill() {
  return (
    <span className="pill" style={{ background: '#fef9c3', color: '#854d0e' }} title="Cash job — no Stripe charge, tax exempt">
      Cash job
    </span>
  );
}

function FixedPricePill() {
  return (
    <span className="pill" style={{ background: '#ede9fe', color: '#5b21b6' }} title="Client-specific fixed price applied to this booking">
      Fixed price
    </span>
  );
}

// Per-cleaner assignment status pill (item 9).
const CLEANER_STATUS_STYLES: Record<string, { label: string; bg: string; color: string; dot: string }> = {
  ASSIGNED:    { label: 'Assigned',    bg: '#f3f4f6', color: '#374151', dot: '#9ca3af' },
  ON_THE_WAY:  { label: 'On the way',  bg: '#e0f2fe', color: '#075985', dot: '#0284c7' },
  CLOCKED_IN:  { label: 'Clocked in',  bg: '#fef3c7', color: '#92400e', dot: '#f59e0b' },
  CLOCKED_OUT: { label: 'Clocked out', bg: '#dbeafe', color: '#1e40af', dot: '#3b82f6' },
  COMPLETED:   { label: 'Completed',   bg: '#d1fae5', color: '#065f46', dot: '#10b981' },
  CANCELLED:   { label: 'Cancelled',   bg: '#fee2e2', color: '#991b1b', dot: '#ef4444' },
};

function CleanerStatusPill({ status }: { status: string }) {
  const c = CLEANER_STATUS_STYLES[status] || CLEANER_STATUS_STYLES.ASSIGNED;
  return (
    <span className="pill" style={{ background: c.bg, color: c.color, fontSize: 11 }}>
      <span className="pill-dot" style={{ background: c.dot }} />
      {c.label}
    </span>
  );
}

/** Derive a cleaner's status/times when no JobAssignment row exists (jobs
 *  created before per-cleaner tracking): the job-level clock fields apply to
 *  the whole team. */
function fallbackAssignment(job: {
  status: string;
  onMyWayAt: string | null;
  clockInTime: string | null;
  clockOutTime: string | null;
}): Omit<AssignmentLite, 'cleanerId'> {
  let status = 'ASSIGNED';
  if (job.status === 'CANCELLED') status = 'CANCELLED';
  else if (job.status === 'COMPLETED' || job.status === 'PAID') status = 'COMPLETED';
  else if (job.clockOutTime) status = 'CLOCKED_OUT';
  else if (job.clockInTime) status = 'CLOCKED_IN';
  else if (job.onMyWayAt) status = 'ON_THE_WAY';
  return {
    status,
    onMyWayAt: job.onMyWayAt,
    clockInTime: job.clockInTime,
    clockOutTime: job.clockOutTime,
  };
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
  reviewPhotos = [],
  totalLogs,
  logsPage,
  logsPerPage,
  totalProductCost,
  taxRates,
  isAdmin,
  onDeleteJob,
  users,
  clients = [],
  currentUserName,
  assignments = [],
  payShares = {},
  payOverrides = {},
  jobRatings = [],
  gpsEnabled = true,
}: JobDetailViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const returnToUrl = searchParams.get("returnTo");
  const backUrl   = returnToUrl ? decodeURIComponent(returnToUrl) : "/admin/jobs";
  const backLabel = returnToUrl ? "Back to Calendar" : "Back to Jobs";

  const [priorityChoice, setPriorityChoice] = useState<string>(
    job.priorityLabel ?? "AUTO"
  );
  const [savingPriority, setSavingPriority] = useState(false);

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
  // Non-blocking availability conflicts returned by assignCleaners (outside the
  // cleaner's recurring hours, or a blocked/time-off date). Admin can override.
  const [assignConflicts, setAssignConflicts] = useState<string[]>([]);
  // Manual per-cleaner pay override editor (FLAT/HOURLY jobs pay a TEAM TOTAL
  // split between the crew; this lets admin split it unevenly, e.g. 70/30).
  const [payEditFor, setPayEditFor] = useState<string | null>(null);
  const [payEditValue, setPayEditValue] = useState("");
  const [paySaving, setPaySaving] = useState(false);

  async function savePayOverride(cleanerId: string, clear = false) {
    setPaySaving(true);
    const amount = clear ? null : Number(payEditValue);
    const res = await setCleanerJobPay({ jobId: job.id, cleanerId, amount });
    setPaySaving(false);
    if (!res.success) { alert(res.error); return; }
    setPayEditFor(null);
    setPayEditValue("");
    router.refresh();
  }


  function openAssignModal() {
    setAssignSelected(new Set(job.cleaners.map((c) => c.id)));
    setAssignSearch("");
    setAssignError(null);
    setAssignConflicts([]);
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
    // The assign succeeded; conflicts are advisory (admin override is allowed).
    const conflicts = (res.conflicts ?? []).map((c) => c.warning);
    setAssignConflicts(conflicts);
    if (conflicts.length === 0) setAssignOpen(false);
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
  const [afterPhotoOverrideAt] = useState<string | null>(
    job.afterPhotoOverrideAt ?? null
  );
  // Item 21: after-photos are on by default; this is the per-job opt-out.
  const [photosEnabled, setPhotosEnabled] = useState(!!job.afterPhotoConsent);
  const [isTogglingPhotoOverride, setIsTogglingPhotoOverride] = useState(false);
  // Per-cleaner manual star rating (item 13).
  const [ratingTarget, setRatingTarget] = useState<{ id: string; name: string } | null>(null);
  const [ratingStars, setRatingStars] = useState(5);
  const [ratingNote, setRatingNote] = useState("");
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const [ratingError, setRatingError] = useState<string | null>(null);

  // Per-booking notification toggles (item 15).
  const [notifyClient, setNotifyClient] = useState(job.notifyClient ?? true);
  const [notifyProvider, setNotifyProvider] = useState(job.notifyProvider ?? true);
  const [savingNotifyPref, setSavingNotifyPref] = useState<"client" | "provider" | null>(null);

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

  // Scroll-to-top on navigation is handled globally by <ScrollReset> (mounted
  // in the admin shell). The previous effect here called
  // document.querySelector(".overflow-y-auto"), which matched the SIDEBAR nav —
  // the first such element in the DOM — so it reset the sidebar instead of this
  // page and the job detail still opened mid-scroll.

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
    router.replace(query ? `/admin/jobs/${job.id}?${query}` : `/admin/jobs/${job.id}`, { scroll: false });
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

  const handleToggleAfterPhotos = async () => {
    if (isTogglingPhotoOverride) return;
    setIsTogglingPhotoOverride(true);
    const next = !photosEnabled;
    const result = await setAfterPhotosEnabled(job.id, next);
    if (result.success) {
      setPhotosEnabled(next);
      router.refresh();
    }
    setIsTogglingPhotoOverride(false);
  };

  const handleChangePriority = async (choice: string) => {
    if (savingPriority) return;
    const prev = priorityChoice;
    setPriorityChoice(choice);
    setSavingPriority(true);
    const res = await setJobPriorityLabel(
      job.id,
      choice as "AUTO" | "ROUTINE" | "IMPORTANT" | "NONE"
    );
    setSavingPriority(false);
    if (!res.success) {
      setPriorityChoice(prev);
      return;
    }
    router.refresh();
  };

  const openRatingModal = (cleaner: { id: string; name: string }) => {
    setRatingStars(5);
    setRatingNote("");
    setRatingError(null);
    setRatingTarget(cleaner);
  };

  const handleSubmitRating = async () => {
    if (!ratingTarget || ratingSubmitting) return;
    setRatingSubmitting(true);
    setRatingError(null);
    const res = await submitRating({
      employeeId: ratingTarget.id,
      rating: ratingStars,
      jobId: job.id,
      notes: ratingNote.trim() || null,
    });
    setRatingSubmitting(false);
    if (!res.success) {
      setRatingError(res.error || "Failed to save rating");
      return;
    }
    setRatingTarget(null);
    router.refresh();
  };

  const handleToggleNotifyPref = async (which: "client" | "provider") => {
    if (!isAdmin || savingNotifyPref) return;
    setSavingNotifyPref(which);
    const prevClient = notifyClient;
    const prevProvider = notifyProvider;
    const next =
      which === "client"
        ? { notifyClient: !prevClient }
        : { notifyProvider: !prevProvider };
    // Optimistic flip; revert on failure.
    if (which === "client") setNotifyClient(!prevClient);
    else setNotifyProvider(!prevProvider);
    try {
      const res = await updateJobNotificationPrefs(job.id, next);
      if (!res.success) {
        setNotifyClient(prevClient);
        setNotifyProvider(prevProvider);
      }
    } catch {
      setNotifyClient(prevClient);
      setNotifyProvider(prevProvider);
    } finally {
      setSavingNotifyPref(null);
    }
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
        router.push(`/admin/invoices/${result.invoiceId}`);
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

  // Tax breakdown (Financials tab). Prefer the GST/QST stored on the job; when
  // both are 0 on a NON-cash job (rows saved before taxes were persisted),
  // compute display values from the current settings rates. Cash jobs are tax
  // exempt. Net profit stays computed off pre-tax revenue — taxes are remitted,
  // not profit.
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const taxSubtotal = Math.max(0, grossRevenue);
  const hasStoredTax = (job.gstAmount || 0) > 0 || (job.qstAmount || 0) > 0;
  // Untaxed for either reason: cash payment, or an explicit per-job exemption
  // (item 7). Without the taxExempt arm the detail page would keep imputing
  // GST/QST onto an exempt job whose stored amounts are legitimately zero.
  const untaxed = !!job.isCashJob || !!job.taxExempt;
  const displayGst = untaxed
    ? 0
    : hasStoredTax ? (job.gstAmount || 0) : round2((taxSubtotal * taxRates.gstRate) / 100);
  const displayQst = untaxed
    ? 0
    : hasStoredTax ? (job.qstAmount || 0) : round2((taxSubtotal * taxRates.qstRate) / 100);
  const totalWithTax = round2(taxSubtotal + displayGst + displayQst);

  const totalLogsPages = Math.ceil(totalLogs / logsPerPage);

  const showPayWarning = job.status === "COMPLETED" && !paymentReceived;

  // Date hero values — startTime is the reliable instant; rendered in the
  // BUSINESS timezone so admins browsing from any timezone see Toronto's day.
  const dayOfWeek = fmtDate(job.startTime, { weekday: 'long' });
  const dayNum    = fmtDate(job.startTime, { day: 'numeric' });
  const mon       = fmtDate(job.startTime, { month: 'short' });
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
        {/* Assigned cleaners only. The job's creator / booking source lives in
            Job Logs, not here — the Team card is purely the crew doing the work
            (name · per-job status · per-job pay). */}
        <div className="team-list">
          {job.cleaners.map(c => {
            // Prefer the live per-cleaner assignment row; legacy jobs fall
            // back to the job-level clock fields for the whole team.
            const a = assignments.find(x => x.cleanerId === c.id) ?? fallbackAssignment(job);
            const pay = payShares[c.id];
            return (
              <div key={c.id} className="team-row" style={{ alignItems: 'flex-start' }}>
                <div className="avatar avatar-lg" style={{ background: avatarColor(c.name), flexShrink: 0 }}>
                  {initials(c.name)}
                </div>
                <div className="team-meta" style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <div className="name">{c.name}</div>
                    <CleanerStatusPill status={a.status} />
                  </div>
                  <div className="role" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <span>Cleaner</span>
                    {a.clockInTime && <span>In {fmtTime(a.clockInTime)}</span>}
                    {a.clockOutTime && <span>Out {fmtTime(a.clockOutTime)}</span>}
                    {!a.clockInTime && a.onMyWayAt && a.status === 'ON_THE_WAY' && (
                      <span>Since {fmtTime(a.onMyWayAt)}</span>
                    )}
                    {/* Item 12: total time worked belongs next to in/out, so
                        payroll review doesn't have to subtract by hand. An open
                        shift shows elapsed time, clearly labelled as not final. */}
                    {(() => {
                      const entry = resolveClockEntry({ assignment: a });
                      const brk = summariseBreaks(
                        (job.breaks ?? []).filter((b: { cleanerId: string }) => b.cleanerId === c.id)
                      );
                      const active = activeMinutes(entry.minutesWorked, brk.minutes);
                      return (
                        <>
                          {/* Item 26: the job time summary shows clock-in/out
                              (above), break total, and ACTIVE working time —
                              elapsed minus breaks. */}
                          {active !== null ? (
                            <span style={{ fontWeight: 600, color: 'var(--ink)' }}>
                              {formatWorkedDuration(active)} active
                            </span>
                          ) : (() => {
                            const open = openShiftMinutes(entry);
                            return open !== null ? (
                              <span style={{ fontWeight: 600, color: '#b45309' }}>
                                {formatWorkedDuration(open)} elapsed
                                {isStaleOpenShift(entry) ? ' — check clock-out' : ''}
                              </span>
                            ) : null;
                          })()}
                          {brk.minutes > 0 && (
                            <span style={{ color: '#b45309' }}>
                              {formatWorkedDuration(brk.minutes)} break
                              {brk.count > 1 ? ` (${brk.count})` : ''}
                            </span>
                          )}
                          {brk.isOnBreak && (
                            <span style={{ fontWeight: 600, color: '#b45309' }}>
                              On break now
                            </span>
                          )}
                          {/* Item 4: admins correct a missed clock-in or a
                              wrong clock-out right here, where the times are
                              read. Every edit is logged. */}
                          {isAdmin && (
                            <ClockTimeEditor
                              jobId={job.id}
                              cleanerId={c.id}
                              cleanerName={c.name}
                              clockInTime={a.clockInTime}
                              clockOutTime={a.clockOutTime}
                              label={entry.clockInTime ? 'Edit times' : 'Add times'}
                            />
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  {payEditFor === c.id ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12 }}>$</span>
                      <input
                        type="number" step="0.01" min="0" autoFocus
                        value={payEditValue}
                        onChange={(e) => setPayEditValue(e.target.value)}
                        style={{ width: 78, padding: '3px 6px', fontSize: 12, borderRadius: 6, border: '1px solid var(--primary-20)' }}
                      />
                      <button type="button" disabled={paySaving} onClick={() => savePayOverride(c.id)}
                        style={{ fontSize: 11, padding: '3px 8px', borderRadius: 999, border: 'none', background: 'var(--primary)', color: '#fff', cursor: 'pointer' }}>
                        {paySaving ? '…' : 'Save'}
                      </button>
                      <button type="button" disabled={paySaving} onClick={() => savePayOverride(c.id, true)}
                        title="Clear the override and go back to the automatic rate-based amount"
                        style={{ fontSize: 11, padding: '3px 8px', borderRadius: 999, border: '1px solid var(--primary-10)', background: 'transparent', cursor: 'pointer' }}>
                        Reset
                      </button>
                      <button type="button" onClick={() => setPayEditFor(null)}
                        style={{ fontSize: 11, padding: '3px 6px', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--primary-50)' }}>
                        ✕
                      </button>
                    </div>
                  ) : (
                    pay !== undefined && pay > 0 && (
                      <span
                        style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', cursor: isAdmin ? 'pointer' : 'default' }}
                        title={payOverrides[c.id] != null
                          ? 'Manual pay override for this cleaner — click to change'
                          : 'Pay for this job (incl. tip split). Click to set a custom amount.'}
                        onClick={isAdmin ? () => { setPayEditFor(c.id); setPayEditValue(String(payOverrides[c.id] ?? pay.toFixed(2))); } : undefined}
                      >
                        ${pay.toFixed(2)}
                        {/* Item 11: automatic vs manually overridden must be
                            explicit, not inferred from a missing badge. */}
                        {payOverrides[c.id] != null ? (
                          <span style={{ marginLeft: 4, fontSize: 10, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 999, padding: '1px 5px' }}>
                            custom
                          </span>
                        ) : (
                          <span style={{ marginLeft: 4, fontSize: 10, color: 'var(--primary-60)', background: 'var(--primary-5)', border: '1px solid var(--primary-10)', borderRadius: 999, padding: '1px 5px' }}>
                            auto
                          </span>
                        )}
                      </span>
                    )
                  )}
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => openRatingModal(c)}
                      style={{
                        background: 'transparent',
                        border: '1px solid var(--primary-10)',
                        borderRadius: 999,
                        padding: '3px 10px',
                        fontSize: 11,
                        fontWeight: 600,
                        color: 'var(--primary)',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}>
                      <Star size={11} />
                      Set rating
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {job.cleaners.length === 0 && (
            <p style={{ color: 'var(--primary-50)', fontSize: 14, padding: '4px 0' }}>No cleaners assigned yet.</p>
          )}
          {/* Job-level clock times (item 4). These are the legacy fields older
              jobs recorded before per-cleaner assignments, and the fallback the
              Team card reads when a cleaner has no assignment row. */}
          {isAdmin && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
                paddingTop: 10,
                marginTop: 6,
                borderTop: '1px solid var(--primary-10)',
                fontSize: 12,
                color: 'var(--primary-60)',
              }}>
              <span>
                Job clock: {job.clockInTime ? fmtDateTime(job.clockInTime) : '—'}
                {' → '}
                {job.clockOutTime ? fmtDateTime(job.clockOutTime) : '—'}
              </span>
              <ClockTimeEditor
                jobId={job.id}
                clockInTime={job.clockInTime}
                clockOutTime={job.clockOutTime}
                label="Edit job times"
              />
            </div>
          )}
        </div>
      </div>

      {/* Ratings — customer reviews + admin-set stars for this job */}
      <div className="dcard">
        <div className="dcard-head">
          <h3>Ratings</h3>
          {jobRatings.length > 0 && (
            <span style={{ fontSize: 12, color: 'var(--primary-50)' }}>
              {(() => {
                const active = jobRatings.filter(r => !r.excludedAt).length;
                const excluded = jobRatings.length - active;
                return excluded > 0 ? `${active} active · ${excluded} excluded` : `${active}`;
              })()}
            </span>
          )}
        </div>
        {jobRatings.length === 0 ? (
          <p style={{ color: 'var(--primary-50)', fontSize: 13.5, margin: 0, padding: '2px 0' }}>
            No ratings for this job yet.{isAdmin ? ' Use "Set rating" on a cleaner to add one.' : ''}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {jobRatings.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--primary-10)' }}>
                <span style={{ display: 'inline-flex', gap: 1, flexShrink: 0, marginTop: 2 }}>
                  {[1, 2, 3, 4, 5].map(s => (
                    <Star
                      key={s}
                      size={13}
                      style={{
                        color: s <= Math.round(r.rating) ? '#f59e0b' : '#e5e7eb',
                        fill: s <= Math.round(r.rating) ? '#f59e0b' : '#e5e7eb',
                      }}
                    />
                  ))}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>
                    {r.employeeName}
                    <span style={{ fontWeight: 400, color: 'var(--primary-50)', marginLeft: 6, fontSize: 12 }}>
                      {r.raterName ? `set by ${r.raterName} (admin)` : 'customer rating'}
                    </span>
                    {/* Item 5: the job always shows whether a rating counts. */}
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        borderRadius: 999,
                        padding: '2px 8px',
                        background: r.excludedAt ? '#fee2e2' : '#dcfce7',
                        color: r.excludedAt ? '#b91c1c' : '#15803d',
                      }}>
                      {r.excludedAt ? 'Excluded' : 'Active'}
                    </span>
                  </div>
                  {r.excludedAt && (
                    <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 3 }}>
                      Excluded {fmtDate(r.excludedAt, { month: 'short', day: 'numeric' })}
                      {r.excludedByName ? ` by ${r.excludedByName}` : ''}
                      {r.excludedReason ? ` — ${r.excludedReason}` : ''}
                      {' · not counted in their average or pay tier'}
                    </div>
                  )}
                  {r.notes && (
                    <div style={{ fontSize: 12.5, color: 'var(--primary-60)', marginTop: 2, fontStyle: 'italic' }}>
                      {r.notes}
                    </div>
                  )}
                </div>
                <div style={{ flexShrink: 0, textAlign: 'right' }}>
                  <span style={{ fontSize: 11.5, color: 'var(--primary-40)' }}>
                    {fmtDate(r.createdAt, { month: 'short', day: 'numeric' })}
                  </span>
                  {isAdmin && (
                    <div style={{ marginTop: 4 }}>
                      <RatingExclusionControl
                        ratingId={r.id}
                        excluded={!!r.excludedAt}
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Notifications — per-booking client/provider send controls */}
      {isAdmin && (
        <div className="dcard">
          <div className="dcard-head">
            <h3>Notifications</h3>
            <Bell size={14} style={{ color: 'var(--primary-40)' }} />
          </div>
          <div className="pay-toggle">
            <div className="pay-toggle-info">
              <div className="label-stack">
                <span className="top">Client notifications</span>
                <span className="bottom">
                  {notifyClient
                    ? 'Booking emails, SMS, reminders and receipts are sent.'
                    : 'Off — no booking emails, SMS, reminders or receipts for this job.'}
                </span>
              </div>
            </div>
            <button
              type="button"
              className={`tswitch ${notifyClient ? 'on' : ''}`}
              onClick={() => handleToggleNotifyPref('client')}
              disabled={savingNotifyPref !== null}
              role="switch"
              aria-checked={notifyClient}
              aria-label="Toggle client notifications for this booking"
            />
          </div>
          <div className="pay-toggle">
            <div className="pay-toggle-info">
              <div className="label-stack">
                <span className="top">Provider notifications</span>
                <span className="bottom">
                  {notifyProvider
                    ? 'Assignment invites and booking alerts reach the cleaners.'
                    : 'Off — cleaners get no invites or alerts for this job.'}
                </span>
              </div>
            </div>
            <button
              type="button"
              className={`tswitch ${notifyProvider ? 'on' : ''}`}
              onClick={() => handleToggleNotifyPref('provider')}
              disabled={savingNotifyPref !== null}
              role="switch"
              aria-checked={notifyProvider}
              aria-label="Toggle provider notifications for this booking"
            />
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--primary-50)', margin: '8px 0 0', lineHeight: 1.5 }}>
            Applies to this booking only. Global notification settings still apply on top.
          </p>
        </div>
      )}

      {/* Notes */}
      <div className="dcard tab-panel-wide">
        <div className="dcard-head"><h3>Notes</h3></div>
        <p style={{ margin: 0, fontSize: 14.5, color: 'var(--ink-soft)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
          {job.notes || <span style={{ color: 'var(--primary-50)' }}>No notes for this job.</span>}
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

      {/* Job chat — read-only-ish moderation view; admin may also post as ADMIN */}
      <div className="dcard tab-panel-wide">
        <div className="dcard-head">
          <h3>Job chat</h3>
          <span style={{ fontSize: 12, color: 'var(--primary-50)' }}>
            Cleaner ↔ client
          </span>
        </div>
        <JobChatThread
          jobId={job.id}
          otherLabel="cleaner and client"
          userName={currentUserName}
          canSend={isAdmin}
          canModerate={isAdmin}
          height={320}
        />
        <p style={{ fontSize: 12, color: 'var(--primary-50)', margin: '10px 0 0', lineHeight: 1.5 }}>
          The job-specific conversation between the assigned cleaner and the client.
          {isAdmin ? ' Posting here sends a message as Admin.' : ' Read-only.'}
        </p>
        {/* Messaging controls sit under the thread, where the decision is made.
            The panel authorizes itself and renders nothing for anyone below
            OWNER/ADMIN. */}
        {isAdmin && <JobChatModeration jobId={job.id} />}
      </div>
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
                {/* Item 29: the reason sits with the discount, and a missing
                    one reads as "No reason assigned" rather than nothing —
                    silence would look like there was no discount to explain. */}
                <span className="finrow-label">
                  Discount
                  {(() => {
                    const reason = discountReasonLabel(job);
                    return reason ? (
                      <span
                        style={{
                          marginLeft: 6,
                          fontSize: 11,
                          fontWeight: 600,
                          borderRadius: 999,
                          padding: '1px 7px',
                          background: isMissingReason(job) ? 'var(--primary-5)' : '#fffbeb',
                          color: isMissingReason(job) ? 'var(--primary-60)' : '#92400e',
                        }}>
                        {reason}
                      </span>
                    ) : null;
                  })()}
                </span>
                <span className="finrow-value">−${job.discountAmount!.toFixed(2)}</span>
              </div>
            )}
            <div className="finrow">
              <span className="finrow-label"><strong>Subtotal</strong></span>
              <span className="finrow-value">${taxSubtotal.toFixed(2)}</span>
            </div>
            {untaxed ? (
              <div className="finrow">
                <span className="finrow-label" style={{ color: '#854d0e' }}>
                  {job.taxExempt
                    ? 'Taxes excluded — job marked tax-exempt'
                    : 'Cash job — tax exempt'}
                </span>
                <span className="finrow-value">$0.00</span>
              </div>
            ) : (
              <>
                <div className="finrow">
                  <span className="finrow-label">GST ({taxRates.gstRate}%)</span>
                  <span className="finrow-value">+${displayGst.toFixed(2)}</span>
                </div>
                <div className="finrow">
                  <span className="finrow-label">QST ({taxRates.qstRate}%)</span>
                  <span className="finrow-value">+${displayQst.toFixed(2)}</span>
                </div>
              </>
            )}
            <div className="finrow">
              <span className="finrow-label"><strong>Total with tax</strong></span>
              <span className="finrow-value">${totalWithTax.toFixed(2)}</span>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {job.isCashJob && <CashJobPill />}
              {job.usesFixedPrice && <FixedPricePill />}
              <span style={{ fontSize: 11, color: 'var(--primary-50)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {payTypeLabel(job.paymentType)}
              </span>
            </div>
          </div>

          {job.depositPaid && (
            <div className="pay-toggle" style={{ background: 'rgba(0,140,156,0.06)', borderRadius: 10, marginBottom: 4 }}>
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

          {job.stripePaymentIntentId && (
            <div style={{ fontSize: 11, color: 'var(--primary-50)', padding: '2px 4px 8px', wordBreak: 'break-all' }}>
              Transaction ID: <span style={{ fontFamily: 'monospace' }}>{job.stripePaymentIntentId}</span>
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

      {/* Client review photos (attached to poor ratings) */}
      {reviewPhotos.length > 0 && (
        <div className="dcard">
          <div className="dcard-head">
            <h3>Client review photos · {reviewPhotos.length}</h3>
          </div>
          <div className="photo-grid">
            {reviewPhotos.map((photo, idx) => (
              <a
                key={photo.id}
                href={photo.url}
                target="_blank"
                rel="noopener noreferrer"
                className="photo-cell"
                aria-label={
                  photo.rating != null
                    ? `Client review photo ${idx + 1} (${photo.rating}★)`
                    : `Client review photo ${idx + 1}`
                }>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt="Client review photo" loading="lazy" />
              </a>
            ))}
          </div>
        </div>
      )}

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
                    {fmtDate(log.createdAt, { month: 'short', day: 'numeric' })}
                    <br />
                    <span style={{ fontSize: 11, color: 'var(--primary-40)' }}>
                      {fmtTime(log.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {totalLogs > logsPerPage && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid var(--primary-10)', fontSize: 12, color: 'var(--primary-60)' }}>
                <span>Page {logsPage} of {totalLogsPages}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <a href={`/admin/jobs/${job.id}?tab=logs&logsPage=1`} className="apager-btn" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, opacity: logsPage === 1 ? 0.35 : 1, pointerEvents: logsPage === 1 ? 'none' : 'auto' }}>
                    <ChevronsLeft size={14} />
                  </a>
                  <a href={`/admin/jobs/${job.id}?tab=logs&logsPage=${logsPage - 1}`} className="apager-btn" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, opacity: logsPage === 1 ? 0.35 : 1, pointerEvents: logsPage === 1 ? 'none' : 'auto' }}>
                    <ChevronLeft size={14} />
                  </a>
                  <a href={`/admin/jobs/${job.id}?tab=logs&logsPage=${logsPage + 1}`} className="apager-btn" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, opacity: logsPage === totalLogsPages ? 0.35 : 1, pointerEvents: logsPage === totalLogsPages ? 'none' : 'auto' }}>
                    <ChevronRight size={14} />
                  </a>
                  <a href={`/admin/jobs/${job.id}?tab=logs&logsPage=${totalLogsPages}`} className="apager-btn" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, opacity: logsPage === totalLogsPages ? 0.35 : 1, pointerEvents: logsPage === totalLogsPages ? 'none' : 'auto' }}>
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
              <StatusPill status={simpleJobStatus(job)} />
              {job.onMyWayAt && !job.clockInTime && (
                <span
                  title="Cleaner tapped On the way and has not clocked in yet"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    fontSize: 12, fontWeight: 600, padding: '4px 10px',
                    borderRadius: 999, background: '#e0f2fe', color: '#075985',
                  }}
                >
                  <Navigation size={12} />
                  On the way · since {fmtTime(job.onMyWayAt)}
                </span>
              )}
              {gpsEnabled &&
                job.onMyWayAt &&
                !job.clockInTime &&
                job.onMyWayLat != null &&
                job.onMyWayLng != null && (
                  <div style={{ flexBasis: '100%', marginTop: 4 }}>
                    <LiveLocationMap
                      jobId={job.id}
                      initial={{
                        lat: job.onMyWayLat,
                        lng: job.onMyWayLng,
                        at: job.onMyWayLocationAt ?? job.onMyWayAt,
                      }}
                    />
                  </div>
                )}
              <TypePill type={job.jobType} />
              {job.isCashJob && <CashJobPill />}
              {job.usesFixedPrice && <FixedPricePill />}
              {isAdmin && (
                <label
                  title="Calendar priority label shown in the top-left of this booking"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--primary-60)' }}
                >
                  <span>Calendar label:</span>
                  <select
                    value={priorityChoice}
                    disabled={savingPriority}
                    onChange={(e) => handleChangePriority(e.target.value)}
                    style={{
                      fontFamily: 'inherit',
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--ink)',
                      background: 'var(--primary-5)',
                      border: '1px solid var(--primary-10)',
                      borderRadius: 8,
                      padding: '3px 8px',
                      cursor: savingPriority ? 'wait' : 'pointer',
                    }}
                  >
                    <option value="AUTO">Auto (by service type)</option>
                    <option value="ROUTINE">Routine (R)</option>
                    <option value="IMPORTANT">Important (I)</option>
                    <option value="NONE">No label</option>
                  </select>
                </label>
              )}
              <span style={{ fontSize: 11.5, color: 'var(--primary-50)', fontFamily: 'monospace' }}>{job.id}</span>
            </div>
            {(job.location || job.description) && (
              <p className="jdetail-desc">
                {job.location}
                {job.description ? <> · <span style={{ color: 'var(--ink-soft)' }}>{
                  // Legacy imports stored "RESIDENTIAL cleaning" / "MOVE_IN_OUT cleaning" —
                  // prettify the enum token ("Deep Cleaning" already says cleaning).
                  job.description.replace(/^([A-Z][A-Z_]+) cleaning$/, (_, t) => {
                    const label = jobTypeLabel(t);
                    return /clean/i.test(label) ? label : `${label} cleaning`;
                  })
                }</span></> : null}
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
                onClick={() => router.push(`/admin/jobs/new?duplicate=${job.id}`)}
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

        {/* After-photos policy (item 21: allowed by default, per-job opt-out).
            No banner in the default allowed state — only a quiet disable
            control; a banner appears only when photos are explicitly OFF. */}
        {(() => {
          const allowed = photosEnabled || afterPhotoOverrideAt !== null;
          if (allowed) {
            if (!isAdmin) return null;
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--primary-60)' }}>
                <Camera size={14} style={{ flex: '0 0 auto' }} />
                <span>After-photos enabled for this job.</span>
                <button
                  type="button"
                  onClick={handleToggleAfterPhotos}
                  disabled={isTogglingPhotoOverride}
                  style={{
                    fontSize: 12, padding: '2px 8px', borderRadius: 8,
                    border: '1px solid var(--primary-20)', background: 'transparent',
                    color: 'var(--primary-60)', cursor: 'pointer',
                  }}>
                  {isTogglingPhotoOverride ? 'Saving…' : 'Disable'}
                </button>
              </div>
            );
          }
          return (
            <div
              className="banner"
              style={{ background: '#fffbeb', borderColor: '#fcd34d', color: '#92400e' }}>
              <Camera size={16} style={{ flex: '0 0 auto', color: '#f59e0b' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>After-photos are turned off for this job.</strong>{' '}
                Cleaners can&apos;t upload after-photos until they&apos;re re-enabled.
              </div>
              {isAdmin && (
                <button
                  type="button"
                  onClick={handleToggleAfterPhotos}
                  disabled={isTogglingPhotoOverride}
                  style={{
                    fontSize: 12, padding: '4px 10px', borderRadius: 8, border: 'none',
                    cursor: 'pointer', flexShrink: 0,
                    background: '#10b981', color: '#fff',
                  }}>
                  {isTogglingPhotoOverride ? 'Saving…' : 'Enable after-photos'}
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
                        background: avatarColor(u.name),
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

            {assignConflicts.length > 0 && (
              <div style={{ margin: "0 28px 12px", fontSize: 13, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "8px 12px" }}>
                <strong>Assigned — availability conflict:</strong>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {assignConflicts.map((m, i) => <li key={i}>{m}</li>)}
                </ul>
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
          title="Archive Job"
          message="It moves to Jobs → Archived, out of every list, count and report. You can restore it from there, or delete it permanently once archived."
        />
      )}

      {/* Set rating (admin manual star rating, item 13) */}
      <Modal
        isOpen={ratingTarget !== null}
        onClose={() => !ratingSubmitting && setRatingTarget(null)}
        title={ratingTarget ? `Rate ${ratingTarget.name}` : "Set rating"}>
        <div className="space-y-4">
          <p className="text-sm text-[#008C9C]/70">
            Set a manual star rating for this cleaner on this job. It counts
            toward their running average and pay tier.
          </p>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
            {[1, 2, 3, 4, 5].map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setRatingStars(s)}
                disabled={ratingSubmitting}
                aria-label={`${s} star${s === 1 ? '' : 's'}`}
                style={{ background: 'transparent', border: 0, cursor: 'pointer', padding: 4 }}>
                <Star
                  size={28}
                  style={{
                    color: s <= ratingStars ? '#f59e0b' : '#e5e7eb',
                    fill: s <= ratingStars ? '#f59e0b' : '#e5e7eb',
                  }}
                />
              </button>
            ))}
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#008C9C]/70 mb-1">Note (optional)</label>
            <textarea
              className="w-full rounded-xl border border-[#008C9C]/15 bg-[#008C9C]/5 px-3 py-2 text-sm outline-none focus:bg-white focus:border-[#008C9C]/40"
              rows={2}
              value={ratingNote}
              onChange={(e) => setRatingNote(e.target.value)}
              placeholder="e.g. Great feedback from the client, late arrival…"
              disabled={ratingSubmitting}
            />
          </div>
          {ratingError && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {ratingError}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="cancel" border={false} onClick={() => setRatingTarget(null)} disabled={ratingSubmitting}>
              Cancel
            </Button>
            <Button variant="action" border={false} onClick={handleSubmitRating} disabled={ratingSubmitting}>
              {ratingSubmitting ? "Saving…" : `Save ${ratingStars}-star rating`}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Cancel cleaning */}
      <Modal isOpen={showCancelModal} onClose={() => !isCancelling && setShowCancelModal(false)} title="Cancel cleaning?">
        <div className="space-y-4">
          <p className="text-sm text-[#008C9C]/70">
            This sets the job status to <strong>Cancelled</strong> and logs the change. The customer&apos;s saved card is not charged.
          </p>
          <div>
            <label className="block text-xs font-semibold text-[#008C9C]/70 mb-1">Reason (optional)</label>
            <textarea
              className="w-full rounded-xl border border-[#008C9C]/15 bg-[#008C9C]/5 px-3 py-2 text-sm outline-none focus:bg-white focus:border-[#008C9C]/40"
              rows={2}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="e.g. Customer requested, weather, scheduling conflict…"
            />
          </div>
          {depositRemaining > 0 && (
            <label className="flex items-center gap-2 text-sm text-[#008C9C] cursor-pointer">
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
          <p className="text-sm text-[#008C9C]/70">
            {job.stripePaymentIntentId
              ? `Refundable: $${refundCap.toFixed(2)} (already refunded $${refundedSoFar.toFixed(2)}).`
              : depositRemaining > 0
              ? `Deposit refundable: $${depositRemaining.toFixed(2)} of $20.00.`
              : "Nothing left to refund."}
          </p>
          <div>
            <label className="block text-xs font-semibold text-[#008C9C]/70 mb-1">Amount ($)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              max={refundCap}
              value={refundAmount}
              onChange={(e) => setRefundAmount(e.target.value)}
              className="w-full rounded-xl border border-[#008C9C]/15 bg-[#008C9C]/5 px-3 py-2 text-sm outline-none focus:bg-white focus:border-[#008C9C]/40"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#008C9C]/70 mb-1">Reason (optional)</label>
            <textarea
              className="w-full rounded-xl border border-[#008C9C]/15 bg-[#008C9C]/5 px-3 py-2 text-sm outline-none focus:bg-white focus:border-[#008C9C]/40"
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
          <p className="text-sm text-[#008C9C]/70">
            This will charge the client&apos;s saved card via Stripe. The customer will receive a receipt email automatically.
          </p>
          <div className="rounded-xl bg-[#008C9C]/5 px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-[#008C9C]/70">Amount</span>
            <span className="text-lg font-semibold text-[#008C9C]">${amount.toFixed(2)}</span>
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
