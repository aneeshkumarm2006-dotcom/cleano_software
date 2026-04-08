"use client";

import { useSearchParams } from "next/navigation";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
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

    return `/my-jobs?${params.toString()}`;
  };

  // Don't show pagination if there are fewer than minimum display rows and no pagination
  if (currentCount < minDisplayRows && !hasNextPage && !hasPrevPage) {
    return null;
  }

  const currentCursor = searchParams.get("cursor");
  const direction = searchParams.get("direction");

  return (
    <Card variant="default">
      <div className="space-y-4">
        {/* Results Count */}
        <div className="text-sm text-gray-600 text-center">
          Showing{" "}
          <span className="font-[400] text-gray-900">{currentCount}</span> job
          {currentCount !== 1 ? "s" : ""} per page
          {currentCursor && (
            <span className="ml-2 text-gray-500">
              (Page{" "}
              {direction === "prev" ? "↑" : direction === "next" ? "↓" : "1"})
            </span>
          )}
        </div>

        {/* Pagination Controls */}
        <div className="flex justify-center items-center gap-2">
          {/* First/Previous Button */}
          {hasPrevPage ? (
            <div className="flex gap-2">
              <Button
                variant="default"
                size="md"
                href={buildUrl(null, "prev")}
                submit={false}
                title="Go to first page"
                onClick={() => setLoading(true)}>
                First
              </Button>
              <Button
                variant="default"
                size="md"
                href={buildUrl(prevCursor || null, "prev")}
                submit={false}
                onClick={() => setLoading(true)}>
                Previous
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button variant="default" size="md" disabled submit={false}>
                First
              </Button>
              <Button variant="default" size="md" disabled submit={false}>
                Previous
              </Button>
            </div>
          )}

          {/* Current Position Indicator */}
          <div className="px-4 py-2 bg-gray-50 rounded-md border border-gray-200">
            <span className="text-sm font-[400] text-gray-700">
              {currentCursor ? "Loading..." : "Page 1"}
            </span>
          </div>

          {/* Next Button */}
          {hasNextPage ? (
            <Button
              variant="default"
              size="md"
              href={buildUrl(nextCursor || null, "next")}
              submit={false}
              onClick={() => setLoading(true)}>
              Next
            </Button>
          ) : (
            <Button variant="default" size="md" disabled submit={false}>
              Next
            </Button>
          )}
        </div>

        {/* Cursor Info (for debugging/transparency) */}
        {process.env.NODE_ENV === "development" && currentCursor && (
          <div className="text-xs text-center text-gray-400 pt-2 border-t border-gray-100">
            Cursor: {currentCursor}
          </div>
        )}
      </div>
    </Card>
  );
}
