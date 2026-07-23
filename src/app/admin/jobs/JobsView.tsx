"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Search, Filter, Briefcase, CheckCircle2, DollarSign,
  AlertTriangle, Loader, Plus, CalendarClock, Wallet,
  Trash2, XCircle, UserPlus, Tag, RotateCcw,
} from "lucide-react";
import Button from "@/components/ui/Button";
import PremiumSelect from "@/components/ui/PremiumSelect";
import DatePicker from "@/components/ui/DatePicker";
import { useRowSelection } from "@/components/common/useRowSelection";
import BulkActionBar, { BulkAction } from "@/components/common/BulkActionBar";
import { bulkSoftDelete, bulkRestore } from "@/lib/bulk/actions";
import { permanentlyDeleteJobs } from "../actions/permanentlyDeleteJobs";
import { bulkCancelJobs } from "../actions/bulkCancelJobs";
import { bulkSetJobStatus } from "../actions/bulkSetJobStatus";
import { bulkAssignCleaner } from "../actions/bulkAssignCleaner";
import { togglePaymentReceived, toggleInvoiceSent } from "../actions/toggleJobPaymentStatus";
import { generateInvoiceFromJob } from "../actions/generateInvoiceFromJob";
import { normalizeJobType, jobTypeLabel } from "@/lib/calendar-labels";
import { fmtDate, fmtTime } from "@/lib/time";
import { avatarColor, initials } from "@/lib/avatar";
import {
  isRevenueJob,
  jobRevenue,
  isScheduledValueJob,
  jobScheduledValue,
  simpleJobStatus,
} from "@/lib/metrics-shared";

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
  isCashJob?: boolean;
  usesFixedPrice?: boolean;
  discountAmount?: number | null;
  refundedAmount?: number | null;
  deletedAt?: string | null;
  bedCount?: number | null;
  bathCount?: number | null;
  payRateMultiplier?: number | null;
  profit?: number;
  profitPct?: number;
  timeSpentMs?: number;
  cleaners: Array<{ id: string; name: string }>;
  addOns?: Array<{ id: string; name: string; price: number }>;
}

interface ClientLite { id: string; name: string; }
interface UserLite   { id: string; name: string; email: string; }

interface JobsViewProps {
  jobs: Job[];
  isLoading: boolean;
  searchTerm: string;
  statusFilter: string;
  paymentFilter: string;
  rowsPerPage: number;
  page: number;
  onSearchTermChange: (term: string) => void;
  onStatusFilterChange: (filter: string) => void;
  onPaymentFilterChange: (filter: string) => void;
  onRowsPerPageChange: (rowsPerPage: number) => void;
  onPageChange: (page: number) => void;
  updateURLParams: (updates: Record<string, string | number>) => void;
  onCreateJob: () => void;
  onEditJob: (job: Job) => void;
  clients?: ClientLite[];
  users?: UserLite[];
  cleaners?: UserLite[];
  archived?: boolean;
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function AvatarStack({ cleaners, max = 3 }: { cleaners: Array<{ id: string; name: string }>; max?: number }) {
  if (!cleaners.length) return <span style={{ color: 'var(--primary-40)', fontSize: 13 }}>—</span>;
  const shown = cleaners.slice(0, max);
  const extra = cleaners.length - max;
  return (
    <div className="avstack" title={cleaners.map(c => c.name).join(', ')}>
      {shown.map(c => (
        <div key={c.id} className="avatar" style={{ background: avatarColor(c.name) }}>
          {initials(c.name)}
        </div>
      ))}
      {extra > 0 && (
        <div className="avatar" style={{ background: 'var(--primary-40)' }}>+{extra}</div>
      )}
    </div>
  );
}

// Renders the DERIVED operational status (simpleJobStatus), not the raw enum —
// spec's three main statuses: Scheduled (future), Completed (date passed,
// unpaid), Paid (payment received). "Paid" is distinct green-on-emerald so it
// reads differently from Completed at a glance.
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

// Colors keyed off the NORMALIZED category so "MOVE_IN_OUT" (imported) and
// "Move-in / Move-out" (manual) render the same pill; jobTypeLabel() keeps raw
// enum text out of the UI.
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
  const c = (category && TYPE_PILL_COLORS[category]) || { bg: '#f3f4f6', color: '#374151' };
  return <span className="pill" style={{ background: c.bg, color: c.color }}>{jobTypeLabel(type)}</span>;
}

function CashPill() {
  return (
    <span className="pill" style={{ background: '#fef9c3', color: '#854d0e' }} title="Cash job — no Stripe charge, tax exempt">
      Cash
    </span>
  );
}

function FixedPricePill() {
  return (
    <span className="pill" style={{ background: '#ede9fe', color: '#5b21b6' }} title="Client-specific fixed price applied to this booking">
      Fixed
    </span>
  );
}

