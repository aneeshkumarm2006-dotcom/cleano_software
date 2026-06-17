"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/ui/Modal";
import { DollarSign, Info } from "lucide-react";
import { getPayBreakdown } from "../actions/getPayBreakdown";
import type { PayBreakdown } from "../actions/getPayBreakdown.types";

interface PayBreakdownModalProps {
  jobId: string;
  isOpen: boolean;
  onClose: () => void;
}

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

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Pay Breakdown">
      {loading && (
        <div className="py-8 text-center text-sm text-gray-500">
          Loading breakdown...
        </div>
      )}

      {error && (
        <div className="py-6 text-center text-sm text-red-600">{error}</div>
      )}

      {data && (
        <div className="space-y-6">
          {/* Client total */}
          <section>
            <h3 className="text-xs font-[400] text-gray-500 uppercase tracking-wider mb-3">
              Client Charges
            </h3>
            <div className="space-y-2">
              {data.basePrice !== null && (
                <Row
                  label={
                    data.bedCount !== null && data.bathCount !== null
                      ? `Base price (${data.bedCount} bed · ${data.bathCount} bath)`
                      : "Base price"
                  }
                  value={`$${data.basePrice.toFixed(2)}`}
                  hint={
                    data.basePriceSource === "PRICING_RULE"
                      ? "From pricing rules"
                      : data.basePriceSource === "JOB_PRICE"
                      ? "Derived from job price"
                      : undefined
                  }
                />
              )}
              {data.addOns.length > 0 && (
                <div className="rounded-xl bg-gray-50 px-3 py-2">
                  <div className="text-sm text-gray-600 mb-1.5">Add-Ons</div>
                  <div className="space-y-1">
                    {data.addOns.map((a, idx) => (
                      <div
                        key={idx}
                        className="flex justify-between text-sm">
                        <span className="text-gray-700">{a.name}</span>
                        <span className="text-gray-900">
                          ${a.price.toFixed(2)}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between text-xs pt-1 border-t border-gray-200 text-gray-500">
                      <span>Add-on subtotal</span>
                      <span>${data.addOnsTotal.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              )}
              {data.discount > 0 && (
                <Row
                  label="Discount"
                  value={`- $${data.discount.toFixed(2)}`}
                  valueClass="text-red-600"
                />
              )}
              {data.parking > 0 && (
                <Row
                  label="Parking"
                  value={`$${data.parking.toFixed(2)}`}
                />
              )}
              <Row
                label="Client Total"
                value={`$${data.clientTotal.toFixed(2)}`}
                bold
              />
            </div>
          </section>

          {/* Employee pay */}
          <section>
            <h3 className="text-xs font-[400] text-gray-500 uppercase tracking-wider mb-3">
              Your Pay
            </h3>
            <div className="space-y-2">
              <Row
                label="Base employee pay"
                value={`$${data.employeeBasePay.toFixed(2)}`}
              />
              {data.payMultiplier !== 1 && (
                <>
                  <Row
                    label="Pay multiplier"
                    value={`× ${data.payMultiplier.toFixed(2)}`}
                  />
                  <Row
                    label="Pay after multiplier"
                    value={`$${data.payAfterMultiplier.toFixed(2)}`}
                    subtle
                  />
                </>
              )}
              {data.totalTip > 0 && (
                <>
                  <Row
                    label={`Total tips (split ${data.teamSize} ${
                      data.teamSize === 1 ? "way" : "ways"
                    })`}
                    value={`$${data.totalTip.toFixed(2)}`}
                    subtle
                  />
                  <Row
                    label="Your tip share"
                    value={`+ $${data.tipShare.toFixed(2)}`}
                    valueClass="text-green-600"
                  />
                </>
              )}
              <div className="pt-2 mt-2 border-t border-gray-200">
                <Row
                  label="Total Employee Pay"
                  value={`$${data.totalEmployeePay.toFixed(2)}`}
                  bold
                  highlight
                />
              </div>
            </div>
          </section>

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
  hint,
  bold,
  highlight,
  subtle,
  valueClass,
}: {
  label: string;
  value: string;
  hint?: string;
  bold?: boolean;
  highlight?: boolean;
  subtle?: boolean;
  valueClass?: string;
}) {
  return (
    <div
      className={`flex justify-between items-center px-3 py-2 rounded-xl ${
        highlight ? "bg-[#008C9C]/10" : "bg-gray-50"
      } ${subtle ? "opacity-80" : ""}`}>
      <div className="flex flex-col">
        <span
          className={`text-sm ${
            bold ? "font-[500] text-gray-900" : "text-gray-700"
          }`}>
          {label}
        </span>
        {hint && <span className="text-xs text-gray-400">{hint}</span>}
      </div>
      <span
        className={`text-sm ${
          bold ? "font-[500]" : "font-[400]"
        } ${valueClass ?? (highlight ? "text-[#008C9C]" : "text-gray-900")}`}>
        {value}
      </span>
    </div>
  );
}
