"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Modal from "@/components/ui/Modal";
import PremiumSelect from "@/components/ui/PremiumSelect";
import { EmployeeModal } from "../EmployeeModal";
import { assignKit } from "../../actions/assignKit";
import { setEmployeeRating } from "../../actions/setEmployeeRating";
import { resolveInventoryRequest } from "../../actions/resolveInventoryRequest";
import { setCleanerTier } from "../../actions/setCleanerTier";
import { setFieldLead } from "../../actions/setFieldLead";
import { setCleanerProductQuantity } from "../../actions/setCleanerProductQuantity";
import { setEmployeeServiceCategories } from "../../actions/setEmployeeServiceCategories";
import { getEmployeeFileUrl } from "../../actions/getEmployeeFileUrl";
import { PERMISSION_CATEGORIES } from "@/lib/service-permissions";
import { TIER_LABEL, type CleanerTier } from "@/lib/pay-tiers";
import { fmtDateTime, fmtDate, fmtTime } from "@/lib/time";
import {
  ArrowLeft,
  Mail,
  Phone,
  Calendar,
  DollarSign,
  CheckCircle2,
  AlertTriangle,
  Pencil,
  Briefcase,
  Package,
  History,
  User,
  Plus,
  TrendingDown,
  Star,
  ShieldAlert,
  Banknote,
  Loader,
  X,
} from "lucide-react";
import StrikesPanel from "./StrikesPanel";
import type { StrikeLevel } from "@/lib/strikes-constants";
import type { StrikeReason } from "@prisma/client";
import { jobTypeLabel } from "@/lib/calendar-labels";

type TabView = "overview" | "jobs" | "products" | "availability" | "accountability";

const MENU_ITEMS: Array<{ id: TabView; label: string; icon: React.ReactNode }> =
  [
    {
      id: "overview",
      label: "Overview",
      icon: <User className="w-4 h-4" />,
    },
    {
      id: "jobs",
      label: "Jobs",
      icon: <Briefcase className="w-4 h-4" />,
    },
    {
      id: "products",
      label: "Products",
      icon: <Package className="w-4 h-4" />,
    },
    {
      id: "availability",
      label: "Availability",
      icon: <Calendar className="w-4 h-4" />,
    },
    {
      id: "accountability",
      label: "Strikes",
      icon: <ShieldAlert className="w-4 h-4" />,
    },
  ];

interface Employee {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: "OWNER" | "ADMIN" | "EMPLOYEE";
  lastSeenAt: string | null;
}

interface Job {
  id: string;
  clientName: string;
  jobType: string | null;
  startTime: string;
  price: number | null;
  status: string;
  paymentReceived: boolean;
}

interface ProductUsage {
  name: string;
  quantity: number;
  unit: string;
}

interface AssignedProduct {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unit: string;
  costPerUnit: number;
}

interface InventoryRequestDTO {
  id: string;
  itemName: string;
  isKit: boolean;
  quantity: number;
  unit: string | null;
  reason: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "FULFILLED";
  createdAt: string;
}

interface KitTemplate {
  id: string;
  name: string;
  description: string | null;
  items: Array<{
    productId: string;
    productName: string;
    quantity: number;
    unit: string;
    warehouseStock: number;
  }>;
}

interface ForecastItem {
  productId: string;
  productName: string;
  unit: string;
  currentQuantity: number;
  /** Trailing-30-day average across jobs that used it (item 14). */
  averagePerJob: number;
  refillThreshold: number;
  projectedUsage: number;
  deficit: number;
  needsRefill: boolean;
}

interface AvailabilitySlot {
  id: string;
  day:
    | "MONDAY"
    | "TUESDAY"
    | "WEDNESDAY"
    | "THURSDAY"
    | "FRIDAY"
    | "SATURDAY"
    | "SUNDAY";
  startTime: string;
  endTime: string;
  isAvailable: boolean;
  isRecurring: boolean;
}

interface AvailabilityConflict {
  jobId: string;
  clientName: string;
  startTime: string;
  endTime: string;
  reason: string;
}

interface EmployeeDetailViewProps {
  employee: Employee;
  stats: {
    completedJobsCount: number;
    totalRevenue: number;
    totalPaid: number;
    totalTips: number;
    unpaidJobs: number;
  };
  starRating?: number | null;
  cleanerTier?: CleanerTier;
  /** Service categories this employee may work. Empty = all (item 3). */
  allowedServiceCategories?: string[];
  ratingCount?: number;
  recentRatings?: RecentRatingDTO[];
  fieldLeadId?: string | null;
  fieldLeadOptions?: Array<{ id: string; name: string }>;
  weeklyBonus?: {
    groupRevenue: number;
    groupAvgRating: number | null;
    bonusRate: number;
    bonusAmount: number;
    memberCount: number;
  } | null;
  upcomingJobs: Job[];
  recentJobs: Job[];
  topProducts: ProductUsage[];
  assignedProducts: AssignedProduct[];
  inventoryRequests?: InventoryRequestDTO[];
  kitTemplates: KitTemplate[];
  forecast: ForecastItem[];
  upcomingJobCount: number;
  availability: AvailabilitySlot[];
  availabilityConflicts: AvailabilityConflict[];
  strikes: StrikeDTO[];
  strikeSummary: { activeCount: number; level: StrikeLevel };
  strikeWindowDays: number;
  /**
   * The employee's current void cheque (awerfixes.pdf item 16), METADATA ONLY.
   * No URL crosses this boundary — opening the file goes through
   * `getEmployeeFileUrl`, which re-checks OWNER/ADMIN and logs the access.
   */
  voidCheque?: {
    id: string;
    fileName: string;
    mimeType: string;
    uploadedAt: string;
  } | null;
}

interface RecentRatingDTO {
  id: string;
  rating: number;
  notes: string | null;
  createdAt: string;
  /** Set when the client edited their submitted rating. */
  editedAt: string | null;
  clientName: string | null;
}

interface StrikeDTO {
  id: string;
  reasonCode: StrikeReason;
  reason: string;
  status: "ACTIVE" | "EXPIRED" | "EXCUSED" | "REMOVED";
  isAuto: boolean;
  adminNote: string | null;
  jobNumber: number | null;
  createdAt: string;
  expiresAt: string;
  excusedAt: string | null;
}

