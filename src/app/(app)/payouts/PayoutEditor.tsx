"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Loader, Check, X } from "lucide-react";
import Button from "@/components/ui/Button";
import { updatePayout } from "../actions/updatePayout";
import { PayoutRow } from "./PayoutsPageClient";

interface Props {
  payout: PayoutRow;
  locked: boolean;
}

export default function PayoutEditor({ payout, locked }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [base, setBase] = useState(payout.baseAmount.toString());
  const [adj, setAdj] = useState(payout.adjustments.toString());
  const [ded, setDed] = useState(payout.deductions.toString());
  const [reim, setReim] = useState(payout.reimbursements.toString());
  const [notes, setNotes] = useState(payout.notes || "");

  const computedFinal =
    (parseFloat(base) || 0) +
    (parseFloat(adj) || 0) -
    (parseFloat(ded) || 0) +
    (parseFloat(reim) || 0);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    const fd = new FormData();
    fd.append("id", payout.id);
    fd.append("baseAmount", base);
    fd.append("adjustments", adj);
    fd.append("deductions", ded);
    fd.append("reimbursements", reim);
    fd.append("notes", notes);
    const result = await updatePayout(fd);
    setSaving(false);
    if (result.error) {
      setError(result.error);
    } else {
      setEditing(false);
      router.refresh();
    }
  };

  const handleCancel = () => {
    setBase(payout.baseAmount.toString());
    setAdj(payout.adjustments.toString());
    setDed(payout.deductions.toString());
    setReim(payout.reimbursements.toString());
    setNotes(payout.notes || "");
    setError(null);
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className="bg-white rounded-xl p-4 flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-[400] text-[#005F6A] truncate">
              {payout.employeeName}
            </span>
            <span className="text-xs text-[#005F6A]/50">
              {payout.jobCount} jobs · {payout.totalHours.toFixed(1)}h
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-[#005F6A]/60 flex-wrap">
            <span>Base: ${payout.baseAmount.toFixed(2)}</span>
            {payout.adjustments !== 0 && (
              <span className="text-blue-600">
                Adj: ${payout.adjustments.toFixed(2)}
              </span>
            )}
            {payout.deductions !== 0 && (
              <span className="text-red-600">
                Ded: -${payout.deductions.toFixed(2)}
              </span>
            )}
            {payout.reimbursements !== 0 && (
              <span className="text-green-600">
                Reim: ${payout.reimbursements.toFixed(2)}
              </span>
            )}
          </div>
          {payout.notes && (
            <p className="text-xs text-[#005F6A]/50 mt-1 italic">
              {payout.notes}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-lg font-[500] text-[#005F6A]">
            ${payout.finalAmount.toFixed(2)}
          </span>
          {!locked && (
            <Button
              variant="default"
              size="sm"
              border={false}
              onClick={() => setEditing(true)}
              className="rounded-xl px-3 py-2">
              <Pencil className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-[400] text-[#005F6A]">
          {payout.employeeName}
        </span>
        <span className="text-xs text-[#005F6A]/50">
          {payout.jobCount} jobs · {payout.totalHours.toFixed(1)}h
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Base", val: base, set: setBase },
          { label: "Adjustments", val: adj, set: setAdj },
          { label: "Deductions", val: ded, set: setDed },
          { label: "Reimbursements", val: reim, set: setReim },
        ].map((f) => (
          <div key={f.label}>
            <label className="text-[10px] uppercase tracking-wider text-[#005F6A]/50 font-[400]">
              {f.label}
            </label>
            <input
              type="number"
              step="0.01"
              value={f.val}
              onChange={(e) => f.set(e.target.value)}
              disabled={saving}
              className="w-full px-3 py-2 rounded-xl bg-[#005F6A]/5 text-sm text-[#005F6A] focus:outline-none"
            />
          </div>
        ))}
      </div>
      <div className="mt-3">
        <label className="text-[10px] uppercase tracking-wider text-[#005F6A]/50 font-[400]">
          Notes
        </label>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={saving}
          placeholder="Optional notes"
          className="w-full px-3 py-2 rounded-xl bg-[#005F6A]/5 text-sm text-[#005F6A] focus:outline-none placeholder:text-[#005F6A]/40"
        />
      </div>
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-[#005F6A]/10">
        <span className="text-sm text-[#005F6A]/70">
          Final:{" "}
          <span className="text-[#005F6A] font-[500]">
            ${computedFinal.toFixed(2)}
          </span>
        </span>
        <div className="flex gap-2">
          <Button
            variant="default"
            size="sm"
            border={false}
            onClick={handleCancel}
            disabled={saving}
            className="rounded-xl px-3 py-2">
            <X className="w-3 h-3 mr-1" />
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            border={false}
            onClick={handleSave}
            disabled={saving}
            className="rounded-xl px-3 py-2">
            {saving ? (
              <Loader className="w-3 h-3 mr-1 animate-spin" />
            ) : (
              <Check className="w-3 h-3 mr-1" />
            )}
            Save
          </Button>
        </div>
      </div>
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  );
}
