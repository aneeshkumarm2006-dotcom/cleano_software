"use client";

import { useState } from "react";
import { AlertTriangle, LogIn, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { clockIn } from "@/app/admin/actions/clockIn";
import { shortStaffedNotice, type JobStaffing } from "@/lib/cleaner-jobs";

interface ClockInButtonProps {
  jobId: string;
  jobStartTime: Date | null;
  disabled?: boolean;
  /**
   * True when this cleaner already has closed sessions on the job — so this is
   * a return, not an arrival (awerfixes.pdf item 6). Only the label and icon
   * change; the action is the same, and the server decides what a resume means.
   */
  resume?: boolean;
  /**
   * Crew head-count vs `requiredCleaners` (Sept 3 fix 4). ADVISORY: when the job
   * is short the first tap opens a confirm instead of firing, and that is the
   * whole of it — the second tap always goes through.
   */
  staffing?: JobStaffing;
}

export default function ClockInButton({
  jobId,
  disabled = false,
  resume = false,
  staffing,
}: ClockInButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const isShort = !!staffing?.isShort;

  async function handleClockIn() {
    setLoading(true);
    setError(null);
    try {
      const result = await clockIn(jobId);
      if (result.success) {
        router.push(`/cleaners/my-jobs/${jobId}/clock`);
      } else {
        // Previously discarded: a refused clock-in (too early, job paid,
        // already running) looked exactly like a button that did nothing.
        setError(result.error ?? "Could not clock in.");
      }
    } finally {
      setLoading(false);
    }
  }

  // Short-staffed jobs get one confirm step in place of the single tap. Amber,
  // not red, and worded as a heads-up: the crew is thin, not the job refused.
  if (confirming && staffing) {
    return (
      <div
        style={{
          background: "#fffbeb",
          border: "1px solid #fde68a",
          borderRadius: 14,
          padding: "14px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            fontSize: 13,
            lineHeight: 1.5,
            color: "#b45309",
          }}>
          <AlertTriangle size={15} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>
            <strong>Short-staffed.</strong> {shortStaffedNotice(staffing)} Let
            your admin know if you need help.
          </span>
        </div>
        {error && (
          <p style={{ fontSize: 13, color: "var(--error)", margin: 0 }}>{error}</p>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setConfirming(false)}
            disabled={loading}
            style={{
              background: "none",
              border: "1px solid var(--primary-10)",
              borderRadius: 999,
              padding: "7px 16px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              color: "var(--primary-70)",
              fontFamily: "inherit",
            }}>
            Not yet
          </button>
          <button
            onClick={handleClockIn}
            disabled={loading}
            style={{
              background: "#b45309",
              color: "#fff",
              border: 0,
              borderRadius: 999,
              padding: "7px 16px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              opacity: loading ? 0.6 : 1,
            }}>
            {loading ? "Clocking in…" : "Clock in anyway"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <button
        className="cl-jd-clock"
        onClick={isShort ? () => setConfirming(true) : handleClockIn}
        disabled={disabled || loading}>
        {resume ? <RotateCcw size={13} /> : <LogIn size={13} />}
        {loading
          ? "Clocking in…"
          : resume
            ? "Clock back in"
            : "Clock in"}
      </button>
      {error && (
        <span style={{ fontSize: 11, color: "#dc2626", marginLeft: 8 }}>
          {error}
        </span>
      )}
    </>
  );
}
