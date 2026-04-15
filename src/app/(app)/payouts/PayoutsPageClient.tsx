"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Wallet,
  Users,
  DollarSign,
  Calendar,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Loader,
  Check,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { createPayPeriod } from "../actions/createPayPeriod";
import PayPeriodDetail from "./PayPeriodDetail";

export type PayoutRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  baseAmount: number;
  adjustments: number;
  deductions: number;
  reimbursements: number;
  finalAmount: number;
  jobCount: number;
  totalHours: number;
  notes: string | null;
};

export type PayPeriodRow = {
  id: string;
  startDate: string;
  endDate: string;
  status: "DRAFT" | "APPROVED" | "PAID" | "CANCELLED";
  notes: string | null;
  approvedAt: string | null;
  approvedBy: { id: string; name: string } | null;
  paidAt: string | null;
  totalFinal: number;
  employeeCount: number;
  payouts: PayoutRow[];
};

interface Props {
  initialPeriods: PayPeriodRow[];
}

const STATUS_STYLES: Record<PayPeriodRow["status"], string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  APPROVED: "bg-blue-50 text-blue-700",
  PAID: "bg-green-50 text-green-700",
  CANCELLED: "bg-red-50 text-red-700",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function PayoutsPageClient({ initialPeriods }: Props) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState(false);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [notes, setNotes] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const stats = useMemo(() => {
    const totalPayouts = initialPeriods.reduce(
      (sum, p) => sum + p.totalFinal,
      0
    );
    const drafts = initialPeriods.filter((p) => p.status === "DRAFT").length;
    const pendingApproval = initialPeriods.filter(
      (p) => p.status === "APPROVED"
    ).length;
    const paidThisYear = initialPeriods
      .filter(
        (p) =>
          p.status === "PAID" &&
          p.paidAt &&
          new Date(p.paidAt).getFullYear() === new Date().getFullYear()
      )
      .reduce((sum, p) => sum + p.totalFinal, 0);
    return { totalPayouts, drafts, pendingApproval, paidThisYear };
  }, [initialPeriods]);

  const handleCreate = async () => {
    setCreating(true);
    setCreateError(null);
    setCreateSuccess(false);

    const fd = new FormData();
    fd.append("startDate", startDate);
    fd.append("endDate", endDate);
    fd.append("notes", notes);

    const result = await createPayPeriod(fd);
    setCreating(false);

    if (result.error) {
      setCreateError(result.error);
    } else {
      setCreateSuccess(true);
      setTimeout(() => {
        setShowCreate(false);
        setCreateSuccess(false);
        setNotes("");
        router.refresh();
      }, 600);
    }
  };

  const MetricCard = ({
    label,
    value,
    variant = "default",
  }: {
    label: string;
    value: string;
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
        <p
          className={`h2-title ${
            variant === "warning" ? "text-yellow-700" : "text-[#005F6A]"
          }`}>
          {value}
        </p>
      </div>
    </Card>
  );

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl !font-light tracking-tight text-[#005F6A]">
            Payouts
          </h1>
          <p className="text-sm text-[#005F6A]/70 !font-light mt-1">
            Create pay periods and manage employee payouts
          </p>
        </div>
        <Button
          variant="primary"
          size="md"
          border={false}
          onClick={() => setShowCreate((v) => !v)}
          className="rounded-2xl px-6 py-3">
          <Plus className="w-4 h-4 mr-2" />
          New Pay Period
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          label="Total Payouts"
          value={`$${stats.totalPayouts.toFixed(2)}`}
        />
        <MetricCard
          label="Paid This Year"
          value={`$${stats.paidThisYear.toFixed(2)}`}
        />
        {stats.drafts > 0 ? (
          <MetricCard
            label="Draft Periods"
            value={String(stats.drafts)}
            variant="warning"
          />
        ) : (
          <MetricCard label="Draft Periods" value="0" />
        )}
        <MetricCard
          label="Awaiting Payment"
          value={String(stats.pendingApproval)}
        />
      </div>

      {errorMsg && (
        <div className="mb-4 rounded-2xl bg-red-50 border border-red-200 p-3 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5" />
          <div className="flex-1 text-sm text-red-700">{errorMsg}</div>
          <button
            className="text-xs text-red-600 underline"
            onClick={() => setErrorMsg(null)}>
            dismiss
          </button>
        </div>
      )}

      {showCreate && (
        <Card variant="cleano_light" className="p-6 mb-6">
          <h2 className="text-lg font-[400] text-[#005F6A] mb-4">
            Create Pay Period
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="input-label tracking-tight">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={creating}
                className="w-full px-4 py-3 rounded-2xl bg-white text-sm text-[#005F6A] focus:outline-none"
              />
            </div>
            <div>
              <label className="input-label tracking-tight">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={creating}
                className="w-full px-4 py-3 rounded-2xl bg-white text-sm text-[#005F6A] focus:outline-none"
              />
            </div>
            <div>
              <label className="input-label tracking-tight">Notes</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={creating}
                placeholder="Optional"
                className="w-full px-4 py-3 rounded-2xl bg-white text-sm text-[#005F6A] focus:outline-none placeholder:text-[#005F6A]/40"
              />
            </div>
          </div>
          {createError && (
            <div className="mt-4 bg-red-50 rounded-2xl p-3">
              <p className="text-xs text-red-600">{createError}</p>
            </div>
          )}
          {createSuccess && (
            <div className="mt-4 bg-green-50 rounded-2xl p-3 flex items-start gap-2">
              <Check className="w-4 h-4 text-green-600 mt-0.5" />
              <p className="text-xs text-green-700">
                Pay period created successfully
              </p>
            </div>
          )}
          <div className="flex gap-3 justify-end mt-4">
            <Button
              variant="default"
              size="md"
              border={false}
              onClick={() => setShowCreate(false)}
              disabled={creating}
              className="px-5 py-3">
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={handleCreate}
              disabled={creating}
              className="px-6 py-3">
              {creating ? (
                <>
                  <Loader className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Create Period
                </>
              )}
            </Button>
          </div>
        </Card>
      )}

      {initialPeriods.length === 0 ? (
        <div className="bg-white rounded-2xl">
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-[#005F6A]/5 rounded-full flex items-center justify-center mx-auto mb-3">
              <Wallet className="w-8 h-8 text-[#005F6A]/40" />
            </div>
            <p className="text-sm font-[350] text-[#005F6A]/70">
              No pay periods yet
            </p>
            <p className="text-xs font-[350] text-[#005F6A]/60 mt-1">
              Create your first pay period to start managing payouts
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {initialPeriods.map((p) => {
            const isExpanded = expandedId === p.id;
            return (
              <div
                key={p.id}
                className="bg-white rounded-2xl border border-[#005F6A]/10 overflow-hidden">
                <div
                  className="p-5 flex items-center justify-between cursor-pointer hover:bg-[#005F6A]/2"
                  onClick={() => setExpandedId(isExpanded ? null : p.id)}>
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-[#005F6A]/5 flex items-center justify-center flex-shrink-0">
                      <Calendar className="w-5 h-5 text-[#005F6A]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="app-title-small text-[#005F6A] font-[400]">
                          {formatDate(p.startDate)} — {formatDate(p.endDate)}
                        </span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-[500] ${STATUS_STYLES[p.status]}`}>
                          {p.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-xs text-[#005F6A]/60">
                        <span className="flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          {p.employeeCount} employees
                        </span>
                        <span className="flex items-center gap-1">
                          <DollarSign className="w-3 h-3" />
                          ${p.totalFinal.toFixed(2)}
                        </span>
                        {p.notes && (
                          <span className="truncate">· {p.notes}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-[#005F6A]/60" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-[#005F6A]/60" />
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-[#005F6A]/10">
                    <PayPeriodDetail period={p} onError={setErrorMsg} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
