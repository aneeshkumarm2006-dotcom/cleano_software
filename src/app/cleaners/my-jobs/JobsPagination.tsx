"use client";

import { useSearchParams } from "next/navigation";
import { useJobsLoading } from "./JobsLoadingContext";

interface JobsPaginationProps {
  hasNextPage: boolean;
  hasPrevPage: boolean;
  nextCursor?: string | null;
  prevCursor?: string | null;
  currentCount: number;
  perPage: number;
  minDisplayRows: number;
}

export function JobsPagination({
  hasNextPage,
  hasPrevPage,
  nextCursor,
  prevCursor,
  currentCount,
  perPage,
  minDisplayRows,
}: JobsPaginationProps) {
  const searchParams = useSearchParams();
  const { setLoading } = useJobsLoading();

  const buildUrl = (cursor: string | null, direction: "next" | "prev") => {
    const params = new URLSearchParams(searchParams.toString());

    if (cursor) {
      params.set("cursor", cursor);
      params.set("direction", direction);
    } else {
      params.delete("cursor");
      params.delete("direction");
    }

    return `/cleaners/my-jobs?${params.toString()}`;
  };

  // Don't show pagination if there are fewer than minimum display rows and no pagination
  if (currentCount < minDisplayRows && !hasNextPage && !hasPrevPage) {
    return null;
  }

  const currentCursor = searchParams.get("cursor");
  const direction = searchParams.get("direction");

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 0", gap: 12 }}>
      <span style={{ fontSize: 13, color: "var(--primary-60)" }}>
        Showing <strong>{currentCount}</strong> job{currentCount !== 1 ? "s" : ""}
      </span>
      <div style={{ display: "flex", gap: 8 }}>
        {hasPrevPage ? (
          <a href={buildUrl(null, "prev")} className="cl-action-btn" onClick={() => setLoading(true)}>← First</a>
        ) : (
          <button className="cl-action-btn" disabled>← First</button>
        )}
        {hasPrevPage ? (
          <a href={buildUrl(prevCursor || null, "prev")} className="cl-action-btn" onClick={() => setLoading(true)}>Previous</a>
        ) : (
          <button className="cl-action-btn" disabled>Previous</button>
        )}
        {hasNextPage ? (
          <a href={buildUrl(nextCursor || null, "next")} className="cl-action-btn solid" onClick={() => setLoading(true)}>Next →</a>
        ) : (
          <button className="cl-action-btn solid" disabled>Next →</button>
        )}
      </div>
    </div>
  );
}
