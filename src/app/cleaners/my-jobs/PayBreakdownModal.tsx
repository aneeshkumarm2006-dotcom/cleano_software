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
  // Only the CLEANER payload carries the rating-boost state — an admin opening
  // this modal gets the ADMIN payload, which has no such field.
  const boost = data?.audience === "CLEANER" ? data.ratingBoost : null;

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

          {/* The rating multiplier, in the cleaner's own terms (awerfixes.pdf
              item 1). A cleaner never sees the job price or their base
              percentage, so the copy states the EFFECT ("+13%") rather than the
              mechanism ("1.13x") — a percentage bonus reads instantly and
              cannot be reverse-engineered into the price. Conditional on
              purpose: on FLAT, HOURLY and manually-set jobs the multiplier does
              not apply, and rendering "1.00x" there would read as a penalty. */}
          {boost?.state === "APPLIED" && (
            <Row
              label={
                boost.averageRating != null
                  ? `Rating bonus · ${boost.averageRating.toFixed(1)}★ average`
                  : "Rating bonus"
              }
              value={`+${Math.round((boost.multiplier - 1) * 100)}%`}
              valueClass="text-[#008C9C]"
            />
          )}

          {boost?.state === "LOCKED" && (
            <Row
              label="Rating bonus"
              value={`${boost.ratingsSoFar} of ${boost.ratingsRequired} ratings`}
              valueClass="text-gray-500"
            />
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
            <div className="space-y-1.5">
              {boost?.state === "APPLIED" && (
                <p>
                  Your customer rating adds{" "}
                  {Math.round((boost.multiplier - 1) * 100)}% on top of your pay
                  for this job. Keep your average up and it goes up with you.
                </p>
              )}
              {boost?.state === "LOCKED" && (
                <p>
                  Once you have {boost.ratingsRequired} customer ratings, your
                  average starts increasing your pay on percentage-paid jobs.
                  You have {boost.ratingsSoFar} so far.
                </p>
              )}
              {boost?.state === "NOT_APPLICABLE" && (
                <p>
                  {boost.reason === "FIXED_AMOUNT"
                    ? "This job pays a set amount agreed with dispatch, so your rating bonus doesn't change it."
                    : boost.reason === "HOURLY"
                      ? "This job pays by the hour, so your rating bonus doesn't change it."
                      : "This job pays a fixed amount, so your rating bonus doesn't change it."}
                </p>
              )}
              <p>
                Tips are divided equally among the lead and all assigned
                cleaners. Final pay may adjust based on actual job completion
                and admin review.
              </p>
            </div>
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
