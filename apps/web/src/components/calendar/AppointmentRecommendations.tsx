"use client";

import React from "react";

interface AppointmentRecommendationsProps {
  recommendations: any[];
  onSelect: (recommendation: any) => void;
  isLoading: boolean;
  targetDate: Date | null;
}

export default function AppointmentRecommendations({
  recommendations,
  onSelect,
  isLoading,
  targetDate,
}: AppointmentRecommendationsProps) {
  if (isLoading) {
    return (
      <div className="text-sm text-[var(--primary)]/60">Loading recommendations...</div>
    );
  }

  if (recommendations.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {recommendations.map((rec, idx) => (
        <div
          key={idx}
          className="p-2 rounded-lg bg-[var(--primary)]/5 hover:bg-[var(--primary)]/10 cursor-pointer"
          onClick={() => onSelect(rec)}>
          {rec.time}
        </div>
      ))}
    </div>
  );
}