/**
 * One row of the cleaner's assigned inventory, with an inline "set count" editor.
 *
 * Defined at module scope (not inside EmployeeDetailView) on purpose: ProductsTab
 * is re-created on every parent render, so any state held up there would remount
 * this subtree and steal focus on every keystroke. Keeping the edit state local
 * means typing re-renders only this row.
 *
 * The page itself is already OWNER/ADMIN-only, and setCleanerProductQuantity
 * re-checks the role server-side — the UI is not the authorization boundary.
 */
function AssignedProductRow({
  employeeId,
  item,
}: {
  employeeId: string;
  item: AssignedProduct;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(String(item.quantity));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    setQty(String(item.quantity));
    setReason("");
    setError(null);
    setEditing(true);
  };

  const close = () => {
    setEditing(false);
    setError(null);
  };

  async function save() {
    const value = Number(qty);
    if (!Number.isFinite(value) || value < 0) {
      setError("Enter a quantity of 0 or more.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await setCleanerProductQuantity({
      cleanerId: employeeId,
      productId: item.productId,
      quantity: value,
      reason: reason.trim() || undefined,
    });
    setSaving(false);
    if (!res.success) {
      setError(res.error);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  if (editing) {
    return (
      <div className="p-3 rounded-xl bg-white border border-[#008C9C]/30 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-[400] text-[#008C9C]">{item.productName}</p>
          <button
            type="button"
            aria-label="Cancel"
            onClick={close}
            disabled={saving}
            className="text-[#008C9C]/50 hover:text-[#008C9C]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-[#008C9C]/60 shrink-0">Set to</label>
          <input
            type="number"
            min={0}
            step="0.01"
            autoFocus
            value={qty}
            disabled={saving}
            onChange={(e) => setQty(e.target.value)}
            className="w-24 px-2 py-1.5 rounded-lg border border-[#008C9C]/20 text-sm text-[#003C46] focus:outline-none focus:border-[#008C9C]"
          />
          <span className="text-xs text-[#008C9C]/60">{item.unit}</span>
          <span className="text-xs text-[#008C9C]/40 ml-auto">
            was {item.quantity} {item.unit}
          </span>
        </div>
        <input
          type="text"
          value={reason}
          maxLength={500}
          disabled={saving}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional) — e.g. cycle count, restocked van"
          className="w-full px-2 py-1.5 rounded-lg border border-[#008C9C]/20 text-sm text-[#003C46] placeholder:text-[#008C9C]/40 focus:outline-none focus:border-[#008C9C]"
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            border={false}
            disabled={saving}
            onClick={save}
            className="rounded-2xl px-4 py-2">
            {saving ? (
              <>
                <Loader className="w-3 h-3 mr-2 animate-spin" />
                Saving…
              </>
            ) : (
              "Save count"
            )}
          </Button>
          <Button
            variant="default"
            size="sm"
            border={false}
            disabled={saving}
            onClick={close}
            className="rounded-2xl px-4 py-2">
            Cancel
          </Button>
        </div>
        <p className="text-[11px] text-[#008C9C]/50">
          Saved to the product&rsquo;s stock history with your name and the change
          amount. Warehouse stock is not affected.
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between p-3 rounded-xl bg-[#008C9C]/5">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-[400] text-[#008C9C] truncate">
          {item.productName}
        </p>
        <p className="text-xs text-[#008C9C]/60">
          {item.quantity} {item.unit}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm font-[400] text-[#008C9C]">
          ${(item.quantity * item.costPerUnit).toFixed(2)}
        </span>
        <Button
          variant="default"
          size="sm"
          border={false}
          onClick={open}
          className="rounded-2xl px-4 py-2.5">
          <Pencil className="w-3 h-3 mr-2" />
          Set count
        </Button>
        <Button
          variant="default"
          size="sm"
          border={false}
          href={`/admin/inventory/${item.productId}`}
          className="rounded-2xl px-4 py-2.5">
          View
        </Button>
      </div>
    </div>
  );
}

/**
 * The employee's payroll paperwork (awerfixes.pdf item 16).
 *
 * Renders NO link. The signed URL is minted on click by `getEmployeeFileUrl`
 * and thrown away after the tab opens, because a URL rendered into the page
 * would sit in the HTML, the browser history and any screenshot of this screen
 * — which is the leak decision 7 exists to prevent. The 5-minute expiry is what
 * makes a copied link harmless rather than permanent.
 *
 * Module scope, like AssignedProductRow above: OverviewTab is re-created on
 * every parent render, so state held there would remount this and drop the
 * "opening…" feedback mid-click.
 */
function VoidChequeAdminCard({
  file,
}: {
  file: { id: string; fileName: string; uploadedAt: string } | null;
}) {
  const [opening, setOpening] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function open() {
    if (!file) return;
    setOpening(true);
    setErr(null);
    try {
      const res = await getEmployeeFileUrl(file.id);
      if (res.success) window.open(res.url, "_blank", "noopener,noreferrer");
      else setErr(res.error);
    } catch {
      setErr("Failed to open file");
    } finally {
      setOpening(false);
    }
  }

  return (
    <Card variant="default" className="p-5">
      <div className="flex items-center gap-2 mb-3">
        <Banknote className="w-4 h-4 text-[#008C9C]" />
        <h3 className="text-sm font-[600] text-gray-800">Payroll Documents</h3>
      </div>
      {file ? (
        <>
          {/* Same row shape as OverviewTab's InfoRow, which is scoped inside
              that closure and so isn't reachable from module scope. */}
          <div className="flex items-center justify-between py-3 border-b border-gray-100">
            <span className="text-sm text-gray-500">Void cheque</span>
            <span className="text-sm font-[450] text-gray-800 text-right break-all">
              {file.fileName}
            </span>
          </div>
          <div className="flex items-center justify-between py-3">
            <span className="text-sm text-gray-500">Uploaded</span>
            <span className="text-sm font-[450] text-gray-800 text-right">
              {new Date(file.uploadedAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
          <Button
            variant="default"
            size="sm"
            border={false}
            disabled={opening}
            onClick={open}
            className="rounded-2xl px-4 py-2.5 mt-3">
            {opening ? "Opening…" : "View / Download"}
          </Button>
          {err && <p className="text-xs mt-2 text-red-500">{err}</p>}
          <p className="text-xs text-gray-400 mt-2">
            Opens a link that expires in 5 minutes. Every view is recorded in the
            activity log.
          </p>
        </>
      ) : (
        <p className="text-xs text-gray-500">
          No void cheque on file. The employee uploads this themselves from their
          Documents page.
        </p>
      )}
    </Card>
  );
}

export default function EmployeeDetailView({
  employee,
  stats,
  starRating,
  cleanerTier = "STANDARD",
  allowedServiceCategories = [],
  ratingCount = 0,
  recentRatings = [],
  fieldLeadId = null,
  fieldLeadOptions = [],
  weeklyBonus = null,
  upcomingJobs,
  recentJobs,
  topProducts,
  assignedProducts,
  inventoryRequests = [],
  kitTemplates,
  forecast,
  upcomingJobCount,
  availability,
  availabilityConflicts,
  strikes,
  strikeSummary,
  strikeWindowDays,
  voidCheque = null,
}: EmployeeDetailViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [activeView, setActiveView] = useState<TabView>("overview");
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [kitModalOpen, setKitModalOpen] = useState(false);
  const [selectedKitId, setSelectedKitId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [kitMessage, setKitMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [ratingEdit, setRatingEdit] = useState<string>(starRating != null ? starRating.toFixed(1) : "");
  const [ratingSaving, setRatingSaving] = useState(false);
  const [ratingMsg, setRatingMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [tier, setTier] = useState<CleanerTier>(cleanerTier);
  const [tierSaving, setTierSaving] = useState(false);
  const [tierMsg, setTierMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [leadId, setLeadId] = useState<string>(fieldLeadId ?? "");
  const [leadSaving, setLeadSaving] = useState(false);
  // Service category permissions (awerfixes.pdf item 3). Empty = no restriction.
  const [categories, setCategories] = useState<string[]>(allowedServiceCategories);
  const [catSaving, setCatSaving] = useState(false);
  const [catMsg, setCatMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function handleToggleCategory(key: string) {
    const prev = categories;
    const next = prev.includes(key)
      ? prev.filter((c) => c !== key)
      : [...prev, key];
    setCategories(next);
    setCatSaving(true);
    setCatMsg(null);
    const res = await setEmployeeServiceCategories(employee.id, next);
    setCatSaving(false);
    if (res.success) {
      // The action normalises (validates keys, folds the move family), so trust
      // what came back rather than the optimistic value.
      setCategories(res.categories);
      setCatMsg({
        type: "success",
        text: res.categories.length
          ? "Service categories saved."
          : "Restriction removed — all categories allowed.",
      });
    } else {
      setCategories(prev);
      setCatMsg({ type: "error", text: res.error ?? "Failed" });
    }
  }

  async function handleSetLead(next: string) {
    setLeadSaving(true);
    const prev = leadId;
    setLeadId(next);
    const res = await setFieldLead(employee.id, next || null);
    setLeadSaving(false);
    if (!res.success) setLeadId(prev);
  }

  async function handleSetTier(next: CleanerTier) {
    setTierSaving(true);
    setTierMsg(null);
    const prev = tier;
    setTier(next);
    const res = await setCleanerTier(employee.id, next);
    setTierSaving(false);
    if (res.success) {
      setTierMsg({ type: "success", text: `Tier set to ${TIER_LABEL[next]}.` });
    } else {
      setTier(prev);
      setTierMsg({ type: "error", text: res.error ?? "Failed" });
    }
  }

  // Pay-tier rate preview (mirrors src/lib/pay-tiers.ts).
  const tierRatePct =
    tier === "TRAINEE"
      ? "30%"
      : tier === "FIELD_LEAD"
        ? "46%"
        : ratingCount < 5 || starRating == null
          ? `40% (locked — ${ratingCount}/5 ratings)`
          : starRating >= 5
            ? "45%"
            : starRating >= 4.8
              ? "44%"
              : starRating >= 4.6
                ? "43%"
                : starRating >= 4.4
                  ? "42%"
                  : starRating >= 4.2
                    ? "41%"
                    : "40%";

  const [requestBusy, setRequestBusy] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  async function handleResolveRequest(requestId: string, decision: "APPROVED" | "REJECTED") {
    setRequestBusy(requestId);
    setRequestError(null);
    const res = await resolveInventoryRequest(requestId, decision);
    setRequestBusy(null);
    if (res.success) {
      router.refresh();
    } else {
      setRequestError(res.error);
    }
  }

  const selectedKit = kitTemplates.find((k) => k.id === selectedKitId) || null;

  const handleAssignKit = async () => {
    if (!selectedKitId) {
      setKitMessage({ type: "error", text: "Select a kit template." });
      return;
    }
    setAssigning(true);
    setKitMessage(null);
    const res = await assignKit({
      employeeId: employee.id,
      kitTemplateId: selectedKitId,
    });
    if (res.success) {
      setKitMessage({ type: "success", text: "Kit assigned successfully." });
      setSelectedKitId("");
      setTimeout(() => {
        setKitModalOpen(false);
        setKitMessage(null);
        router.refresh();
      }, 900);
    } else {
      setKitMessage({ type: "error", text: res.error || "Failed to assign kit." });
    }
    setAssigning(false);
  };

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
      query
        ? `/admin/employees/${employee.id}?${query}`
        : `/admin/employees/${employee.id}`,
      { scroll: false }
    );
  };

  const getRoleBadge = (role: string) => {
    const roleConfig: Record<string, { variant: any; label: string }> = {
      OWNER: { variant: "cleano", label: "Owner" },
      ADMIN: { variant: "secondary", label: "Admin" },
      EMPLOYEE: { variant: "default", label: "Employee" },
    };
    const config = roleConfig[role] || { variant: "default", label: role };
    return (
      <Badge variant={config.variant} size="md">
        {config.label}
      </Badge>
    );
  };

  // Metric Card Component
  const MetricCard = ({
    label,
    value,
    subValue,
    variant = "default",
  }: {
    label: string;
    value: string;
    subValue?: string;
    variant?: "default" | "warning";
  }) => (
    <Card
      variant={variant === "warning" ? "warning" : "cleano_light"}
      className="p-6 h-[7rem]">
      <div className="h-full flex flex-col justify-between">
        <span
          className={`app-title-small ${
            variant === "warning" ? "text-yellow-700" : "!text-[#008C9C]/70"
          }`}>
          {label}
        </span>
        <div>
          <p
            className={`h2-title ${
              variant === "warning" ? "text-yellow-700" : "text-[#008C9C]"
            }`}>
            {value}
          </p>
          {subValue && (
            <p className="text-xs text-[#008C9C]/60 mt-0.5">{subValue}</p>
          )}
        </div>
      </div>
    </Card>
  );

  // Overview Tab Content
  const OverviewTab = () => {
    const InfoRow = ({
      label,
      value,
      valueNode,
    }: {
      label: string;
      value?: string;
      valueNode?: React.ReactNode;
    }) => (
      <div className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
        <span className="text-sm text-gray-500">{label}</span>
        {valueNode ?? (
          <span className="text-sm font-[450] text-gray-800 text-right">
            {value}
          </span>
        )}
      </div>
    );

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Contact Details */}
          <Card variant="default" className="p-5">
            <h3 className="text-sm font-[600] text-gray-800 mb-1">
              Contact Details
            </h3>
            <div>
              <InfoRow label="Email" value={employee.email} />
              <InfoRow label="Phone" value={employee.phone || "-"} />
              <InfoRow
                label="Role"
                valueNode={getRoleBadge(employee.role)}
              />
              <InfoRow
                label="Last seen"
                value={employee.lastSeenAt ? fmtDateTime(employee.lastSeenAt) : "Never signed in"}
              />
            </div>
          </Card>

          {/* Star Rating */}
          <Card variant="default" className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
              <h3 className="text-sm font-[600] text-gray-800">Star Rating</h3>
            </div>
            <div className="flex items-center gap-3 mb-3">
              {starRating != null ? (
                <span className="text-3xl font-[600] text-amber-500">
                  {Math.min(5, Math.max(1, Math.round(starRating * 10) / 10)).toFixed(1)}
                </span>
              ) : (
                <span className="text-sm text-gray-400">No rating yet</span>
              )}
              {starRating != null && (
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star
                      key={s}
                      className={`w-4 h-4 ${s <= Math.round(Math.min(5, Math.max(1, starRating))) ? "text-amber-400 fill-amber-400" : "text-gray-200 fill-gray-200"}`}
                    />
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1.0"
                max="5.0"
                step="0.1"
                value={ratingEdit}
                onChange={(e) => setRatingEdit(e.target.value)}
                placeholder="1.0 – 5.0"
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-28 focus:outline-none focus:ring-1 focus:ring-[#008C9C]"
              />
              <button
                onClick={async () => {
                  const val = parseFloat(ratingEdit);
                  if (isNaN(val) || val < 1 || val > 5) {
                    setRatingMsg({ type: "error", text: "Must be between 1.0 and 5.0" });
                    return;
                  }
                  setRatingSaving(true);
                  setRatingMsg(null);
                  const res = await setEmployeeRating(employee.id, val);
                  setRatingSaving(false);
                  if (res.success) {
                    setRatingMsg({ type: "success", text: "Rating updated." });
                  } else {
                    setRatingMsg({ type: "error", text: res.error ?? "Failed" });
                  }
                }}
                disabled={ratingSaving}
                className="px-3 py-1.5 text-sm bg-[#008C9C] text-white rounded-lg hover:bg-[#008C9C]/90 disabled:opacity-50">
                {ratingSaving ? "Saving…" : "Set"}
              </button>
            </div>
            {ratingMsg && (
              <p className={`text-xs mt-2 ${ratingMsg.type === "success" ? "text-green-600" : "text-red-500"}`}>
                {ratingMsg.text}
              </p>
            )}
            <p className="text-xs text-gray-400 mt-2">Admin override. Customer ratings also update this average.</p>
            {recentRatings.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <h4 className="text-xs font-[600] text-gray-500 uppercase tracking-wide mb-2">Recent Ratings</h4>
                <div className="space-y-2">
                  {recentRatings.map((r) => (
                    <div key={r.id} className="flex items-start justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <span className="font-[600] text-amber-500">{r.rating.toFixed(1)} ★</span>
                        {r.editedAt && (
                          <span className="ml-1.5 text-[11px] text-gray-400 italic" title={`Edited ${new Date(r.editedAt).toLocaleString()}`}>
                            (edited)
                          </span>
                        )}
                        {r.clientName && <span className="ml-1.5 text-xs text-gray-500">· {r.clientName}</span>}
                        {r.notes && <p className="text-xs text-gray-500 italic truncate">&quot;{r.notes}&quot;</p>}
                      </div>
                      <span className="text-xs text-gray-400 whitespace-nowrap">
                        {new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* Payroll Tier */}
          <Card variant="default" className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign className="w-4 h-4 text-[#008C9C]" />
              <h3 className="text-sm font-[600] text-gray-800">Payroll Tier</h3>
            </div>
            <div className="flex items-center gap-2 mb-3">
              {(["TRAINEE", "STANDARD", "FIELD_LEAD"] as CleanerTier[]).map((t) => (
                <button
                  key={t}
                  onClick={() => handleSetTier(t)}
                  disabled={tierSaving}
                  className={`px-3 py-1.5 text-sm rounded-lg border transition-colors disabled:opacity-50 ${
                    tier === t
                      ? "bg-[#008C9C] text-white border-[#008C9C]"
                      : "bg-white text-gray-700 border-gray-200 hover:border-[#008C9C]"
                  }`}>
                  {TIER_LABEL[t]}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500">
              Individual pay rate:{" "}
              <span className="font-[600] text-gray-800">{tierRatePct}</span> of job price.
            </p>
            {tier === "TRAINEE" && (
              <p className="text-xs text-gray-400 mt-1">
                Trainees always work paired with a Field Lead; take-home comes from the split-job calculation.
              </p>
            )}
            {tierMsg && (
              <p className={`text-xs mt-2 ${tierMsg.type === "success" ? "text-green-600" : "text-red-500"}`}>
                {tierMsg.text}
              </p>
            )}
            <p className="text-xs text-gray-400 mt-2">
              Set manually by admin. There is no automatic promotion.
            </p>
          </Card>

          {/* Service categories (awerfixes.pdf item 3). Ticking nothing means no
              restriction, which is where every cleaner starts. */}
          <Card variant="default" className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <ShieldAlert className="w-4 h-4 text-[#008C9C]" />
              <h3 className="text-sm font-[600] text-gray-800">Service Categories</h3>
            </div>
            <div className="space-y-1 mb-3">
              {PERMISSION_CATEGORIES.map((cat) => (
                <label
                  key={cat.key}
                  className="flex items-center gap-2 text-sm text-gray-700 select-none px-2 py-1 rounded hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={categories.includes(cat.key)}
                    onChange={() => handleToggleCategory(cat.key)}
                    disabled={catSaving}
                    className="accent-[#008C9C]"
                  />
                  {cat.label}
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-500">
              {categories.length === 0
                ? "No restriction — this employee can work every service category."
                : "Only jobs in the ticked categories appear on their Available jobs board, and only those can be claimed."}
            </p>
            {catMsg && (
              <p className={`text-xs mt-2 ${catMsg.type === "success" ? "text-green-600" : "text-red-500"}`}>
                {catMsg.text}
              </p>
            )}
            <p className="text-xs text-gray-400 mt-2">
              Admins can still assign this employee to any job — a mismatch only
              shows a warning.
            </p>
          </Card>

          {/* Field Lead group + weekly bonus */}
          {tier === "FIELD_LEAD" ? (
            <Card variant="default" className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <Briefcase className="w-4 h-4 text-[#008C9C]" />
                <h3 className="text-sm font-[600] text-gray-800">Weekly Group Bonus</h3>
              </div>
              {weeklyBonus ? (
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Group members</span>
                    <span className="text-gray-800">{weeklyBonus.memberCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Group revenue (7d)</span>
                    <span className="text-gray-800">${weeklyBonus.groupRevenue.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Group avg rating</span>
                    <span className="text-gray-800">
                      {weeklyBonus.groupAvgRating != null
                        ? weeklyBonus.groupAvgRating.toFixed(2)
                        : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between pt-1.5 mt-1.5 border-t border-gray-100">
                    <span className="text-gray-600">
                      Bonus ({Math.round(weeklyBonus.bonusRate * 100)}%)
                    </span>
                    <span className="font-[600] text-[#008C9C]">
                      ${weeklyBonus.bonusAmount.toFixed(2)}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-400">No group activity this week.</p>
              )}
              <p className="text-xs text-gray-400 mt-2">
                2% of group revenue at ≤4.5★, 3% above 4.5★. Based on the team average,
                not personal rating. Paid out with each pay period.
              </p>
            </Card>
          ) : (
            <Card variant="default" className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <Briefcase className="w-4 h-4 text-gray-400" />
                <h3 className="text-sm font-[600] text-gray-800">Field Lead Group</h3>
              </div>
              <select
                value={leadId}
                onChange={(e) => handleSetLead(e.target.value)}
                disabled={leadSaving}
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#008C9C] disabled:opacity-50">
                <option value="">— No Field Lead —</option>
                {fieldLeadOptions.map((fl) => (
                  <option key={fl.id} value={fl.id}>
                    {fl.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-2">
                The Field Lead this cleaner reports to. Counts toward that lead&apos;s
                weekly group-revenue bonus.
              </p>
            </Card>
          )}

          {/* Financial Summary */}
          <Card variant="default" className="p-5">
            <h3 className="text-sm font-[600] text-gray-800 mb-1">
              Financial Summary
            </h3>
            <div>
              <InfoRow
                label="Total Revenue Generated"
                value={`$${stats.totalRevenue.toFixed(2)}`}
              />
              <InfoRow
                label="Total Employee Pay"
                value={`$${stats.totalPaid.toFixed(2)}`}
              />
              <InfoRow
                label="Total Tips"
                valueNode={
                  <span
                    className={`text-sm font-[450] ${
                      stats.totalTips > 0 ? "text-green-600" : "text-gray-800"
                    }`}>
                    {stats.totalTips > 0
                      ? `+$${stats.totalTips.toFixed(2)}`
                      : "-"}
                  </span>
                }
              />
              <InfoRow
                label="Unpaid Jobs"
                valueNode={
                  stats.unpaidJobs > 0 ? (
                    <span className="text-sm font-[450] text-yellow-600">
                      {stats.unpaidJobs}
                    </span>
                  ) : (
                    <span className="text-sm font-[450] text-gray-800">0</span>
                  )
                }
              />
            </div>
          </Card>

          {/* Payroll documents (item 16) — metadata here, file behind a signed,
              logged, OWNER/ADMIN-only action. */}
          <VoidChequeAdminCard file={voidCheque} />
        </div>

        {/* Unpaid Jobs Warning */}
        {stats.unpaidJobs > 0 && (
          <div className="rounded-2xl p-4 flex items-start gap-3 bg-yellow-50 border border-yellow-200">
            <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0" />
            <div>
              <p className="text-sm text-yellow-700 font-[400]">
                {stats.unpaidJobs} unpaid job{stats.unpaidJobs > 1 ? "s" : ""}
              </p>
              <p className="text-xs text-yellow-600/70 mt-1">
                Review and process pending payments
              </p>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Jobs Tab Content
  const JobsTab = () => (
    <div className="space-y-6">
      {/* Upcoming Jobs */}
      <h2 className="text-lg font-[350] tracking-tight text-[#008C9C]">
        Upcoming Jobs
      </h2>
      {upcomingJobs.length === 0 ? (
        <Card variant="ghost" className="p-8">
          <div className="text-center">
            <div className="w-12 h-12 bg-[#008C9C]/5 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Calendar className="w-6 h-6 text-[#008C9C]/40" />
            </div>
            <p className="text-sm text-[#008C9C]/60">No upcoming jobs</p>
          </div>
        </Card>
      ) : (
        <Card variant="default" className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-[#008C9C]/10 rounded-lg">
                <Calendar className="w-4 h-4 text-[#008C9C]" />
              </div>
              <h3 className="text-sm font-[350] text-[#008C9C]/80">
                Scheduled Jobs
              </h3>
            </div>
            <Badge variant="cleano" size="sm">
              {upcomingJobs.length}
            </Badge>
          </div>
          <div className="space-y-2">
            {upcomingJobs.map((job) => (
              <div
                key={job.id}
                className="flex items-center justify-between p-3 rounded-xl bg-[#008C9C]/5">
                <div className="flex-1">
                  <p className="text-sm font-[400] text-[#008C9C]">
                    {job.clientName}
                  </p>
                  <p className="text-xs text-[#008C9C]/60">
                    {fmtDate(job.startTime)} at {fmtTime(job.startTime)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {job.jobType && (
                    <Badge variant="cleano" size="sm">
                      {jobTypeLabel(job.jobType)}
                    </Badge>
                  )}
                  {job.price && (
                    <span className="text-sm font-[400] text-[#008C9C]">
                      ${job.price.toFixed(2)}
                    </span>
                  )}
                  <Button
                    variant="default"
                    size="sm"
                    border={false}
                    href={`/admin/jobs/${job.id}`}
                    className="rounded-2xl px-4 py-2.5">
                    View
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Recent Jobs */}
      <h2 className="input-label !text-[#008C9C]/70 !mb-2">Recent Jobs</h2>
      {recentJobs.length === 0 ? (
        <Card variant="ghost" className="p-8">
          <div className="text-center">
            <div className="w-12 h-12 bg-[#008C9C]/5 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <History className="w-6 h-6 text-[#008C9C]/40" />
            </div>
            <p className="text-sm text-[#008C9C]/60">No recent jobs</p>
          </div>
        </Card>
      ) : (
        <Card variant="ghost" className="!p-0">
          <div className="space-y-2">
            {recentJobs.map((job) => (
              <div
                key={job.id}
                className="flex items-center justify-between p-3 rounded-xl bg-[#008C9C]/2">
                <div className="flex-1">
                  <p className="app-title-small text-[#008C9C]">
                    {job.clientName}
                  </p>
                  <p className="app-subtitle !text-[#008C9C]/60">
                    {new Date(job.startTime).toLocaleDateString("en-US")}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge
                    variant={job.paymentReceived ? "success" : "warning"}
                    size="sm"
                    className="px-2 py-1">
                    {job.paymentReceived ? "Paid" : "Unpaid"}
                  </Badge>
                  {job.price && (
                    <span className="text-sm font-[400] text-[#008C9C]">
                      ${job.price.toFixed(2)}
                    </span>
                  )}
                  <Button
                    variant="default"
                    size="sm"
                    border={false}
                    href={`/admin/jobs/${job.id}`}
                    className="rounded-2xl px-4 py-2.5">
                    View
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );

  // Products Tab Content
  const ProductsTab = () => (
    <div className="space-y-6">
      {/* Assign Starter Kit */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-[350] tracking-tight text-[#008C9C]">
          Products & Inventory
        </h2>
        <Button
          variant="primary"
          size="md"
          border={false}
          onClick={() => setKitModalOpen(true)}
          className="px-6 py-3">
          <Plus className="w-4 h-4 mr-2" />
          Assign Starter Kit
        </Button>
      </div>

      {/* Equipment / Refill Requests */}
      {inventoryRequests.length > 0 && (
        <Card variant="default" className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-[#008C9C]/10 rounded-lg">
                <Package className="w-4 h-4 text-[#008C9C]" />
              </div>
              <h3 className="text-sm font-[350] text-[#008C9C]/80">
                Equipment Requests
              </h3>
            </div>
            {inventoryRequests.some((r) => r.status === "PENDING") && (
              <Badge variant="warning" size="sm">
                {inventoryRequests.filter((r) => r.status === "PENDING").length} pending
              </Badge>
            )}
          </div>
          {requestError && (
            <p className="text-xs text-red-500 mb-3">{requestError}</p>
          )}
          <div className="space-y-2">
            {inventoryRequests.map((req) => (
              <div
                key={req.id}
                className={`flex items-center justify-between gap-3 p-3 rounded-xl ${
                  req.status === "PENDING" ? "bg-amber-50 border border-amber-200" : "bg-[#008C9C]/5"
                }`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-[400] text-[#008C9C]">
                    {req.itemName}
                    {req.isKit ? " (kit)" : ""}
                    <span className="text-[#008C9C]/60"> · {req.quantity}{req.unit ? ` ${req.unit}` : ""}</span>
                  </p>
                  <p className="text-xs text-[#008C9C]/60 truncate">
                    {new Date(req.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    {req.reason ? ` · ${req.reason}` : ""}
                  </p>
                </div>
                {req.status === "PENDING" ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="primary"
                      size="sm"
                      border={false}
                      disabled={requestBusy === req.id}
                      onClick={() => handleResolveRequest(req.id, "APPROVED")}
                      className="rounded-2xl px-4 py-2">
                      {requestBusy === req.id ? "…" : "Approve"}
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      border={false}
                      disabled={requestBusy === req.id}
                      onClick={() => handleResolveRequest(req.id, "REJECTED")}
                      className="rounded-2xl px-4 py-2">
                      Reject
                    </Button>
                  </div>
                ) : (
                  <Badge
                    variant={req.status === "REJECTED" ? "error" : "success"}
                    size="sm">
                    {req.status.charAt(0) + req.status.slice(1).toLowerCase()}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Inventory Forecast */}
      {forecast.length > 0 && (
        <Card variant="default" className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-[#008C9C]/10 rounded-lg">
              <TrendingDown className="w-4 h-4 text-[#008C9C]" />
            </div>
            <h3 className="text-sm font-[350] text-[#008C9C]/80">
              Inventory Forecast ({upcomingJobCount} upcoming job{upcomingJobCount !== 1 ? "s" : ""})
            </h3>
          </div>
          <div className="space-y-2">
            {forecast.map((item) => (
              <div
                key={item.productId}
                className={`flex items-center justify-between p-3 rounded-xl ${
                  item.needsRefill ? "bg-red-50 border border-red-200" : "bg-[#008C9C]/5"
                }`}>
                <div className="flex-1">
                  <p className={`text-sm font-[400] ${item.needsRefill ? "text-red-700" : "text-[#008C9C]"}`}>
                    {item.productName}
                  </p>
                  <p className={`text-xs ${item.needsRefill ? "text-red-500" : "text-[#008C9C]/60"}`}>
                    Has {item.currentQuantity} {item.unit} &middot; Needs {item.projectedUsage} {item.unit} for upcoming jobs
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {item.deficit > 0 ? (
                    <Badge variant="error" size="sm">
                      Deficit: {item.deficit} {item.unit}
                    </Badge>
                  ) : item.needsRefill ? (
                    <Badge variant="warning" size="sm">
                      Below threshold
                    </Badge>
                  ) : (
                    <Badge variant="success" size="sm">
                      OK
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Most Used Products */}
      <h2 className="text-lg font-[350] tracking-tight text-[#008C9C]">
        Most Used Products
      </h2>
      {topProducts.length === 0 ? (
        <Card variant="ghost" className="p-8">
          <div className="text-center">
            <div className="w-12 h-12 bg-[#008C9C]/5 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Package className="w-6 h-6 text-[#008C9C]/40" />
            </div>
            <p className="text-sm text-[#008C9C]/60">No usage data yet</p>
          </div>
        </Card>
      ) : (
        <Card variant="default" className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-[#008C9C]/10 rounded-lg">
              <Package className="w-4 h-4 text-[#008C9C]" />
            </div>
            <h3 className="text-sm font-[350] text-[#008C9C]/80">
              Product Usage
            </h3>
          </div>
          <div className="space-y-2">
            {topProducts.map((product, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-3 rounded-xl bg-[#008C9C]/5">
                <div className="flex-1">
                  <p className="text-sm font-[400] text-[#008C9C]">
                    {product.name}
                  </p>
                  <p className="text-xs text-[#008C9C]/60">
                    {product.quantity} {product.unit}
                  </p>
                </div>
                <Badge variant="cleano" size="sm">
                  #{idx + 1}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Assigned Inventory */}
      <h2 className="text-lg font-[350] tracking-tight text-[#008C9C]">
        Assigned Inventory
      </h2>
      {assignedProducts.length === 0 ? (
        <Card variant="ghost" className="p-8">
          <div className="text-center">
            <div className="w-12 h-12 bg-[#008C9C]/5 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Briefcase className="w-6 h-6 text-[#008C9C]/40" />
            </div>
            <p className="text-sm text-[#008C9C]/60">No inventory assigned</p>
          </div>
        </Card>
      ) : (
        <Card variant="default" className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-[#008C9C]/10 rounded-lg">
                <Briefcase className="w-4 h-4 text-[#008C9C]" />
              </div>
              <h3 className="text-sm font-[350] text-[#008C9C]/80">
                Current Inventory
              </h3>
            </div>
            <Badge variant="cleano" size="sm">
              {assignedProducts.length} items
            </Badge>
          </div>
          <div className="space-y-2">
            {assignedProducts.map((item) => (
              <AssignedProductRow
                key={item.id}
                employeeId={employee.id}
                item={item}
              />
            ))}
          </div>
        </Card>
      )}
    </div>
  );

  // Availability Tab Content
  const AvailabilityTabContent = () => {
    const DAYS: AvailabilitySlot["day"][] = [
      "MONDAY",
      "TUESDAY",
      "WEDNESDAY",
      "THURSDAY",
      "FRIDAY",
      "SATURDAY",
      "SUNDAY",
    ];
    const byDay = new Map(availability.map((s) => [s.day, s]));
    const conflictDays = new Set(
      availabilityConflicts.map((c) =>
        new Date(c.startTime).toLocaleDateString("en-US", { weekday: "long" })
      )
    );

    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-[350] tracking-tight text-[#008C9C] mb-2">
            Weekly Availability
          </h2>
          <p className="text-sm text-[#008C9C]/60">
            Days and hours {employee.name} is typically available.
          </p>
        </div>

        {availability.length === 0 ? (
          <Card variant="ghost" className="p-8">
            <div className="text-center">
              <div className="w-12 h-12 bg-[#008C9C]/5 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Calendar className="w-6 h-6 text-[#008C9C]/40" />
              </div>
              <p className="text-sm text-[#008C9C]/60">
                {employee.name} hasn't entered availability yet.
              </p>
            </div>
          </Card>
        ) : (
          <Card variant="default" className="p-6">
            <div className="space-y-2">
              {DAYS.map((day) => {
                const slot = byDay.get(day);
                const label = day.charAt(0) + day.slice(1).toLowerCase();
                const hasConflict = conflictDays.has(label);
                if (!slot || !slot.isAvailable) {
                  return (
                    <div
                      key={day}
                      className="grid grid-cols-[120px_1fr] gap-3 items-center p-3 rounded-xl bg-[#008C9C]/5">
                      <span className="text-sm font-[400] text-[#008C9C]/60">
                        {label}
                      </span>
                      <span className="text-xs text-[#008C9C]/50">
                        Unavailable
                      </span>
                    </div>
                  );
                }
                return (
                  <div
                    key={day}
                    className={`grid grid-cols-[120px_1fr_auto] gap-3 items-center p-3 rounded-xl ${
                      hasConflict
                        ? "bg-yellow-50 border border-yellow-200"
                        : "bg-[#008C9C]/5"
                    }`}>
                    <span
                      className={`text-sm font-[400] ${
                        hasConflict ? "text-yellow-700" : "text-[#008C9C]"
                      }`}>
                      {label}
                    </span>
                    <span
                      className={`text-sm ${
                        hasConflict ? "text-yellow-700" : "text-[#008C9C]/80"
                      }`}>
                      {slot.startTime} – {slot.endTime}
                    </span>
                    {hasConflict && (
                      <Badge variant="warning" size="sm">
                        Conflict
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {availabilityConflicts.length > 0 && (
          <Card variant="warning" className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="p-2 bg-yellow-100 rounded-lg">
                <AlertTriangle className="w-4 h-4 text-yellow-700" />
              </div>
              <h3 className="text-sm font-[400] text-yellow-700">
                Scheduling Conflicts ({availabilityConflicts.length})
              </h3>
            </div>
            <div className="space-y-2">
              {availabilityConflicts.map((c) => (
                <div
                  key={c.jobId}
                  className="flex items-center justify-between p-3 rounded-xl bg-white">
                  <div className="flex-1">
                    <p className="text-sm font-[400] text-[#008C9C]">
                      {c.clientName}
                    </p>
                    <p className="text-xs text-[#008C9C]/60">
                      {fmtDate(c.startTime)} at {fmtTime(c.startTime)} · {c.reason}
                    </p>
                  </div>
                  <Button
                    variant="default"
                    size="sm"
                    border={false}
                    href={`/admin/jobs/${c.jobId}`}
                    className="rounded-2xl px-4 py-2.5">
                    View
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    );
  };

  return (
    <div className="relative h-full overflow-y-auto py-8 px-4">
      <div className="relative z-10 max-w-[80rem] w-full mx-auto space-y-6">
        {/* Header Card */}
        <div className="rounded-2xl bg-[#008C9C]/5 p-5">
          {/* Back + Edit row */}
          <div className="flex items-center justify-between mb-5">
            <Link href="/admin/employees">
              <Button
                variant="ghost"
                size="sm"
                border={false}
                className="-ml-1 px-3 py-2">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Employees
              </Button>
            </Link>
            <Button
              variant="primary"
              size="md"
              onClick={() => setIsEditModalOpen(true)}
              border={false}
              className="px-6 py-3">
              <Pencil className="w-4 h-4 mr-2" />
              Edit Employee
            </Button>
          </div>

          {/* Employee identity */}
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-[#008C9C]/10 flex items-center justify-center shrink-0">
              <User className="w-7 h-7 text-[#008C9C]" />
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-3xl !font-light tracking-tight text-[#008C9C]">
                  {employee.name}
                </h1>
                {getRoleBadge(employee.role)}
              </div>
              <div className="flex flex-col sm:flex-row gap-4 text-[#008C9C]/70 mt-2">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  <span className="text-sm">{employee.email}</span>
                </div>
                {employee.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4" />
                    <span className="text-sm">{employee.phone}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <MetricCard
            label="Jobs Completed"
            value={String(stats.completedJobsCount)}
          />
          <MetricCard
            label="Total Revenue"
            value={`$${stats.totalRevenue.toFixed(2)}`}
          />
          <MetricCard
            label="Employee Pay"
            value={`$${stats.totalPaid.toFixed(2)}`}
            subValue={
              stats.totalTips > 0
                ? `+ $${stats.totalTips.toFixed(2)} tips`
                : undefined
            }
          />
          {stats.unpaidJobs > 0 && (
            <MetricCard
              label="Unpaid Jobs"
              value={String(stats.unpaidJobs)}
              variant="warning"
            />
          )}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 bg-[#008C9C]/5 rounded-2xl p-1 w-fit overflow-x-auto">
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
          {activeView === "jobs" && <JobsTab />}
          {activeView === "products" && <ProductsTab />}
          {activeView === "availability" && <AvailabilityTabContent />}
          {activeView === "accountability" && (
            <StrikesPanel
              cleanerId={employee.id}
              strikes={strikes}
              strikeSummary={strikeSummary}
              strikeWindowDays={strikeWindowDays}
            />
          )}
        </div>
      </div>

      {/* Edit Modal. Seeded from the live category state, not the server prop —
          the modal submits the picker, so handing it a stale (or empty) list
          would silently clear a restriction set from the card above. */}
      <EmployeeModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        employee={{ ...employee, allowedServiceCategories: categories }}
        mode="edit"
      />

      {/* Kit Assignment Modal */}
      <Modal
        isOpen={kitModalOpen}
        onClose={() => {
          setKitModalOpen(false);
          setSelectedKitId("");
          setKitMessage(null);
        }}
        title="Assign Starter Kit">
        <div className="space-y-4">
          <p className="text-sm text-[#008C9C]/70">
            Select a kit template to assign products to {employee.name}.
            Warehouse stock will be deducted accordingly.
          </p>

          <PremiumSelect
            value={selectedKitId}
            onChange={(v) => {
              setSelectedKitId(v);
              setKitMessage(null);
            }}
            options={[
              { value: "", label: "Select a kit template..." },
              ...kitTemplates.map((kit) => ({
                value: kit.id,
                label: `${kit.name} (${kit.items.length} items)`,
              })),
            ]}
            size="md"
          />

          {selectedKit && (
            <div className="bg-[#008C9C]/5 rounded-xl p-4 space-y-2">
              <h4 className="text-sm font-[400] text-[#008C9C]">Kit Contents:</h4>
              {selectedKit.items.map((item) => {
                const hasStock = item.warehouseStock >= item.quantity;
                return (
                  <div
                    key={item.productId}
                    className={`flex items-center justify-between text-xs p-2 rounded-lg ${
                      hasStock ? "bg-white" : "bg-red-50"
                    }`}>
                    <span className={hasStock ? "text-[#008C9C]" : "text-red-600"}>
                      {item.productName}
                    </span>
                    <span className={hasStock ? "text-[#008C9C]/70" : "text-red-500"}>
                      {item.quantity} {item.unit}
                      {!hasStock && ` (only ${item.warehouseStock} in stock)`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {kitMessage && (
            <div
              className={`p-3 rounded-xl text-sm ${
                kitMessage.type === "success"
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : "bg-red-50 text-red-700 border border-red-200"
              }`}>
              {kitMessage.text}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              variant="default"
              size="md"
              border={false}
              onClick={() => {
                setKitModalOpen(false);
                setSelectedKitId("");
                setKitMessage(null);
              }}
              className="px-6 py-3">
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              border={false}
              onClick={handleAssignKit}
              disabled={assigning || !selectedKitId}
              className="px-6 py-3">
              {assigning ? "Assigning..." : "Assign Kit"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
