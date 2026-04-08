"use client";

import { useState, useEffect } from "react";
import Button from "@/components/ui/Button";
import { LogIn, Clock } from "lucide-react";
import { clockIn } from "../actions/clockIn";

interface ClockInButtonProps {
  jobId: string;
  jobStartTime: Date;
  disabled?: boolean;
}

export default function ClockInButton({
  jobId,
  jobStartTime,
  disabled = false,
}: ClockInButtonProps) {
  const [loading, setLoading] = useState(false);
  const [canClockIn, setCanClockIn] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<string>("");

  useEffect(() => {
    const checkTime = () => {
      const now = new Date();
      const startTime = new Date(jobStartTime);
      const fifteenMinutesBefore = new Date(startTime.getTime() - 15 * 60 * 1000);
      
      if (now >= fifteenMinutesBefore) {
        setCanClockIn(true);
        setTimeRemaining("");
      } else {
        setCanClockIn(false);
        const minutesUntil = Math.ceil((fifteenMinutesBefore.getTime() - now.getTime()) / (60 * 1000));
        setTimeRemaining(`${minutesUntil}m until clock-in`);
      }
    };

    // Check immediately
    checkTime();

    // Check every 30 seconds
    const interval = setInterval(checkTime, 30000);

    return () => clearInterval(interval);
  }, [jobStartTime]);

  const handleClockIn = async () => {
    if (disabled || !canClockIn) return;

    setLoading(true);
    try {
      const result = await clockIn(jobId);
      if (!result.success) {
        alert(result.error || "Failed to clock in");
      }
    } catch (error) {
      console.error("Error clocking in:", error);
      alert("Failed to clock in");
    } finally {
      setLoading(false);
    }
  };

  if (!canClockIn && !disabled) {
    return (
      <Button
        variant="secondary"
        size="md"
        disabled={true}
        className="flex-1">
        <Clock className="w-4 h-4 mr-2" />
        {timeRemaining}
      </Button>
    );
  }

  return (
    <Button
      variant="primary"
      size="md"
      onClick={handleClockIn}
      loading={loading}
      disabled={disabled || !canClockIn}
      className="flex-1">
      <LogIn className="w-4 h-4 mr-2" />
      Clock In
    </Button>
  );
}

