"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader, Check, X, DollarSign } from "lucide-react";
import Button from "@/components/ui/Button";
import PayoutEditor from "./PayoutEditor";
import { approvePayPeriod } from "../actions/approvePayPeriod";
import { completePayPeriod } from "../actions/completePayPeriod";
import { cancelPayPeriod } from "../actions/cancelPayPeriod";
import { PayPeriodRow } from "./PayoutsPageClient";

interface Props {
  period: PayPeriodRow;
  onError?: (msg: string) => void;
}

export default function PayPeriodDetail({ period, onError }: Props) {
  const router = useRouter();
  const [actionLoading, setActionLoading] = useState(false);

  const locked = period.status === "PAID" || period.status === "CANCELLED";
  const canApprove = period.status === "DRAFT";
  const canComplete = period.status === "APPROVED";
  const canCancel = period.status !== "PAID" && period.status !== "CANCELLED";

  const run = async (
    fn: (id: string) => Promise<{ error?: string; success?: boolean }>,
    confirmText: string
  ) => {
    if (!confirm(confirmText)) return;
    setActionLoading(true);
    const result = await fn(period.id);
    setActionLoading(false);
    if (result.error) onError?.(result.error);
    else router.refresh();
  };

  return (
    <div className="p-5 bg-[#005F6A]/2">
      {period.payouts.length === 0 ? (
        <p className="text-sm text-[#005F6A]/60 text-center py-6">
          No payouts in this period
        </p>
      ) : (
        <div className="space-y-2">
          {period.payouts.map((pay) => (
            <PayoutEditor key={pay.id} payout={pay} locked={locked} />
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-5 justify-end">
        {canApprove && (
          <Button
            variant="primary"
            size="sm"
            border={false}
            disabled={actionLoading}
            onClick={() =>
              run(
                approvePayPeriod,
                "Approve this pay period? Payouts will be locked."
              )
            }
            className="rounded-2xl px-4 py-2">
            {actionLoading ? (
              <Loader className="w-3 h-3 mr-1 animate-spin" />
            ) : (
              <Check className="w-3 h-3 mr-1" />
            )}
            Approve
          </Button>
        )}
        {canComplete && (
          <Button
            variant="primary"
            size="sm"
            border={false}
            disabled={actionLoading}
            onClick={() =>
              run(completePayPeriod, "Mark this pay period as PAID?")
            }
            className="rounded-2xl px-4 py-2">
            {actionLoading ? (
              <Loader className="w-3 h-3 mr-1 animate-spin" />
            ) : (
              <DollarSign className="w-3 h-3 mr-1" />
            )}
            Mark Paid
          </Button>
        )}
        {canCancel && (
          <Button
            variant="destructive"
            size="sm"
            border={false}
            disabled={actionLoading}
            onClick={() => run(cancelPayPeriod, "Cancel this pay period?")}
            className="rounded-2xl px-4 py-2">
            <X className="w-3 h-3 mr-1" />
            Cancel Period
          </Button>
        )}
      </div>

      {(period.approvedAt || period.paidAt) && (
        <div className="mt-4 pt-4 border-t border-[#005F6A]/10 text-xs text-[#005F6A]/60 space-y-1">
          {period.approvedAt && (
            <p>
              Approved {new Date(period.approvedAt).toLocaleDateString()}
              {period.approvedBy && ` by ${period.approvedBy.name}`}
            </p>
          )}
          {period.paidAt && (
            <p>Paid {new Date(period.paidAt).toLocaleDateString()}</p>
          )}
        </div>
      )}
    </div>
  );
}