// Spec item 9: the $ icon marks payment received (job → Paid) and the mail
// icon marks the invoice sent (generating the invoice record on first use),
// straight from the table row. Optimistic — the row updates immediately and
// reverts if the server action fails.
function PayIcons({
  paymentReceived,
  invoiceSent,
  busy,
  onTogglePaid,
  onToggleInvoice,
}: {
  paymentReceived: boolean;
  invoiceSent: boolean;
  busy?: boolean;
  onTogglePaid: () => void;
  onToggleInvoice: () => void;
}) {
  return (
    <div className="pay-icons">
      <button
        type="button"
        className={`pay-icon pay-icon-btn ${paymentReceived ? 'paid' : 'unpaid'}`}
        title={paymentReceived ? 'Paid — click to mark as not received' : 'Mark payment received'}
        disabled={busy}
        onClick={(e) => { e.stopPropagation(); onTogglePaid(); }}
      >$</button>
      <button
        type="button"
        className={`pay-icon pay-icon-btn ${invoiceSent ? 'sent' : 'unsent'}`}
        title={invoiceSent ? 'Invoice sent — click to un-mark' : 'Mark invoice sent (creates the invoice)'}
        disabled={busy}
        onClick={(e) => { e.stopPropagation(); onToggleInvoice(); }}
      >✉</button>
    </div>
  );
}

function AStatCard({ icon: Icon, label, value, hint }: { icon: any; label: string; value: string | number; hint?: string }) {
  return (
    <div className="astat">
      <div className="astat-head">
        <span>{label}</span>
        <div className="astat-icon"><Icon size={15} /></div>
      </div>
      <div className="astat-value">{value}</div>
      {hint && <div className="astat-delta">{hint}</div>}
    </div>
  );
}

// Always render off `startTime` (a real instant) in the BUSINESS timezone —
// browser-local formatting showed a 1 PM Toronto job as 6:30 PM to anyone
// browsing from another timezone, and the legacy midnight-UTC `jobDate` field
// can disagree with startTime by a day.
function formatDate(_dateStr: string | null, fallback: string): string {
  return fmtDate(fallback, { month: 'short', day: 'numeric' });
}

function formatTime(iso: string): string {
  return fmtTime(iso);
}

