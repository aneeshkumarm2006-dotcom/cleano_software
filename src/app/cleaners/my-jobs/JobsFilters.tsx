"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import Input from "@/components/ui/Input";
import CustomDropdown from "@/components/ui/custom-dropdown";
import Button from "@/components/ui/Button";
import { useJobsLoading } from "./JobsLoadingContext";
import {
  DEFAULT_SERVICE_CATALOG,
  serviceOptions as catalogServiceOptions,
} from "@/lib/service-catalog";

export function JobsFilters({
  serviceOptions = [],
}: {
  /** Service list from Settings → Job Types (item 20). */
  serviceOptions?: { value: string; label: string }[];
} = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const { setLoading } = useJobsLoading();

  const [search, setSearch] = useState(searchParams.get("search") || "");
  // "upcoming" is the default view, so a missing status param means upcoming.
  const status = searchParams.get("status") || "upcoming";
  const jobType = searchParams.get("jobType") || "all";
  const perPage = searchParams.get("perPage") || "10";

  // Values that match the server-side defaults are dropped from the URL.
  const paramDefaults: Record<string, string> = {
    status: "upcoming",
    jobType: "all",
    search: "",
    perPage: "10",
  };

  const buildUrl = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());

    Object.entries(updates).forEach(([key, value]) => {
      if (value && value !== (paramDefaults[key] ?? "")) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });

    // Reset cursor when filters change
    if (!updates.cursor) {
      params.delete("cursor");
      params.delete("direction");
    }

    return `/cleaners/my-jobs?${params.toString()}`;
  };

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const currentSearch = searchParams.get("search") || "";

    // Only trigger navigation if search actually changed
    if (search !== currentSearch) {
      setLoading(true);
      startTransition(() => {
        router.push(buildUrl({ search }));
      });
    }
  };

  const handleStatusChange = (value: string) => {
    setLoading(true);
    startTransition(() => {
      router.push(buildUrl({ status: value }));
    });
  };

  const handleJobTypeChange = (value: string) => {
    setLoading(true);
    startTransition(() => {
      router.push(buildUrl({ jobType: value }));
    });
  };

  const handlePerPageChange = (value: string) => {
    setLoading(true);
    startTransition(() => {
      router.push(buildUrl({ perPage: value }));
    });
  };

  const handleClearFilters = () => {
    setSearch("");
    setLoading(true);
    startTransition(() => {
      router.push("/cleaners/my-jobs");
    });
  };

  const hasActiveFilters = search || status !== "upcoming" || jobType !== "all";

  const statusOptions = [
    { value: "upcoming", label: "Upcoming" },
    { value: "in_progress", label: "In Progress" },
    { value: "completed", label: "Completed" },
    { value: "past", label: "Past" },
    { value: "cancelled", label: "Cancelled" },
    { value: "all", label: "All Statuses" },
  ];

  // Cleaner job-type filter reads the same Settings service catalog the admin
  // forms use, so a cleaner never sees a service the business no longer offers
  // (item 20).
  const jobTypeOptions = [
    { value: "all", label: "All Types" },
    ...(serviceOptions.length > 0
      ? serviceOptions
      : catalogServiceOptions(DEFAULT_SERVICE_CATALOG)),
  ];

  const perPageOptions = [
    { value: "5", label: "5" },
    { value: "10", label: "10" },
    { value: "25", label: "25" },
    { value: "50", label: "50" },
    { value: "100", label: "100" },
  ];

  return (
    <div className="cl-toolbar">
      {/* Search */}
      <div style={{ flex: "1", minWidth: 220 }}>
        <label style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--primary-50)", marginBottom: 6 }}>
          Search
        </label>
        <form onSubmit={handleSearch}>
          <div style={{ position: "relative" }}>
            <Input
              type="text"
              id="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Client name or location…"
              variant="default"
              size="md"
              className="pr-10"
            />
            <button type="submit" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--primary-50)" }}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
          </div>
        </form>
      </div>

      {/* Status */}
      <div style={{ minWidth: 160 }}>
        <label style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--primary-50)", marginBottom: 6 }}>
          Status
        </label>
        <CustomDropdown
          trigger={
            <Button variant="outline" size="md" submit={false} className="w-full flex items-center !justify-between bg-white">
              <span>{statusOptions.find((o) => o.value === status)?.label ?? "Upcoming"}</span>
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </Button>
          }
          options={statusOptions.map((opt) => ({ label: opt.label, onClick: () => handleStatusChange(opt.value) }))}
          variant="default" size="md"
        />
      </div>

      {/* Job Type */}
      <div style={{ minWidth: 160 }}>
        <label style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--primary-50)", marginBottom: 6 }}>
          Job type
        </label>
        <CustomDropdown
          trigger={
            <Button variant="outline" size="md" submit={false} className="w-full flex items-center !justify-between bg-white">
              <span>{jobTypeOptions.find((o) => o.value === jobType)?.label}</span>
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </Button>
          }
          options={jobTypeOptions.map((opt) => ({ label: opt.label, onClick: () => handleJobTypeChange(opt.value) }))}
          variant="default" size="md"
        />
      </div>

      {/* Per Page */}
      <div style={{ minWidth: 100 }}>
        <label style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--primary-50)", marginBottom: 6 }}>
          Per page
        </label>
        <CustomDropdown
          trigger={
            <Button variant="outline" size="md" submit={false} className="w-full flex items-center !justify-between bg-white">
              <span>{perPageOptions.find((o) => o.value === perPage)?.label}</span>
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </Button>
          }
          options={perPageOptions.map((opt) => ({ label: opt.label, onClick: () => handlePerPageChange(opt.value) }))}
          variant="default" size="md"
        />
      </div>

      {hasActiveFilters && (
        <div style={{ alignSelf: "flex-end" }}>
          <button type="button" className="cl-action-btn" onClick={handleClearFilters} disabled={isPending}>
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
