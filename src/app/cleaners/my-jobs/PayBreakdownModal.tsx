"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/ui/Modal";
import { Info } from "lucide-react";
import { getPayBreakdown } from "@/app/admin/actions/getPayBreakdown";
import type { PayBreakdown } from "@/app/admin/actions/getPayBreakdown.types";

interface PayBreakdownModalProps {
  jobId: string;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Cleaner-facing pay view (item 1). This modal lives on the cleaner app, so it
 * only ever renders what a cleaner is allowed to see: their payout, their tip
 * share, and the hourly rate on HOURLY jobs.
 *
 * The client charges, base price, discounts, tier name, "% of price" and the
 * split-pool mechanics are no longer in the payload at all — getPayBreakdown
 * redacts them server-side for non-admins.
 */
export default function PayBreakdownModal({
  jobId,
  isOpen,
  onClose,
}: PayBreakdownModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PayBreakdown | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    getPayBreakdown(jobId).then((result) => {
      if (cancelled) return;
      if (result.success) {
        setData(result.breakdown);
      } else {
        setError(result.error);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [jobId, isOpen]);

  // Both payload shapes carry the payout fields; nothing else is rendered here,
  // so an admin opening this view sees the same cleaner-safe summary.
  const hourlyRate = data?.payType === "HOURLY" ? data.hourlyRate : null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Your pay">
      {loading && (
        <div className="py-8 text-center text-sm text-gray-500">
          Loading your pay...
        </div>
      )}

      {error && (
        <div className="py-6 text-center text-sm text-red-600">{error}</div>
      )}

      {data && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-[#008C9C]/10 px-4 py-4 flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-sm font-[500] text-gray-900">Your pay</span>
              <span className="text-xs text-gray-500">{data.clientName}</span>
            </div>
            <span className="text-xl font-[500] text-[#008C9C]">
              ${data.totalEmployeePay.toFixed(2)}
            </span>
          </div>

          {hourlyRate != null && (
            <Row label="Hourly rate" value={`$${hourlyRate.toFixed(2)}/hr`} />
          )}

          {data.tipShare > 0 && (
            <Row
              label="Includes your tip share"
              value={`$${data.tipShare.toFixed(2)}`}
              valueClass="text-green-600"
            />
          )}

          <div className="flex items-start gap-2 text-xs text-gray-500 bg-gray-50 rounded-xl p-3">
            <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <p>
              Tips are divided equally among the lead and all assigned cleaners.
              Final pay may adjust based on actual job completion and admin
              review.
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Row({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex justify-between items-center px-3 py-2 rounded-xl bg-gray-50">
      <span className="text-sm text-gray-700">{label}</span>
      <span className={`text-sm font-[400] ${valueClass ?? "text-gray-900"}`}>
        {value}
      </span>
    </div>
  );
}
