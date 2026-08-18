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
  HardHat,
  Camera,
} from "lucide-react";
import { jobTypeLabel } from "@/lib/calendar-labels";
import { STORE_TZ } from "@/lib/timezone";
import {
  QUOTE_STATUS_LABEL,
  QUOTE_STATUS_TONE,
  isQuoteStatus,
  needsQuoteReview,
  type QuoteStatus,
} from "@/lib/quote-status";

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
  addOns: { name: string; price: number; quantity: number }[];
  createdAt: string;
  /** Quote lifecycle (Stage 11 / PDF #9). Null = an ordinary booking. */
  quoteStatus: string | null;
  /** How many photos the customer attached — what the quote gets priced from. */
  bookingPhotoCount: number;
}

type Filter =
  | "all"
  | "unassigned"
  | "flexible"
  | "needs_attention"
  | "quotes";

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
      // The quote queue (Stage 11 / PDF #9). Every LIVE quote, not just the
      // unreviewed ones: a QUOTED job is waiting on the customer, and the admin
      // chasing it needs it in the same list as the ones waiting on them.
      case "quotes":
        return jobs.filter(
          (j) => j.quoteStatus === "PENDING_REVIEW" || j.quoteStatus === "QUOTED"
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
    quotes: jobs.filter(
      (j) => j.quoteStatus === "PENDING_REVIEW" || j.quoteStatus === "QUOTED"
    ).length,
    // Counted separately for the tile's warn state: an UNREVIEWED quote is a
    // customer whose deposit we have taken and who is waiting on us, which is a
    // different urgency from one that is waiting on them.
    awaitingReview: jobs.filter((j) => needsQuoteReview(j.quoteStatus)).length,
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
        {/* Post-construction quote queue (Stage 11 / PDF #9). Rendered only when
            there is one, so a business that doesn't sell post-construction never
            gets a permanent zero tile. */}
        {counts.quotes > 0 ? (
          <FilterStat
            icon={<HardHat size={15} />}
            label="Quotes"
            value={counts.quotes}
            warn={counts.awaitingReview > 0}
            active={filter === "quotes"}
            onClick={() => setFilter("quotes")}
          />
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <div className="atable-wrap" style={{ padding: "60px 40px", textAlign: "center", color: "var(--primary-50)", fontSize: 13 }}>
          {filter === "unassigned"
            ? "Every web booking has a cleaner assigned."
            : filter === "quotes"
              ? "No post-construction quotes are open."
              : "No web bookings match this filter."}
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
  const isQuote = isQuoteStatus(job.quoteStatus);
  const quoteStatus = isQuote ? (job.quoteStatus as QuoteStatus) : null;
  const quoteTone = quoteStatus ? QUOTE_STATUS_TONE[quoteStatus] : null;

  // An unsettled quote is deliberately excluded here: it has no crew because it
  // isn't confirmed work yet, and flagging it "Needs assignment" would send an
  // admin off to staff a job the customer has not agreed to (Stage 11 / PDF #9).
  const needsCleaner =
    job.cleaners.length < job.requiredCleaners &&
    job.status !== "CANCELLED" &&
    job.status !== "COMPLETED" &&
    job.status !== "PAID" &&
    job.quoteStatus !== "PENDING_REVIEW" &&
    job.quoteStatus !== "QUOTED" &&
    job.quoteStatus !== "DECLINED";
  const hasRequest =
    !!job.cancellationRequestedAt || !!job.rescheduleRequestedAt;

  const startStr = new Date(job.startTime).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year:
      new Date(job.startTime).getFullYear() === new Date().getFullYear()
        ? undefined
        : "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: STORE_TZ,
  });

  return (
    <article className="jcard">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-[#008C9C]/60 font-medium">
            <span>Job #{job.jobNumber}</span>
            {job.parentJobId ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#008C9C]/5 text-[#008C9C] normal-case">
                <RotateCw className="w-3 h-3" /> recurring
              </span>
            ) : null}
            {job.isFlexible ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 normal-case">
                Flexible
              </span>
            ) : null}
            {/* Stage 11 / PDF #9 — the quote state, right next to the job number,
                so a provisional price is never read as a final one. */}
            {quoteStatus ? (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full normal-case"
                style={{
                  background:
                    quoteTone === "critical"
                      ? "#fef2f2"
                      : quoteTone === "ok"
                      ? "#ecfdf5"
                      : "#fffbeb",
                  color:
                    quoteTone === "critical"
                      ? "#b91c1c"
                      : quoteTone === "ok"
                      ? "#047857"
                      : "#b45309",
                }}>
                <HardHat className="w-3 h-3" />
                {QUOTE_STATUS_LABEL[quoteStatus]}
              </span>
            ) : null}
            {quoteStatus && job.bookingPhotoCount > 0 ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#008C9C]/5 text-[#008C9C] normal-case">
                <Camera className="w-3 h-3" /> {job.bookingPhotoCount}
              </span>
            ) : null}
          </div>
          <div className="text-lg font-medium text-[#008C9C] mt-0.5">
            {startStr}
          </div>
          {job.location ? (
            <div className="text-xs text-[#008C9C]/60 mt-1">{job.location}</div>
          ) : null}
          {job.jobType ? (
            <div className="text-xs text-[#008C9C]/70 mt-1">{jobTypeLabel(job.jobType)}</div>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1">
          {job.price !== null ? (
            <div className="text-lg font-medium text-[#008C9C]">
              ${job.price.toFixed(2)}
              {/* An unreviewed quote's price is the CUSTOMER'S own estimate, not
                  ours. Labelling it is the difference between an admin reading
                  this list as prices and reading it as requests. */}
              {job.quoteStatus === "PENDING_REVIEW" ? (
                <span className="block text-[10px] font-normal text-[#008C9C]/60 text-right">
                  estimate
                </span>
              ) : null}
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

      <div className="text-xs text-[#008C9C]/70">
        {job.client ? (
          <span>
            {job.client.name}
            {job.client.email ? ` · ${job.client.email}` : ""}
            {job.client.phone ? ` · ${job.client.phone}` : ""}
          </span>
        ) : (
          <span className="text-[#008C9C]/40">No client linked</span>
        )}
      </div>

      <div className="flex flex-wrap gap-2 items-center pt-3 border-t border-[#008C9C]/10">
        <div className="flex items-center gap-2 text-xs">
          <Users className="w-3.5 h-3.5 text-[#008C9C]/60" />
          <span className="text-[#008C9C]/70">
            Cleaners: {job.cleaners.length} / {job.requiredCleaners}
          </span>
          {job.cleaners.length > 0 ? (
            <span className="text-[#008C9C] font-medium">
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
            href="/admin/requests"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-700 text-[10px] font-semibold uppercase tracking-wide ml-2 hover:bg-red-100">
            {job.cancellationRequestedAt ? "Cancel requested" : "Reschedule requested"}
          </Link>
        ) : null}

        <div className="flex-1" />
        <Link
          href={`/admin/jobs/${job.id}`}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-[#008C9C] text-white hover:bg-[#00707D]">
          <ExternalLink className="w-3.5 h-3.5" />{" "}
          {/* A quote can't be assigned yet, so the CTA names what the admin is
              actually here to do: price it. */}
          {needsQuoteReview(job.quoteStatus)
            ? "Review & quote"
            : job.quoteStatus === "QUOTED"
              ? "Open quote"
              : "Open & assign"}
        </Link>
      </div>
    </article>
  );
}