function formatTimeSpent(ms: number | undefined): string {
  if (!ms || ms <= 0) return '—';
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function payTypeLabel(type: string | null | undefined): string {
  const map: Record<string, string> = {
    CASH: 'Cash', CHEQUE: 'Cheque', E_TRANSFER: 'E-Transfer',
    CREDIT_CARD: 'Card', OTHER: 'Other',
  };
  return type ? (map[type] || type.replace(/_/g, ' ')) : '—';
}

function profitClass(pct: number | undefined): string {
  if (pct === undefined) return '';
  if (pct >= 50) return 'good';
  if (pct >= 25) return 'warn';
  return 'bad';
}

const TABS = [
  { id: 'all',        label: 'All' },
  { id: 'upcoming',   label: 'Upcoming' },
  { id: 'completed',  label: 'Completed' },
  { id: 'overdue',    label: 'Overdue' },
  { id: 'cancelled',  label: 'Cancelled' },
  { id: 'discounted', label: 'Discounted' },
  { id: 'free',       label: 'Free' },
] as const;
type TabId = (typeof TABS)[number]['id'];

// Single source of truth for tab membership, kept in lockstep with
// src/lib/metrics.ts `jobStatusWhere` so a tab's COUNT and its filtered LIST
// always use the exact same predicate:
//   upcoming  = future start AND not completed/cancelled
//   completed = COMPLETED | PAID
//   overdue   = COMPLETED AND unpaid
//   cancelled = CANCELLED
//   free      = price null / 0
// (`discounted` is a jobs-list convenience bucket, not a metrics bucket.)
function jobMatchesTab(
  tab: TabId,
  job: { status: string; startTime: string; paymentReceived: boolean; price: number | null; discountAmount?: number | null },
  now: number
): boolean {
  const jobTime = new Date(job.startTime).getTime();
  switch (tab) {
    case 'upcoming':
      return jobTime >= now && ['CREATED', 'SCHEDULED', 'IN_PROGRESS'].includes(job.status);
    case 'completed':
      return ['COMPLETED', 'PAID'].includes(job.status);
    case 'overdue':
      return job.status === 'COMPLETED' && !job.paymentReceived;
    case 'cancelled':
      return job.status === 'CANCELLED';
    case 'discounted':
      return (job.discountAmount || 0) > 0;
    case 'free':
      return !job.price || job.price === 0;
    default:
      return true;
  }
}

// ── Paginator ─────────────────────────────────────────────────────────────────

function APager({
  page, totalPages, totalJobs, rowsPerPage, startIndex, pageNumbers,
  onPageChange,
}: {
  page: number; totalPages: number; totalJobs: number; rowsPerPage: number;
  startIndex: number; pageNumbers: number[]; onPageChange: (p: number) => void;
}) {
  const end = Math.min(startIndex + rowsPerPage, totalJobs);
  if (totalJobs === 0) return null;
  return (
    <div className="apager">
      <span>Showing {startIndex + 1}–{end} of {totalJobs}</span>
      <div className="apager-controls">
        <button className="apager-btn" onClick={() => onPageChange(1)} disabled={page === 1}>«</button>
        <button className="apager-btn" onClick={() => onPageChange(page - 1)} disabled={page === 1}>‹</button>
        {pageNumbers.map(n => (
          <button key={n} className={`apager-btn ${page === n ? 'active' : ''}`} onClick={() => onPageChange(n)}>{n}</button>
        ))}
        <button className="apager-btn" onClick={() => onPageChange(page + 1)} disabled={page === totalPages}>›</button>
        <button className="apager-btn" onClick={() => onPageChange(totalPages)} disabled={page === totalPages}>»</button>
      </div>
    </div>
  );
}

// ── Inline SVG icons ───────────────────────────────────────────────────────────

const EditSvg = ({ size = 14 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

const ChevronRightSvg = ({ size = 14 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

// ── Main component ─────────────────────────────────────────────────────────────

export default function JobsView({
  jobs,
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
  cleaners = [],
  archived = false,
  startDate = '',
  endDate = '',
  jobTypeFilter = 'all',
  clientFilter = 'all',
  employeeFilter = 'all',
  paymentTypeFilter = 'all',
  onStartDateChange,
  onEndDateChange,
  onJobTypeFilterChange,
  onClientFilterChange,
  onEmployeeFilterChange,
  onPaymentTypeFilterChange,
}: JobsViewProps) {
  const [tab, setTab] = useState<TabId>('all');
  const [showFilters, setShowFilters] = useState(false);

  // Optimistic per-row overrides for the $ / ✉ table actions — merged over the
  // server-provided list so the row, pills, tabs, and stat cards all move the
  // instant the icon is clicked, then reconciled by router.refresh().
  const [rowOverrides, setRowOverrides] = useState<
    Record<string, Partial<Pick<Job, 'paymentReceived' | 'invoiceSent' | 'status'>>>
  >({});
  const [payBusyId, setPayBusyId] = useState<string | null>(null);
  const effectiveJobs = useMemo(
    () =>
      Object.keys(rowOverrides).length === 0
        ? jobs
        : jobs.map(j => (rowOverrides[j.id] ? { ...j, ...rowOverrides[j.id] } : j)),
    [jobs, rowOverrides]
  );

  // Tab-level filter (client-side). Upcoming is sorted soonest-first (past jobs
  // already excluded by the predicate); every other tab keeps the server's
  // most-recent-first order.
  const tabJobs = useMemo(() => {
    const now = Date.now();
    const list = effectiveJobs.filter(j => jobMatchesTab(tab, j, now));
    if (tab === 'upcoming') {
      list.sort(
        (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
      );
    }
    return list;
  }, [tab, effectiveJobs]);

  const tabCounts = useMemo(() => {
    const now = Date.now();
    return {
      all:        effectiveJobs.length,
      upcoming:   effectiveJobs.filter(j => jobMatchesTab('upcoming', j, now)).length,
      completed:  effectiveJobs.filter(j => jobMatchesTab('completed', j, now)).length,
      overdue:    effectiveJobs.filter(j => jobMatchesTab('overdue', j, now)).length,
      cancelled:  effectiveJobs.filter(j => jobMatchesTab('cancelled', j, now)).length,
      discounted: effectiveJobs.filter(j => jobMatchesTab('discounted', j, now)).length,
      free:       effectiveJobs.filter(j => jobMatchesTab('free', j, now)).length,
    } as Record<TabId, number>;
  }, [effectiveJobs]);

  // Additional filters stacked on top of tab filter
  const filteredJobs = useMemo(() => {
    return tabJobs.filter(job => {
      const q = searchTerm.toLowerCase();
      const matchesSearch = !searchTerm ||
        job.clientName.toLowerCase().includes(q) ||
        (job.location && job.location.toLowerCase().includes(q));
      // Filter on the DERIVED status so "Paid" (paymentReceived boolean or
      // PAID enum) and "Completed" (incl. past-dated scheduled jobs the sweep
      // hasn't flipped yet) match what the pill in the row says.
      const matchesStatus = statusFilter === 'all' || simpleJobStatus(job) === statusFilter;
      const matchesPayment = (() => {
        if (paymentFilter === 'all') return true;
        if (paymentFilter === 'paid') return job.paymentReceived;
        if (paymentFilter === 'pending') return !job.paymentReceived && job.status === 'COMPLETED';
        return true;
      })();
      // Match on normalized category so imported + manual jobType vocabularies
      // both hit the same filter option.
      const matchesType    = jobTypeFilter === 'all' ||
        normalizeJobType(job.jobType) === (normalizeJobType(jobTypeFilter) ?? jobTypeFilter);
      const matchesClient  = clientFilter === 'all' || job.clientId === clientFilter;
      const matchesEmp     = employeeFilter === 'all' || job.cleaners.some(c => c.id === employeeFilter);
      const matchesPayType = paymentTypeFilter === 'all' || job.paymentType === paymentTypeFilter;
      const d = (job.jobDate || job.startTime).slice(0, 10);
      const matchesFrom = !startDate || d >= startDate;
      const matchesTo   = !endDate   || d <= endDate;
      return matchesSearch && matchesStatus && matchesPayment && matchesType && matchesClient && matchesEmp && matchesPayType && matchesFrom && matchesTo;
    });
  }, [tabJobs, searchTerm, statusFilter, paymentFilter, jobTypeFilter, clientFilter, employeeFilter, paymentTypeFilter, startDate, endDate]);

  // Stat cards are derived from the SAME list the table renders, so every
  // filter (tab, date range, client, cleaner, type, pay type, payment status,
  // search) moves the cards too. Previously these were four server counts over
  // ALL jobs, so the cards sat frozen while the table filtered.
  //
  // Revenue uses the canonical rule from src/lib/metrics-shared (identical to
  // the SQL `revenueWhere` the Dashboard/Analytics use): non-archived AND
  // paymentReceived AND status ∈ {COMPLETED, PAID}, amount = price − discount −
  // refund. "Scheduled value" is explicitly NOT revenue — it's the booked value
  // of live work that hasn't been completed+paid yet, shown so a pipeline of
  // priced-but-unpaid jobs doesn't read as "$0.00 revenue".
  const stats = useMemo(() => {
    let completedJobs = 0;
    let pendingPayment = 0;
    let totalRevenue = 0;
    let scheduledValue = 0;
    for (const j of filteredJobs) {
      if (j.status === 'COMPLETED' || j.status === 'PAID') completedJobs++;
      if (j.status === 'COMPLETED' && !j.paymentReceived) pendingPayment++;
      if (isRevenueJob(j)) totalRevenue += jobRevenue(j);
      else if (isScheduledValueJob(j)) scheduledValue += jobScheduledValue(j);
    }
    return {
      totalJobs: filteredJobs.length,
      completedJobs,
      pendingPayment,
      totalRevenue,
      scheduledValue,
    };
  }, [filteredJobs]);

  const totalJobs  = filteredJobs.length;
  const totalPages = Math.max(1, Math.ceil(totalJobs / rowsPerPage));
  const startIndex = (page - 1) * rowsPerPage;
  const paginatedJobs = filteredJobs.slice(startIndex, startIndex + rowsPerPage);

  // ── Multi-select + bulk actions ────────────────────────────────────────────
  const router = useRouter();

  // Row-level $ / ✉ actions (spec item 9). Optimistic: override the row first,
  // revert on failure, reconcile with a refresh either way.
  async function handleTogglePaid(job: Job) {
    const next = !job.paymentReceived;
    const optimisticStatus = job.status === 'CANCELLED'
      ? job.status
      : next
        ? 'PAID'
        : new Date(job.startTime).getTime() < Date.now() ? 'COMPLETED' : 'SCHEDULED';
    setPayBusyId(job.id);
    setRowOverrides(o => ({
      ...o,
      [job.id]: { ...o[job.id], paymentReceived: next, status: optimisticStatus },
    }));
    try {
      const res = await togglePaymentReceived(job.id);
      if (!res?.success) {
        setRowOverrides(o => ({
          ...o,
          [job.id]: { ...o[job.id], paymentReceived: job.paymentReceived, status: job.status },
        }));
        alert(res?.error || 'Failed to update payment status');
      }
    } finally {
      setPayBusyId(null);
      router.refresh();
    }
  }

  async function handleToggleInvoice(job: Job) {
    const next = !job.invoiceSent;
    setPayBusyId(job.id);
    setRowOverrides(o => ({ ...o, [job.id]: { ...o[job.id], invoiceSent: next } }));
    try {
      // Marking sent generates the invoice record on first use (idempotent);
      // un-marking just clears the flag.
      const res = next
        ? await generateInvoiceFromJob(job.id)
        : await toggleInvoiceSent(job.id);
      if (!res?.success) {
        setRowOverrides(o => ({ ...o, [job.id]: { ...o[job.id], invoiceSent: job.invoiceSent } }));
        alert(('error' in (res ?? {}) && (res as { error?: string }).error) || 'Failed to update invoice status');
      }
    } finally {
      setPayBusyId(null);
      router.refresh();
    }
  }

  const visibleIds = useMemo(() => paginatedJobs.map(j => j.id), [paginatedJobs]);
  const sel = useRowSelection(visibleIds);
  const [showAssign, setShowAssign] = useState(false);
  const [assignCleanerId, setAssignCleanerId] = useState('');
  const [showStatus, setShowStatus] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  async function runAssign() {
    if (!assignCleanerId || sel.count === 0) return;
    setBulkBusy(true);
    try {
      const res = await bulkAssignCleaner(sel.selectedIds, assignCleanerId);
      if (!res.success) { alert(res.error); return; }
      // Availability conflicts never block the assign — surface them so the
      // admin knows they've booked someone outside their hours / on time off.
      if (res.warnings && res.warnings.length > 0) {
        alert(
          `Assigned, but note:\n\n${res.warnings.join('\n')}`
        );
      }
      setShowAssign(false);
      setAssignCleanerId('');
      sel.clear();
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  async function runSetStatus(status: string) {
    if (sel.count === 0) return;
    setBulkBusy(true);
    try {
      const res = await bulkSetJobStatus(sel.selectedIds, status);
      if (!res.success) { alert(res.error); return; }
      setShowStatus(false);
      sel.clear();
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  const bulkActions: BulkAction[] = archived
    ? [
        {
          key: 'restore',
          label: 'Restore',
          icon: <RotateCcw size={14} />,
          onRun: async () => {
            await bulkRestore('job', sel.selectedIds);
            sel.clear();
            router.refresh();
          },
        },
        {
          key: 'permanent-delete',
          label: 'Delete permanently',
          icon: <Trash2 size={14} />,
          variant: 'danger',
          confirm: `Permanently delete ${sel.count} archived job${sel.count === 1 ? '' : 's'}? This cannot be undone — the job is removed from Jobs, Calendar, Archived, cleaner views and payroll. Use this only for test jobs, duplicate imports, or incorrect imports.`,
          onRun: async () => {
            const res = await permanentlyDeleteJobs(sel.selectedIds);
            if ('error' in res && res.error) { alert(res.error); return; }
            sel.clear();
            router.refresh();
          },
        },
      ]
    : [
        {
          key: 'assign',
          label: 'Assign cleaner',
          icon: <UserPlus size={14} />,
          onRun: () => { setShowStatus(false); setShowAssign(true); },
        },
        {
          key: 'status',
          label: 'Change status',
          icon: <Tag size={14} />,
          onRun: () => { setShowAssign(false); setShowStatus(true); },
        },
        {
          key: 'cancel',
          label: 'Cancel',
          icon: <XCircle size={14} />,
          onRun: async () => {
            await bulkCancelJobs(sel.selectedIds);
            sel.clear();
            router.refresh();
          },
        },
        {
          key: 'delete',
          label: 'Delete',
          icon: <Trash2 size={14} />,
          variant: 'danger',
          confirm: `Delete ${sel.count} selected job${sel.count === 1 ? '' : 's'}? They can be restored from Archived.`,
          onRun: async () => {
            await bulkSoftDelete('job', sel.selectedIds);
            sel.clear();
            router.refresh();
          },
        },
      ];

  const pageNumbers = useMemo(() => {
    const count = Math.min(5, totalPages);
    const pages: number[] = [];
    if (totalPages <= 5) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else if (page <= 3) {
      for (let i = 1; i <= count; i++) pages.push(i);
    } else if (page >= totalPages - 2) {
      for (let i = totalPages - 4; i <= totalPages; i++) pages.push(i);
    } else {
      for (let i = page - 2; i <= page + 2; i++) pages.push(i);
    }
    return pages;
  }, [page, totalPages]);

  const goToPage = (newPage: number) => {
    onPageChange(newPage);
    updateURLParams({ page: newPage });
  };

  const hasActiveFilters =
    !!startDate || !!endDate || jobTypeFilter !== 'all' || clientFilter !== 'all' ||
    employeeFilter !== 'all' || paymentTypeFilter !== 'all' || statusFilter !== 'all' || paymentFilter !== 'all';

  const activeFilterCount = [
    startDate, endDate, jobTypeFilter !== 'all', clientFilter !== 'all',
    employeeFilter !== 'all', paymentTypeFilter !== 'all', statusFilter !== 'all', paymentFilter !== 'all',
  ].filter(Boolean).length;

  const clearAllFilters = () => {
    onStartDateChange?.('');
    onEndDateChange?.('');
    onJobTypeFilterChange?.('all');
    onClientFilterChange?.('all');
    onEmployeeFilterChange?.('all');
    onPaymentTypeFilterChange?.('all');
    onStatusFilterChange('all');
    onPaymentFilterChange('all');
    onPageChange(1);
    updateURLParams({ status: 'all', payment: 'all', page: 1 });
  };

  return (
    <div className="admin-font">
      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 32, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p className="admin-eyebrow">Operations</p>
          <h1 className="admin-page-title">
            Jobs{' '}
            <span style={{ color: 'var(--primary-40)', fontWeight: 300 }}>· {stats.totalJobs}</span>
          </h1>
        </div>
        <Button variant="primary" border={false} onClick={onCreateJob} className="rounded-xl px-5 py-2.5">
          <Plus className="w-4 h-4 mr-2" /> New job
        </Button>
      </header>

      {/* Stats — all five reflect the CURRENT filters (see the `stats` memo). */}
      <div className="astat-grid" id="jstats" style={{ marginBottom: 28 }}>
        <AStatCard
          icon={CalendarClock}
          label="Total jobs"
          value={stats.totalJobs}
          hint={hasActiveFilters || searchTerm || tab !== 'all' ? 'Matching filters' : undefined}
        />
        <AStatCard icon={CheckCircle2} label="Completed" value={stats.completedJobs} />
        <AStatCard
          icon={DollarSign}
          label="Total revenue"
          value={`$${stats.totalRevenue.toFixed(2)}`}
          hint="Completed & paid only"
        />
        <AStatCard
          icon={Wallet}
          label="Scheduled value"
          value={`$${stats.scheduledValue.toFixed(2)}`}
          hint="Booked · not yet earned"
        />
        <AStatCard
          icon={AlertTriangle}
          label="Pending payment"
          value={stats.pendingPayment}
          hint={stats.pendingPayment > 0 ? `${stats.pendingPayment} job${stats.pendingPayment === 1 ? '' : 's'}` : undefined}
        />
      </div>
      {/* .astat-grid is 4-up by default; this page has 5 cards. Scoped so the
          shared 2-up mobile rule still applies. */}
      <style>{`
        @media (min-width: 901px) { #jstats { grid-template-columns: repeat(5, minmax(0, 1fr)); } }
      `}</style>

      {/* Segmented tabs */}
      <div style={{ marginBottom: 18 }}>
        <div className="atabs">
          {TABS.map(t => (
            <button
              key={t.id}
              type="button"
              className={`atab ${tab === t.id ? 'active' : ''}`}
              onClick={() => { setTab(t.id); onPageChange(1); }}
            >
              {t.label}
              <span className="atab-count">{tabCounts[t.id]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <div className="atoolbar" style={{ marginBottom: showFilters ? 16 : 18 }}>
        <div className="atoolbar-search">
          <Search className="atoolbar-search-icon" size={16} />
          <input
            className="input"
            type="search"
            placeholder="Search by client, address…"
            value={searchTerm}
            onChange={(e) => {
              // Search is filtered CLIENT-side (see filteredJobs); the server
              // query ignores the term. Writing it to the URL per keystroke
              // triggered an RSC re-render that remounted this input and dropped
              // focus after every character. Keep it as local state only.
              onSearchTermChange(e.target.value);
              onPageChange(1);
            }}
          />
        </div>
        <button
          type="button"
          className={`afilter-toggle ${showFilters ? 'open' : ''}`}
          onClick={() => setShowFilters(v => !v)}
        >
          <Filter size={14} />
          Filters
          {activeFilterCount > 0 && <span className="afilter-badge">{activeFilterCount}</span>}
        </button>
        <div style={{ flex: 1 }} />
        <PremiumSelect
          value={String(rowsPerPage)}
          onChange={(v) => { onRowsPerPageChange(parseInt(v, 10)); onPageChange(1); updateURLParams({ rowsPerPage: parseInt(v, 10), page: 1 }); }}
          options={[10, 25, 50, 100].map(n => ({ value: String(n), label: `${n} rows` }))}
          size="sm"
          style={{ width: 110 }}
        />
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="afilter-panel" style={{ marginBottom: 20 }}>
          <div className="field">
            <label className="label">From</label>
            <DatePicker value={startDate} onChange={(v) => onStartDateChange?.(v)} size="sm" />
          </div>
          <div className="field">
            <label className="label">To</label>
            <DatePicker value={endDate} onChange={(v) => onEndDateChange?.(v)} size="sm" />
          </div>
          <div className="field">
            <label className="label">Job type</label>
            <PremiumSelect
              value={jobTypeFilter}
              onChange={(v) => onJobTypeFilterChange?.(v)}
              size="sm"
              options={[
                { value: "all", label: "All types" },
                { value: "RESIDENTIAL", label: "Residential" },
                { value: "DEEP", label: "Deep Cleaning" },
                { value: "MOVE_IN", label: "Move-in" },
                { value: "MOVE_OUT", label: "Move-out" },
                { value: "MOVE_IN_OUT", label: "Move-in / Move-out" },
                { value: "AIRBNB", label: "Airbnb" },
                { value: "COMMERCIAL", label: "Commercial" },
                { value: "POST_CONSTRUCTION", label: "Post-Construction" },
                { value: "FOLLOW_UP", label: "Follow-up" },
              ]}
            />
          </div>
          <div className="field">
            <label className="label">Job status</label>
            <PremiumSelect
              value={statusFilter}
              onChange={(v) => { onStatusFilterChange(v); onPageChange(1); updateURLParams({ status: v, page: 1 }); }}
              size="sm"
              options={[
                { value: "all", label: "Any status" },
                { value: "SCHEDULED", label: "Scheduled" },
                { value: "IN_PROGRESS", label: "In Progress" },
                { value: "COMPLETED", label: "Completed" },
                { value: "PAID", label: "Paid" },
                { value: "CANCELLED", label: "Cancelled" },
              ]}
            />
          </div>
          <div className="field">
            <label className="label">Client</label>
            <PremiumSelect
              value={clientFilter}
              onChange={(v) => onClientFilterChange?.(v)}
              size="sm"
              searchable={clients.length > 8}
              options={[{ value: "all", label: "All clients" }, ...clients.map(c => ({ value: c.id, label: c.name }))]}
            />
          </div>
          <div className="field">
            <label className="label">Employee</label>
            <PremiumSelect
              value={employeeFilter}
              onChange={(v) => onEmployeeFilterChange?.(v)}
              size="sm"
              options={[{ value: "all", label: "Any employee" }, ...users.map(u => ({ value: u.id, label: u.name }))]}
            />
          </div>
          <div className="field">
            <label className="label">Pay type</label>
            <PremiumSelect
              value={paymentTypeFilter}
              onChange={(v) => onPaymentTypeFilterChange?.(v)}
              size="sm"
              options={[
                { value: "all", label: "Any pay type" },
                { value: "CASH", label: "Cash" },
                { value: "CHEQUE", label: "Cheque" },
                { value: "E_TRANSFER", label: "E-Transfer" },
                { value: "CREDIT_CARD", label: "Credit Card" },
                { value: "OTHER", label: "Other" },
              ]}
            />
          </div>
          <div className="field">
            <label className="label">Payment status</label>
            <PremiumSelect
              value={paymentFilter}
              onChange={(v) => { onPaymentFilterChange(v); onPageChange(1); updateURLParams({ payment: v, page: 1 }); }}
              size="sm"
              options={[
                { value: "all", label: "Any payment" },
                { value: "paid", label: "Paid" },
                { value: "pending", label: "Unpaid" },
              ]}
            />
          </div>
          <div className="afilter-panel-actions">
            <button
              type="button"
              onClick={clearAllFilters}
              style={{ background: 'none', border: 0, cursor: 'pointer', fontSize: 13, color: 'var(--primary-60)', fontFamily: 'inherit' }}
            >
              Reset filters
            </button>
            <Button variant="primary" border={false} size="sm" onClick={() => setShowFilters(false)} className="rounded-lg px-4">Done</Button>
          </div>
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="atable-wrap" style={{ padding: '60px 40px', textAlign: 'center' }}>
          <Loader className="w-4 h-4 animate-spin mx-auto mb-2" style={{ color: 'var(--primary)' }} />
          <span style={{ fontSize: 14, color: 'var(--primary-60)' }}>Loading jobs…</span>
        </div>
      ) : totalJobs === 0 ? (
        <div className="atable-wrap" style={{ padding: '80px 40px', textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--primary-5)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <Briefcase size={24} style={{ color: 'var(--primary-40)' }} />
          </div>
          <p style={{ fontSize: 14, color: 'var(--primary-60)', marginBottom: 8 }}>No jobs match these filters.</p>
          {hasActiveFilters && (
            <button type="button" onClick={clearAllFilters} style={{ background: 'none', border: 0, cursor: 'pointer', color: 'var(--primary)', fontSize: 13, fontFamily: 'inherit' }}>
              Reset filters
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="atable-wrap" id="jlist-desktop">
            <div className="atable-scroll">
              <table className="atable">
                <thead>
                  <tr>
                    <th className="col-select" style={{ width: 40, textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={sel.allSelected}
                        ref={(el) => { if (el) el.indeterminate = sel.someSelected; }}
                        onChange={sel.toggleAll}
                        style={{ cursor: 'pointer' }}
                      />
                    </th>
                    <th>Date</th>
                    <th>Client</th>
                    <th>Type</th>
                    <th>Cleaners</th>
                    <th className="num">Time</th>
                    <th className="num">Price</th>
                    <th className="num">Discount</th>
                    <th className="num">Profit</th>
                    <th>Pay type</th>
                    <th>Status</th>
                    <th>Payment</th>
                    <th className="col-actions" />
                  </tr>
                </thead>
                <tbody>
                  {paginatedJobs.map(job => (
                    <tr key={job.id} onClick={() => { window.location.href = `/admin/jobs/${job.id}`; }}>
                      <td className="col-select" style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label="Select row"
                          checked={sel.isSelected(job.id)}
                          onChange={() => sel.toggle(job.id)}
                          onClick={(e) => e.stopPropagation()}
                          style={{ cursor: 'pointer' }}
                        />
                      </td>
                      <td className="col-date">
                        <div className="date-line">{formatDate(job.jobDate, job.startTime)}</div>
                        <div className="time-line">{formatTime(job.startTime)}</div>
                      </td>
                      <td>
                        <div className="col-client">{job.clientName}</div>
                        {job.location && <div className="col-client-sub">{job.location.split(',')[0]}</div>}
                      </td>
                      <td><TypePill type={job.jobType} /></td>
                      <td><AvatarStack cleaners={job.cleaners} /></td>
                      <td className="num">{formatTimeSpent(job.timeSpentMs)}</td>
                      <td className="num">
                        {job.price !== null ? `$${job.price.toFixed(2)}` : '—'}
                        {job.usesFixedPrice && <span style={{ marginLeft: 6 }}><FixedPricePill /></span>}
                      </td>
                      <td className="num">
                        {(job.discountAmount || 0) > 0
                          ? <span style={{ color: 'var(--amber-700)', fontWeight: 600 }}>−${job.discountAmount!.toFixed(2)}</span>
                          : <span style={{ color: 'var(--primary-40)' }}>—</span>
                        }
                      </td>
                      <td className="num">
                        {typeof job.profitPct === 'number' && (job.price || 0) > 0
                          ? <span className={`profit-pct ${profitClass(job.profitPct)}`}>{job.profitPct.toFixed(0)}%</span>
                          : <span style={{ color: 'var(--primary-40)' }}>—</span>
                        }
                      </td>
                      <td>
                        {job.isCashJob
                          ? <CashPill />
                          : <span style={{ fontSize: 12, color: 'var(--primary-70)' }}>{payTypeLabel(job.paymentType)}</span>
                        }
                      </td>
                      <td><StatusPill status={simpleJobStatus(job)} /></td>
                      <td>
                        <PayIcons
                          paymentReceived={job.paymentReceived}
                          invoiceSent={job.invoiceSent}
                          busy={payBusyId === job.id}
                          onTogglePaid={() => handleTogglePaid(job)}
                          onToggleInvoice={() => handleToggleInvoice(job)}
                        />
                      </td>
                      <td className="col-actions">
                        <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                          {archived ? (
                            <>
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label="Restore"
                              title="Restore"
                              onClick={async (e) => {
                                e.stopPropagation();
                                await bulkRestore('job', [job.id]);
                                router.refresh();
                              }}
                              style={{ width: 30, height: 30 }}
                            >
                              <RotateCcw size={14} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label="Delete permanently"
                              title="Delete permanently"
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (!window.confirm('Permanently delete this archived job? This cannot be undone — it is removed from Jobs, Calendar, Archived, cleaner views and payroll.')) return;
                                const res = await permanentlyDeleteJobs([job.id]);
                                if ('error' in res && res.error) { alert(res.error); return; }
                                router.refresh();
                              }}
                              style={{ width: 30, height: 30, color: 'var(--error)' }}
                            >
                              <Trash2 size={14} />
                            </button>
                            </>
                          ) : (
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label="Edit"
                            onClick={(e) => { e.stopPropagation(); onEditJob(job); }}
                            style={{ width: 30, height: 30 }}
                          >
                            <EditSvg size={14} />
                          </button>
                          )}
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label="View"
                            onClick={(e) => { e.stopPropagation(); window.location.href = `/admin/jobs/${job.id}`; }}
                            style={{ width: 30, height: 30 }}
                          >
                            <ChevronRightSvg size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <APager
              page={page} totalPages={totalPages} totalJobs={totalJobs}
              rowsPerPage={rowsPerPage} startIndex={startIndex}
              pageNumbers={pageNumbers} onPageChange={goToPage}
            />
          </div>

          {/* Mobile cards */}
          <div id="jlist-mobile" style={{ display: 'none', flexDirection: 'column', gap: 10 }}>
            {paginatedJobs.map(job => (
              <article key={job.id} className="jcard" onClick={() => { window.location.href = `/admin/jobs/${job.id}`; }}>
                <div className="jcard-top">
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <input
                      type="checkbox"
                      aria-label="Select row"
                      checked={sel.isSelected(job.id)}
                      onChange={() => sel.toggle(job.id)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ cursor: 'pointer', marginTop: 3 }}
                    />
                    <div>
                    <div className="jcard-client">{job.clientName}</div>
                    <div className="jcard-meta">{formatDate(job.jobDate, job.startTime)} · {formatTime(job.startTime)}</div>
                    {job.location && <div className="jcard-meta">{job.location.split(',')[0]}</div>}
                    </div>
                  </div>
                  <StatusPill status={simpleJobStatus(job)} />
                </div>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <TypePill type={job.jobType} />
                  {job.isCashJob && <CashPill />}
                  {job.usesFixedPrice && <FixedPricePill />}
                  <AvatarStack cleaners={job.cleaners} max={2} />
                </div>
                <div className="jcard-row" style={{ paddingTop: 10, borderTop: '1px solid var(--primary-10)' }}>
                  <div className="jcard-price">
                    {job.price !== null ? `$${((job.price || 0) - (job.discountAmount || 0)).toFixed(2)}` : '—'}
                  </div>
                  <div className="row" style={{ gap: 10 }}>
                    <PayIcons
                      paymentReceived={job.paymentReceived}
                      invoiceSent={job.invoiceSent}
                      busy={payBusyId === job.id}
                      onTogglePaid={() => handleTogglePaid(job)}
                      onToggleInvoice={() => handleToggleInvoice(job)}
                    />
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Edit"
                      style={{ width: 32, height: 32 }}
                      onClick={(e) => { e.stopPropagation(); onEditJob(job); }}
                    >
                      <EditSvg size={14} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
            <APager
              page={page} totalPages={totalPages} totalJobs={totalJobs}
              rowsPerPage={rowsPerPage} startIndex={startIndex}
              pageNumbers={pageNumbers} onPageChange={goToPage}
            />
          </div>

          <style>{`
            @media (min-width: 1100px) { #jlist-mobile { display: none !important; } }
            @media (max-width: 1099px) {
              #jlist-desktop { display: none !important; }
              #jlist-mobile  { display: flex !important; }
            }
          `}</style>
        </>
      )}

      {/* Bulk-action pickers (shown above the floating bar) */}
      {sel.count > 0 && (showAssign || showStatus) && (
        <div
          style={{
            position: 'sticky',
            bottom: 76,
            zIndex: 41,
            display: 'flex',
            justifyContent: 'center',
            marginTop: 12,
          }}
        >
          {showAssign && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                justifyContent: 'center',
                gap: 10,
                maxWidth: 'calc(100vw - 32px)',
                background: '#fff',
                border: '1px solid var(--primary-10)',
                borderRadius: 12,
                padding: '10px 14px',
                boxShadow: '0 8px 30px rgba(0,0,0,0.15)',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                Assign to
              </span>
              <PremiumSelect
                value={assignCleanerId}
                onChange={setAssignCleanerId}
                size="sm"
                searchable={cleaners.length > 8}
                style={{ width: 200 }}
                options={[
                  { value: '', label: 'Select a cleaner…' },
                  ...cleaners.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
              <Button
                variant="primary"
                border={false}
                size="sm"
                onClick={runAssign}
                disabled={!assignCleanerId || bulkBusy}
                className="rounded-lg px-4"
              >
                {bulkBusy ? 'Assigning…' : `Assign to ${sel.count}`}
              </Button>
              <button
                type="button"
                onClick={() => { setShowAssign(false); setAssignCleanerId(''); }}
                style={{ background: 'none', border: 0, cursor: 'pointer', fontSize: 13, color: 'var(--primary-60)' }}
              >
                Cancel
              </button>
            </div>
          )}
          {showStatus && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                justifyContent: 'center',
                gap: 8,
                maxWidth: 'calc(100vw - 32px)',
                background: '#fff',
                border: '1px solid var(--primary-10)',
                borderRadius: 12,
                padding: '10px 14px',
                boxShadow: '0 8px 30px rgba(0,0,0,0.15)',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                Set status to
              </span>
              {(['SCHEDULED', 'COMPLETED', 'PAID'] as const).map((s) => (
                <Button
                  key={s}
                  variant="secondary"
                  size="sm"
                  onClick={() => runSetStatus(s)}
                  disabled={bulkBusy}
                  className="rounded-lg px-3"
                >
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </Button>
              ))}
              <button
                type="button"
                onClick={() => setShowStatus(false)}
                style={{ background: 'none', border: 0, cursor: 'pointer', fontSize: 13, color: 'var(--primary-60)' }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      <BulkActionBar
        count={sel.count}
        actions={bulkActions}
        onClear={() => { sel.clear(); setShowAssign(false); setShowStatus(false); }}
        noun="job"
        total={visibleIds.length}
        allSelected={sel.allSelected}
        onToggleAll={sel.toggleAll}
      />
    </div>
  );
}
