"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Globe,
  ExternalLink,
  UserPlus,
  Users,
  AlertTriangle,
  RotateCw,
  Clock,
} from "lucide-react";

interface WebJob {
  id: string;
  jobNumber: number;
  status: string;
  isFlexible: boolean;
  startTime: string;
  location: string | null;
  jobType: string | null;
  price: number | null;
  requiredCleaners: number;
  parentJobId: string | null;
  cancellationRequestedAt: string | null;
  rescheduleRequestedAt: string | null;
  client: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
  } | null;
  cleaners: { id: string; name: string }[];
  addOns: { name: string; price: number }[];
  createdAt: string;
}

type Filter = "all" | "unassigned" | "flexible" | "needs_attention";

export default function WebBookingsPageClient({ jobs }: { jobs: WebJob[] }) {
  const [filter, setFilter] = useState<Filter>("unassigned");

  const filtered = useMemo(() => {
    switch (filter) {
      case "unassigned":
        return jobs.filter(
          (j) =>
            j.cleaners.length < j.requiredCleaners &&
            j.status !== "CANCELLED" &&
            j.status !== "COMPLETED" &&
            j.status !== "PAID"
        );
      case "flexible":
        return jobs.filter((j) => j.isFlexible && j.status !== "CANCELLED");
      case "needs_attention":
        return jobs.filter(
          (j) => j.cancellationRequestedAt || j.rescheduleRequestedAt
        );
      default:
        return jobs;
    }
  }, [jobs, filter]);

  const counts = {
    all: jobs.length,
    unassigned: jobs.filter(
      (j) =>
        j.cleaners.length < j.requiredCleaners &&
        j.status !== "CANCELLED" &&
        j.status !== "COMPLETED" &&
        j.status !== "PAID"
    ).length,
    flexible: jobs.filter((j) => j.isFlexible && j.status !== "CANCELLED")
      .length,
    needs_attention: jobs.filter(
      (j) => j.cancellationRequestedAt || j.rescheduleRequestedAt
    ).length,
  };

  return (
    <div className="admin-font stack-24">
      <header className="stack-8">
        <p className="eyebrow">Operations</p>
        <h1 className="display">
          Web Bookings{" "}
          <span style={{ color: "var(--primary-40)", fontWeight: 300 }}>
            · {counts.all}
          </span>
        </h1>
      </header>

      {/* Stats — clickable to filter */}
      <div className="astat-grid">
        <FilterStat
          icon={<Globe size={15} />}
          label="Total"
          value={counts.all}
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        <FilterStat
          icon={<UserPlus size={15} />}
          label="Needs cleaner"
          value={counts.unassigned}
          warn={counts.unassigned > 0}
          active={filter === "unassigned"}
          onClick={() => setFilter("unassigned")}
        />
        <FilterStat
          icon={<Clock size={15} />}
          label="Flexible time"
          value={counts.flexible}
          active={filter === "flexible"}
          onClick={() => setFilter("flexible")}
        />
        <FilterStat
          icon={<AlertTriangle size={15} />}
          label="Needs attention"
          value={counts.needs_attention}
          warn={counts.needs_attention > 0}
          active={filter === "needs_attention"}
          onClick={() => setFilter("needs_attention")}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="atable-wrap" style={{ padding: "60px 40px", textAlign: "center", color: "var(--primary-50)", fontSize: 13 }}>
          {filter === "unassigned" ? "Every web booking has a cleaner assigned." : "No web bookings match this filter."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filtered.map((j) => (
            <BookingRow key={j.id} job={j} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterStat({
  icon,
  label,
  value,
  warn,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  warn?: boolean;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="astat"
      style={{
        textAlign: "left",
        cursor: "pointer",
        fontFamily: "inherit",
        border: active
          ? "1.5px solid var(--primary)"
          : warn && value > 0
          ? "1px solid #fde68a"
          : undefined,
        background: active
          ? "var(--primary-5)"
          : warn && value > 0
          ? "#fffbeb"
          : undefined,
      }}>
      <div className="astat-head">
        <span className="astat-label">{label}</span>
        <div className="astat-icon">{icon}</div>
      </div>
      <div className="astat-value">{value}</div>
      {active && <div className="astat-delta">Showing</div>}
    </button>
  );
}

function BookingRow({ job }: { job: WebJob }) {
  const needsCleaner =
    job.cleaners.length < job.requiredCleaners &&
    job.status !== "CANCELLED" &&
    job.status !== "COMPLETED" &&
    job.status !== "PAID";
  const hasRequest =
    !!job.cancellationRequestedAt || !!job.rescheduleRequestedAt;

  const startStr = new Date(job.startTime).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year:
      new Date(job.startTime).getFullYear() === new Date().getFullYear()
        ? undefined
        : "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <article className="jcard">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-[#005F6A]/60 font-medium">
            <span>Job #{job.jobNumber}</span>
            {job.parentJobId ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#005F6A]/5 text-[#005F6A] normal-case">
                <RotateCw className="w-3 h-3" /> recurring
              </span>
            ) : null}
            {job.isFlexible ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 normal-case">
                Flexible
              </span>
            ) : null}
          </div>
          <div className="text-lg font-medium text-[#005F6A] mt-0.5">
            {startStr}
          </div>
          {job.location ? (
            <div className="text-xs text-[#005F6A]/60 mt-1">{job.location}</div>
          ) : null}
          {job.jobType ? (
            <div className="text-xs text-[#005F6A]/70 mt-1">{job.jobType}</div>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1">
          {job.price !== null ? (
            <div className="text-lg font-medium text-[#005F6A]">
              ${job.price.toFixed(2)}
            </div>
          ) : null}
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wide ${
              job.status === "COMPLETED" || job.status === "PAID"
                ? "bg-emerald-100 text-emerald-800"
                : job.status === "CANCELLED"
                ? "bg-gray-100 text-gray-500"
                : "bg-slate-100 text-slate-700"
            }`}>
            {job.status}
          </span>
        </div>
      </div>

      <div className="text-xs text-[#005F6A]/70">
        {job.client ? (
          <span>
            {job.client.name}
            {job.client.email ? ` · ${job.client.email}` : ""}
            {job.client.phone ? ` · ${job.client.phone}` : ""}
          </span>
        ) : (
          <span className="text-[#005F6A]/40">No client linked</span>
        )}
      </div>

      <div className="flex flex-wrap gap-2 items-center pt-3 border-t border-[#005F6A]/10">
        <div className="flex items-center gap-2 text-xs">
          <Users className="w-3.5 h-3.5 text-[#005F6A]/60" />
          <span className="text-[#005F6A]/70">
            Cleaners: {job.cleaners.length} / {job.requiredCleaners}
          </span>
          {job.cleaners.length > 0 ? (
            <span className="text-[#005F6A] font-medium">
              {job.cleaners.map((c) => c.name).join(", ")}
            </span>
          ) : null}
        </div>

        {needsCleaner ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 text-[10px] font-semibold uppercase tracking-wide ml-2">
            <UserPlus className="w-3 h-3" />
            Needs assignment
          </span>
        ) : null}

        {hasRequest ? (
          <Link
            href="/requests"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-700 text-[10px] font-semibold uppercase tracking-wide ml-2 hover:bg-red-100">
            {job.cancellationRequestedAt ? "Cancel requested" : "Reschedule requested"}
          </Link>
        ) : null}

        <div className="flex-1" />
        <Link
          href={`/jobs/${job.id}`}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-[#005F6A] text-white hover:bg-[#004952]">
          <ExternalLink className="w-3.5 h-3.5" /> Open & assign
        </Link>
      </div>
    </article>
  );
}
