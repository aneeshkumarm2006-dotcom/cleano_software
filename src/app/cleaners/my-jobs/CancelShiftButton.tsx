"use client";

import { useState } from "react";
import { AlertTriangle, XCircle } from "lucide-react";
import { cancelShift } from "@/app/admin/actions/cancelShift";

interface Props {
  jobId: string;
  shiftStartTime: Date | string;
}

export default function CancelShiftButton({ jobId, shiftStartTime }: Props) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = new Date(shiftStartTime);
  const hoursUntil = (start.getTime() - Date.now()) / (1000 * 60 * 60);
  const isLateCancellation = hoursUntil < 24 && hoursUntil > 0;

  async function handleConfirm() {
    setLoading(true);
    setError(null);
    const res = await cancelShift(jobId);
    setLoading(false);
    if (res.success) {
      setDone(true);
    } else {
      setError(res.error);
    }
  }

  if (done) {
    return (
      <span style={{ fontSize: 13, color: "var(--emerald-600)", fontWeight: 600 }}>
        Shift cancelled.
      </span>
    );
  }

  if (!showConfirm) {
    return (
      <button className="cl-jd-cancel-btn" onClick={() => setShowConfirm(true)}>
        <XCircle size={12} />
        Cancel shift
      </button>
    );
  }

  return (
    <div style={{
      background: "rgba(220,38,38,0.04)", border: "1px solid rgba(220,38,38,0.18)",
      borderRadius: 14, padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10,
    }}>
      {isLateCancellation && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "#b91c1c" }}>
          <AlertTriangle size={15} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>
            <strong>Late cancellation:</strong> A $20 fee and a 1-star penalty will be applied.
          </span>
        </div>
      )}
      <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: 0 }}>
        Are you sure you want to cancel this shift? This cannot be undone.
      </p>
      {error && <p style={{ fontSize: 13, color: "var(--error)", margin: 0 }}>{error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => setShowConfirm(false)}
          disabled={loading}
          style={{
            background: "none", border: "1px solid var(--primary-10)", borderRadius: 999,
            padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer",
            color: "var(--primary-70)", fontFamily: "inherit",
          }}>
          Keep shift
        </button>
        <button
          onClick={handleConfirm}
          disabled={loading}
          style={{
            background: "#dc2626", color: "#fff", border: 0, borderRadius: 999,
            padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer",
            fontFamily: "inherit", opacity: loading ? 0.6 : 1,
          }}>
          {loading ? "Cancelling…" : isLateCancellation ? "Cancel anyway" : "Confirm"}
        </button>
      </div>
    </div>
  );
}
