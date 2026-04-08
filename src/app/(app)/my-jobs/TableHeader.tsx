"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { useJobsLoading } from "./JobsLoadingContext";

interface TableHeaderProps {
  label: string;
  sortKey: string;
  className?: string;
}

export function TableHeader({
  label,
  sortKey,
  className = "",
}: TableHeaderProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const { setLoading } = useJobsLoading();

  const currentSortBy = searchParams.get("sortBy") || "jobDate";
  const currentSortOrder = searchParams.get("sortOrder") || "asc";

  const isActive = currentSortBy === sortKey;

  const handleSort = () => {
    const params = new URLSearchParams(searchParams.toString());

    // Toggle sort order if clicking the same column, otherwise default to asc
    const newSortOrder =
      isActive && currentSortOrder === "asc" ? "desc" : "asc";

    params.set("sortBy", sortKey);
    params.set("sortOrder", newSortOrder);

    // Reset cursor when sorting changes
    params.delete("cursor");
    params.delete("direction");

    setLoading(true);
    startTransition(() => {
      router.push(`/my-jobs?${params.toString()}`);
    });
  };

  return (
    <button
      onClick={handleSort}
      disabled={isPending}
      className={`px-2 py-3 text-left flex items-center gap-2 hover:bg-gray-100/50 transition-colors group ${className}`}>
      <span className="text-xs font-[400] text-gray-500 uppercase tracking-wider">
        {label}
      </span>
      <span className="text-gray-400 group-hover:text-gray-600">
        {isActive ? (
          currentSortOrder === "asc" ? (
            <ArrowUp size={14} className="text-blue-600" />
          ) : (
            <ArrowDown size={14} className="text-blue-600" />
          )
        ) : (
          <ArrowUpDown
            size={14}
            className="opacity-0 group-hover:opacity-100"
          />
        )}
      </span>
    </button>
  );
}
