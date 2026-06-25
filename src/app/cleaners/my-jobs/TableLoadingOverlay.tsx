"use client";

import { useJobsLoading } from "./JobsLoadingContext";
import CleanoLoader from "@/components/ui/CleanoLoader";

export function TableLoadingOverlay() {
  const { loading } = useJobsLoading();

  if (!loading) return null;

  return (
    <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] z-10 flex items-center justify-center">
      <CleanoLoader size={56} label="" />
    </div>
  );
}

