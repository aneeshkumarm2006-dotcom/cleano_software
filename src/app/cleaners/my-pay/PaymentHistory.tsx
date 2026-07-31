"use client";

import { useMemo } from "react";
import { fmtDate } from "@/lib/time";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Calendar,
} from "lucide-react";

type PayoutEntry = {
  kind: "PAYOUT";
  id: string;
  date: Date;
  description: string;
  amount: number;
  status: string;
};

type WithdrawalEntry = {
  kind: "WITHDRAWAL";
  id: string;
  date: Date;
  description: string;
  amount: number;
  status: string;
};

export type HistoryEntry = PayoutEntry | WithdrawalEntry;

interface PaymentHistoryProps {
  payouts: Array<{
    id: string;
    finalAmount: number;
    payPeriod: {
      startDate: Date | string;
      endDate: Date | string;
      status: string;
      paidAt: Date | string | null;
    };
  }>;
  withdrawals: Array<{
    id: string;
    amount: number;
    status: string;
    paymentMethod: string | null;
    createdAt: Date | string;
    processedAt: Date | string | null;
    notes: string | null;
  }>;
}

const PAYOUT_STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  APPROVED: "bg-blue-50 text-blue-700",
  PAID: "bg-green-50 text-green-700",
  CANCELLED: "bg-red-50 text-red-700",
};

const WITHDRAWAL_STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-700",
  APPROVED: "bg-blue-50 text-blue-700",
  REJECTED: "bg-red-50 text-red-700",
  COMPLETED: "bg-green-50 text-green-700",
};

// The four states a cleaner should see on a withdrawal (new fix list item 3).
// The stored enum keeps its own names; only the wording changes here.
const WITHDRAWAL_STATUS_LABELS: Record<string, string> = {
  PENDING: "Requested",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  COMPLETED: "Paid",
};

function formatDate(d: Date) {
  // Business timezone — pay-period dates must not shift a day for cleaners
  // whose browser is in another zone.
  return fmtDate(d, { month: "short", day: "numeric", year: "numeric" });
}

export default function PaymentHistory({
  payouts,
  withdrawals,
}: PaymentHistoryProps) {
  const entries = useMemo<HistoryEntry[]>(() => {
    const payoutEntries: HistoryEntry[] = payouts.map((p) => {
      const startDate =
        p.payPeriod.startDate instanceof Date
          ? p.payPeriod.startDate
          : new Date(p.payPeriod.startDate);
      const endDate =
        p.payPeriod.endDate instanceof Date
          ? p.payPeriod.endDate
          : new Date(p.payPeriod.endDate);
      const paidAt = p.payPeriod.paidAt
        ? p.payPeriod.paidAt instanceof Date
          ? p.payPeriod.paidAt
          : new Date(p.payPeriod.paidAt)
        : null;
      return {
        kind: "PAYOUT",
        id: p.id,
        date: paidAt ?? endDate,
        description: `Payout · ${formatDate(startDate)} – ${formatDate(endDate)}`,
        amount: p.finalAmount,
        status: p.payPeriod.status,
      };
    });

    const withdrawalEntries: HistoryEntry[] = withdrawals.map((w) => {
      const date =
        w.processedAt instanceof Date
          ? w.processedAt
          : w.processedAt
          ? new Date(w.processedAt)
          : w.createdAt instanceof Date
          ? w.createdAt
          : new Date(w.createdAt);
      // The method is blank until an admin picks one when processing.
      const method = w.paymentMethod
        ? w.paymentMethod.replaceAll("_", " ").toLowerCase()
        : null;
      return {
        kind: "WITHDRAWAL",
        id: w.id,
        date,
        description: method ? `Withdrawal · ${method}` : "Withdrawal",
        amount: w.amount,
        status: w.status,
      };
    });

    return [...payoutEntries, ...withdrawalEntries].sort(
      (a, b) => b.date.getTime() - a.date.getTime()
    );
  }, [payouts, withdrawals]);

  // Compute running balance from oldest to newest
  const entriesWithBalance = useMemo(() => {
    const ascending = [...entries].reverse();
    let balance = 0;
    const map = new Map<string, number>();
    for (const e of ascending) {
      if (e.kind === "PAYOUT" && e.status === "PAID") {
        balance += e.amount;
      } else if (
        e.kind === "WITHDRAWAL" &&
        (e.status === "APPROVED" || e.status === "COMPLETED")
      ) {
        balance -= e.amount;
      }
      map.set(e.id, balance);
    }
    return entries.map((e) => ({ ...e, runningBalance: map.get(e.id) ?? 0 }));
  }, [entries]);

  if (entries.length === 0) {
    return (
      <div className="bg-white rounded-2xl">
        <div className="text-center py-12">
          <div className="w-16 h-16 bg-[#008C9C]/5 rounded-full flex items-center justify-center mx-auto mb-3">
            <Banknote className="w-8 h-8 text-[#008C9C]/40" />
          </div>
          <p className="text-sm font-[350] text-[#008C9C]/70">
            No payment activity yet
          </p>
          <p className="text-xs font-[350] text-[#008C9C]/60 mt-1">
            Payouts and withdrawals will appear here
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {entriesWithBalance.map((e) => {
        const isPayout = e.kind === "PAYOUT";
        const statusStyles = isPayout
          ? PAYOUT_STATUS_STYLES[e.status]
          : WITHDRAWAL_STATUS_STYLES[e.status];
        const statusLabel = isPayout
          ? e.status
          : WITHDRAWAL_STATUS_LABELS[e.status] ?? e.status;
        const Icon = isPayout ? ArrowDownLeft : ArrowUpRight;
        const sign = isPayout ? "+" : "−";
        const colorClass = isPayout ? "text-green-600" : "text-red-600";
        return (
          <div
            key={`${e.kind}-${e.id}`}
            className="bg-white rounded-2xl border border-[#008C9C]/10 p-5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0 flex-1">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  isPayout ? "bg-green-50" : "bg-red-50"
                }`}>
                <Icon
                  className={`w-5 h-5 ${
                    isPayout ? "text-green-600" : "text-red-600"
                  }`}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="app-title-small text-[#008C9C] font-[400]">
                    {e.description}
                  </span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-[500] ${statusStyles}`}>
                    {statusLabel}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-[#008C9C]/60">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {formatDate(e.date)}
                  </span>
                </div>
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <p className={`text-lg font-[500] ${colorClass}`}>
                {sign}${e.amount.toFixed(2)}
              </p>
              <p className="text-[10px] text-[#008C9C]/50">
                Balance ${e.runningBalance.toFixed(2)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
