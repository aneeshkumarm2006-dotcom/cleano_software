"use client";

import { useState } from "react";
import { LogIn } from "lucide-react";
import { useRouter } from "next/navigation";
import { clockIn } from "@/app/admin/actions/clockIn";

interface ClockInButtonProps {
  jobId: string;
  jobStartTime: Date | null;
  disabled?: boolean;
}

export default function ClockInButton({
  jobId,
  disabled = false,
}: ClockInButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleClockIn() {
    setLoading(true);
    try {
      const result = await clockIn(jobId);
      if (result.success) {
        router.push(`/cleaners/my-jobs/${jobId}/clock`);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      className="cl-jd-clock"
      onClick={handleClockIn}
      disabled={disabled || loading}>
      <LogIn size={13} />
      {loading ? "Clocking in…" : "Clock in"}
    </button>
  );
}
