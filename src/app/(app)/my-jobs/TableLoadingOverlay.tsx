"use client";

import { useJobsLoading } from "./JobsLoadingContext";

export function TableLoadingOverlay() {
  const { loading } = useJobsLoading();

  if (!loading) return null;

  return (
    <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] z-10 flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
    </div>
  );
}

