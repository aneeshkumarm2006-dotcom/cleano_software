"use client";

import { useState } from "react";
import { LogIn, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { clockIn } from "@/app/admin/actions/clockIn";

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
}

export default function ClockInButton({
  jobId,
  disabled = false,
  resume = false,
}: ClockInButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <>
      <button
        className="cl-jd-clock"
        onClick={handleClockIn}
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
