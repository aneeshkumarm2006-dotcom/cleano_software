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
} from "lucide-react";
import StrikesPanel from "./StrikesPanel";
import type { StrikeLevel } from "@/lib/strikes-constants";
import type { StrikeReason } from "@prisma/client";

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
  usagePerJob: number;
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
  upcomingJobs: Job[];
  recentJobs: Job[];
  topProducts: ProductUsage[];
  assignedProducts: AssignedProduct[];
  kitTemplates: KitTemplate[];
  forecast: ForecastItem[];
  upcomingJobCount: number;
  availability: AvailabilitySlot[];
  availabilityConflicts: AvailabilityConflict[];
  strikes: StrikeDTO[];
  strikeSummary: { activeCount: number; level: StrikeLevel };
  strikeWindowDays: number;
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

export default function EmployeeDetailView({
  employee,
  stats,
  starRating,
  upcomingJobs,
  recentJobs,
  topProducts,
  assignedProducts,
  kitTemplates,
  forecast,
  upcomingJobCount,
  availability,
  availabilityConflicts,
  strikes,
  strikeSummary,
  strikeWindowDays,
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
        ? `/employees/${employee.id}?${query}`
        : `/employees/${employee.id}`,
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
            variant === "warning" ? "text-yellow-700" : "!text-[#005F6A]/70"
          }`}>
          {label}
        </span>
        <div>
          <p
            className={`h2-title ${
              variant === "warning" ? "text-yellow-700" : "text-[#005F6A]"
            }`}>
            {value}
          </p>
          {subValue && (
            <p className="text-xs text-[#005F6A]/60 mt-0.5">{subValue}</p>
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
                  {Math.min(5, Math.max(4, Math.round(starRating * 10) / 10)).toFixed(1)}
                </span>
              ) : (
                <span className="text-sm text-gray-400">No rating yet</span>
              )}
              {starRating != null && (
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star
                      key={s}
                      className={`w-4 h-4 ${s <= Math.round(Math.min(5, Math.max(4, starRating))) ? "text-amber-400 fill-amber-400" : "text-gray-200 fill-gray-200"}`}
                    />
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="4.0"
                max="5.0"
                step="0.1"
                value={ratingEdit}
                onChange={(e) => setRatingEdit(e.target.value)}
                placeholder="4.0 – 5.0"
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-28 focus:outline-none focus:ring-1 focus:ring-[#005F6A]"
              />
              <button
                onClick={async () => {
                  const val = parseFloat(ratingEdit);
                  if (isNaN(val) || val < 4 || val > 5) {
                    setRatingMsg({ type: "error", text: "Must be between 4.0 and 5.0" });
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
                className="px-3 py-1.5 text-sm bg-[#005F6A] text-white rounded-lg hover:bg-[#005F6A]/90 disabled:opacity-50">
                {ratingSaving ? "Saving…" : "Set"}
              </button>
            </div>
            {ratingMsg && (
              <p className={`text-xs mt-2 ${ratingMsg.type === "success" ? "text-green-600" : "text-red-500"}`}>
                {ratingMsg.text}
              </p>
            )}
            <p className="text-xs text-gray-400 mt-2">Admin override. Customer ratings also update this average.</p>
          </Card>

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
      <h2 className="text-lg font-[350] tracking-tight text-[#005F6A]">
        Upcoming Jobs
      </h2>
      {upcomingJobs.length === 0 ? (
        <Card variant="ghost" className="p-8">
          <div className="text-center">
            <div className="w-12 h-12 bg-[#005F6A]/5 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Calendar className="w-6 h-6 text-[#005F6A]/40" />
            </div>
            <p className="text-sm text-[#005F6A]/60">No upcoming jobs</p>
          </div>
        </Card>
      ) : (
        <Card variant="default" className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-[#005F6A]/10 rounded-lg">
                <Calendar className="w-4 h-4 text-[#005F6A]" />
              </div>
              <h3 className="text-sm font-[350] text-[#005F6A]/80">
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
                className="flex items-center justify-between p-3 rounded-xl bg-[#005F6A]/5">
                <div className="flex-1">
                  <p className="text-sm font-[400] text-[#005F6A]">
                    {job.clientName}
                  </p>
                  <p className="text-xs text-[#005F6A]/60">
                    {new Date(job.startTime).toLocaleDateString("en-US")} at{" "}
                    {new Date(job.startTime).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {job.jobType && (
                    <Badge variant="cleano" size="sm">
                      {job.jobType}
                    </Badge>
                  )}
                  {job.price && (
                    <span className="text-sm font-[400] text-[#005F6A]">
                      ${job.price.toFixed(2)}
                    </span>
                  )}
                  <Button
                    variant="default"
                    size="sm"
                    border={false}
                    href={`/jobs/${job.id}`}
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
      <h2 className="input-label !text-[#005F6A]/70 !mb-2">Recent Jobs</h2>
      {recentJobs.length === 0 ? (
        <Card variant="ghost" className="p-8">
          <div className="text-center">
            <div className="w-12 h-12 bg-[#005F6A]/5 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <History className="w-6 h-6 text-[#005F6A]/40" />
            </div>
            <p className="text-sm text-[#005F6A]/60">No recent jobs</p>
          </div>
        </Card>
      ) : (
        <Card variant="ghost" className="!p-0">
          <div className="space-y-2">
            {recentJobs.map((job) => (
              <div
                key={job.id}
                className="flex items-center justify-between p-3 rounded-xl bg-[#005F6A]/2">
                <div className="flex-1">
                  <p className="app-title-small text-[#005F6A]">
                    {job.clientName}
                  </p>
                  <p className="app-subtitle !text-[#005F6A]/60">
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
                    <span className="text-sm font-[400] text-[#005F6A]">
                      ${job.price.toFixed(2)}
                    </span>
                  )}
                  <Button
                    variant="default"
                    size="sm"
                    border={false}
                    href={`/jobs/${job.id}`}
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
        <h2 className="text-lg font-[350] tracking-tight text-[#005F6A]">
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

      {/* Inventory Forecast */}
      {forecast.length > 0 && (
        <Card variant="default" className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-[#005F6A]/10 rounded-lg">
              <TrendingDown className="w-4 h-4 text-[#005F6A]" />
            </div>
            <h3 className="text-sm font-[350] text-[#005F6A]/80">
              Inventory Forecast ({upcomingJobCount} upcoming job{upcomingJobCount !== 1 ? "s" : ""})
            </h3>
          </div>
          <div className="space-y-2">
            {forecast.map((item) => (
              <div
                key={item.productId}
                className={`flex items-center justify-between p-3 rounded-xl ${
                  item.needsRefill ? "bg-red-50 border border-red-200" : "bg-[#005F6A]/5"
                }`}>
                <div className="flex-1">
                  <p className={`text-sm font-[400] ${item.needsRefill ? "text-red-700" : "text-[#005F6A]"}`}>
                    {item.productName}
                  </p>
                  <p className={`text-xs ${item.needsRefill ? "text-red-500" : "text-[#005F6A]/60"}`}>
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
      <h2 className="text-lg font-[350] tracking-tight text-[#005F6A]">
        Most Used Products
      </h2>
      {topProducts.length === 0 ? (
        <Card variant="ghost" className="p-8">
          <div className="text-center">
            <div className="w-12 h-12 bg-[#005F6A]/5 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Package className="w-6 h-6 text-[#005F6A]/40" />
            </div>
            <p className="text-sm text-[#005F6A]/60">No usage data yet</p>
          </div>
        </Card>
      ) : (
        <Card variant="default" className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 bg-[#005F6A]/10 rounded-lg">
              <Package className="w-4 h-4 text-[#005F6A]" />
            </div>
            <h3 className="text-sm font-[350] text-[#005F6A]/80">
              Product Usage
            </h3>
          </div>
          <div className="space-y-2">
            {topProducts.map((product, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-3 rounded-xl bg-[#005F6A]/5">
                <div className="flex-1">
                  <p className="text-sm font-[400] text-[#005F6A]">
                    {product.name}
                  </p>
                  <p className="text-xs text-[#005F6A]/60">
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
      <h2 className="text-lg font-[350] tracking-tight text-[#005F6A]">
        Assigned Inventory
      </h2>
      {assignedProducts.length === 0 ? (
        <Card variant="ghost" className="p-8">
          <div className="text-center">
            <div className="w-12 h-12 bg-[#005F6A]/5 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Briefcase className="w-6 h-6 text-[#005F6A]/40" />
            </div>
            <p className="text-sm text-[#005F6A]/60">No inventory assigned</p>
          </div>
        </Card>
      ) : (
        <Card variant="default" className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-[#005F6A]/10 rounded-lg">
                <Briefcase className="w-4 h-4 text-[#005F6A]" />
              </div>
              <h3 className="text-sm font-[350] text-[#005F6A]/80">
                Current Inventory
              </h3>
            </div>
            <Badge variant="cleano" size="sm">
              {assignedProducts.length} items
            </Badge>
          </div>
          <div className="space-y-2">
            {assignedProducts.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-3 rounded-xl bg-[#005F6A]/5">
                <div className="flex-1">
                  <p className="text-sm font-[400] text-[#005F6A]">
                    {item.productName}
                  </p>
                  <p className="text-xs text-[#005F6A]/60">
                    {item.quantity} {item.unit}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-[400] text-[#005F6A]">
                    ${(item.quantity * item.costPerUnit).toFixed(2)}
                  </span>
                  <Button
                    variant="default"
                    size="sm"
                    border={false}
                    href={`/inventory/${item.productId}`}
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
          <h2 className="text-lg font-[350] tracking-tight text-[#005F6A] mb-2">
            Weekly Availability
          </h2>
          <p className="text-sm text-[#005F6A]/60">
            Days and hours {employee.name} is typically available.
          </p>
        </div>

        {availability.length === 0 ? (
          <Card variant="ghost" className="p-8">
            <div className="text-center">
              <div className="w-12 h-12 bg-[#005F6A]/5 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Calendar className="w-6 h-6 text-[#005F6A]/40" />
              </div>
              <p className="text-sm text-[#005F6A]/60">
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
                      className="grid grid-cols-[120px_1fr] gap-3 items-center p-3 rounded-xl bg-[#005F6A]/5">
                      <span className="text-sm font-[400] text-[#005F6A]/60">
                        {label}
                      </span>
                      <span className="text-xs text-[#005F6A]/50">
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
                        : "bg-[#005F6A]/5"
                    }`}>
                    <span
                      className={`text-sm font-[400] ${
                        hasConflict ? "text-yellow-700" : "text-[#005F6A]"
                      }`}>
                      {label}
                    </span>
                    <span
                      className={`text-sm ${
                        hasConflict ? "text-yellow-700" : "text-[#005F6A]/80"
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
                    <p className="text-sm font-[400] text-[#005F6A]">
                      {c.clientName}
                    </p>
                    <p className="text-xs text-[#005F6A]/60">
                      {new Date(c.startTime).toLocaleDateString("en-US")} at{" "}
                      {new Date(c.startTime).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      · {c.reason}
                    </p>
                  </div>
                  <Button
                    variant="default"
                    size="sm"
                    border={false}
                    href={`/jobs/${c.jobId}`}
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
        <div className="rounded-2xl bg-[#005F6A]/5 p-5">
          {/* Back + Edit row */}
          <div className="flex items-center justify-between mb-5">
            <Link href="/employees">
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
            <div className="w-14 h-14 rounded-2xl bg-[#005F6A]/10 flex items-center justify-center shrink-0">
              <User className="w-7 h-7 text-[#005F6A]" />
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-3xl !font-light tracking-tight text-[#005F6A]">
                  {employee.name}
                </h1>
                {getRoleBadge(employee.role)}
              </div>
              <div className="flex flex-col sm:flex-row gap-4 text-[#005F6A]/70 mt-2">
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

      {/* Edit Modal */}
      <EmployeeModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        employee={employee}
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
          <p className="text-sm text-[#005F6A]/70">
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
            <div className="bg-[#005F6A]/5 rounded-xl p-4 space-y-2">
              <h4 className="text-sm font-[400] text-[#005F6A]">Kit Contents:</h4>
              {selectedKit.items.map((item) => {
                const hasStock = item.warehouseStock >= item.quantity;
                return (
                  <div
                    key={item.productId}
                    className={`flex items-center justify-between text-xs p-2 rounded-lg ${
                      hasStock ? "bg-white" : "bg-red-50"
                    }`}>
                    <span className={hasStock ? "text-[#005F6A]" : "text-red-600"}>
                      {item.productName}
                    </span>
                    <span className={hasStock ? "text-[#005F6A]/70" : "text-red-500"}>
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
