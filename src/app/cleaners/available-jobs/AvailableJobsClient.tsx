"use client";

import { useMemo, useState } from "react";
import { claimJob } from "./claimJob";
import { fmtDate as fmtDateTz, fmtTime as fmtTimeTz } from "@/lib/time";
import { tzDateKey } from "@/lib/tz-calendar";
import { jobTypeLabel } from "@/lib/calendar-labels";
import { sanitizeCleanerNotes } from "@/lib/cleaner-notes";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import CustomDropdown from "@/components/ui/custom-dropdown";
import JobPreviewModal from "./JobPreviewModal";

interface AvailableJob {
  id: string;
  jobNumber: number;
  clientName: string;
  startTime: string;
  isFlexible: boolean;
  location: string | null;
  /** Coarse city/area derived server-side from the address. */
  area: string | null;
  jobType: string | null;
  payType: string;
  /** This cleaner's estimated payout if they claim it (PERCENTAGE jobs). */
  estPay: number | null;
  /** Hourly rate for HOURLY jobs. */
  estHourly: number | null;
  bedCount: number | null;
  bathCount: number | null;
  requiredCleaners: number;
  claimedCount: number;
  notes: string | null;
}

function fmtDate(iso: string) {
  return fmtDateTz(iso, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
function fmtTime(iso: string) {
  return fmtTimeTz(iso);
}

// Notes shown to cleaners are stripped of any billing/price text (item 10):
// legacy imported jobs still carry machine billing lines, and cleaners must
// never see the total booking value. Shared helper covers both this board and
// the job-detail screen.
function displayNotes(notes: string | null): string | null {
  return sanitizeCleanerNotes(notes);
}

/** "3bd · 2ba" — only the parts we actually know. Never "0bd / 4ba". */
function sizeLabel(bed: number | null, bath: number | null): string | null {
  const parts: string[] = [];
  if (bed != null && bed > 0) parts.push(`${bed}bd`);
  if (bath != null && bath > 0) parts.push(`${bath}ba`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

const ALL = "all";

export default function AvailableJobsClient({ jobs }: { jobs: AvailableJob[] }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** Job being previewed (item 8). Purely local — no server state is touched. */
  const [previewId, setPreviewId] = useState<string | null>(null);

  // Filters (client-side — the board is capped at 100 open jobs).
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [area, setArea] = useState(ALL);
  const [type, setType] = useState(ALL);

  async function handleClaim(jobId: string) {
    setBusyId(jobId);
    setErrors((e) => { const n = { ...e }; delete n[jobId]; return n; });
    const res = await claimJob(jobId);
    setBusyId(null);
    if (res.success) {
      setClaimed((s) => new Set(s).add(jobId));
    } else {
      setErrors((e) => ({ ...e, [jobId]: res.error ?? "Failed to claim" }));
    }
  }

  const unclaimed = useMemo(() => jobs.filter((j) => !claimed.has(j.id)), [jobs, claimed]);

  const areaOptions = useMemo(() => {
    const set = new Set<string>();
    for (const j of unclaimed) if (j.area) set.add(j.area);
    return [
      { value: ALL, label: "All areas" },
      ...[...set].sort().map((a) => ({ value: a, label: a })),
    ];
  }, [unclaimed]);

  const typeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const j of unclaimed) if (j.jobType) set.add(j.jobType);
    return [
      { value: ALL, label: "All job types" },
      ...[...set]
        .map((t) => ({ value: t, label: jobTypeLabel(t) || t }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ];
  }, [unclaimed]);

  const visible = useMemo(() => {
    return unclaimed.filter((j) => {
      // Compare in the business timezone so "from 14 July" means the cleaner's
      // 14 July, not the browser's.
      const dayKey = tzDateKey(new Date(j.startTime));
      if (from && dayKey < from) return false;
      if (to && dayKey > to) return false;
      if (area !== ALL && j.area !== area) return false;
      if (type !== ALL && j.jobType !== type) return false;
      return true;
    });
  }, [unclaimed, from, to, area, type]);

  const hasFilters = Boolean(from || to || area !== ALL || type !== ALL);

  function clearFilters() {
    setFrom("");
    setTo("");
    setArea(ALL);
    setType(ALL);
  }

  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase",
    letterSpacing: "0.06em", color: "var(--primary-50)", marginBottom: 6,
  };

  const filters = (
    <>
      <div className="cl-toolbar">
        <div style={{ minWidth: 150 }}>
          <label style={labelStyle} htmlFor="avail-from">From</label>
          <Input
            id="avail-from"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
            variant="default"
            size="md"
          />
        </div>
        <div style={{ minWidth: 150 }}>
          <label style={labelStyle} htmlFor="avail-to">To</label>
          <Input
            id="avail-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            variant="default"
            size="md"
          />
        </div>
        <div style={{ minWidth: 170 }}>
          <label style={labelStyle}>Area</label>
          <CustomDropdown
            trigger={
              <Button variant="outline" size="md" submit={false} className="w-full flex items-center !justify-between bg-white">
                <span>{areaOptions.find((o) => o.value === area)?.label ?? "All areas"}</span>
                <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </Button>
            }
            options={areaOptions.map((opt) => ({ label: opt.label, onClick: () => setArea(opt.value) }))}
            variant="default"
            size="md"
          />
        </div>
        <div style={{ minWidth: 180 }}>
          <label style={labelStyle}>Job type</label>
          <CustomDropdown
            trigger={
              <Button variant="outline" size="md" submit={false} className="w-full flex items-center !justify-between bg-white">
                <span>{typeOptions.find((o) => o.value === type)?.label ?? "All job types"}</span>
                <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </Button>
            }
            options={typeOptions.map((opt) => ({ label: opt.label, onClick: () => setType(opt.value) }))}
            variant="default"
            size="md"
          />
        </div>
        {hasFilters && (
          <div style={{ alignSelf: "flex-end" }}>
            <button type="button" className="cl-action-btn" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        )}
      </div>
      <p style={{ fontSize: 12, color: "var(--primary-50)", margin: "0 0 14px" }}>
        {visible.length} open job{visible.length === 1 ? "" : "s"}
        {hasFilters && unclaimed.length !== visible.length ? ` of ${unclaimed.length}` : ""}
      </p>
    </>
  );

  if (unclaimed.length === 0) {
    return (
      <div className="cl-empty-block">
        <div className="icon-bubble">
          <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>
        </div>
        <h3 style={{ fontSize: 17, color: "var(--ink)", margin: "0 0 6px" }}>No open jobs right now</h3>
        <p style={{ margin: 0, fontSize: 13 }}>Check back later — new shifts appear here as soon as they&apos;re posted.</p>
      </div>
    );
  }

  return (
    <>
      {filters}

      {visible.length === 0 ? (
        <div className="cl-empty-block">
          <div className="icon-bubble">
            <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>
          </div>
          <h3 style={{ fontSize: 17, color: "var(--ink)", margin: "0 0 6px" }}>No jobs match these filters</h3>
          <p style={{ margin: 0, fontSize: 13 }}>Try a wider date range or a different area.</p>
        </div>
      ) : (
        <div className="cl-jobs-grid">
          {visible.map((job) => {
            const spotsLeft = job.requiredCleaners - job.claimedCount;
            const isBusy = busyId === job.id;
            const dateStr = fmtDate(job.startTime);
            const timeStr = !job.isFlexible ? fmtTime(job.startTime) : null;
            const notes = displayNotes(job.notes);
            const size = sizeLabel(job.bedCount, job.bathCount);
            const typeName = jobTypeLabel(job.jobType);

            return (
              <article key={job.id} className="cl-job-card">
                {/* Line 1: client name + job # */}
                <div className="cl-job-card-head">
                  <h3 className="cl-job-card-client">{job.clientName}</h3>
                  <span className="cl-job-card-id">Job #{job.jobNumber}</span>
                </div>

                {/* Line 2: date + time on one line, pay right-aligned.
                    The pay shown is THIS cleaner's estimated payout from the
                    real split math — not a fraction of the client's price. */}
                <div className="cl-job-card-when">
                  <span className="cl-job-card-datetime">
                    {dateStr}
                    {timeStr && <span className="time"> · {timeStr}</span>}
                    {job.isFlexible && <span className="cl-pill flex">Flexible time</span>}
                  </span>
                  {job.estHourly != null ? (
                    <span className="cl-job-card-pay" title="Hourly rate for this job. Final pay depends on hours worked.">
                      <span className="lbl">Pay rate</span>
                      <span className="val">${job.estHourly.toFixed(2)}/hr</span>
                    </span>
                  ) : job.estPay != null ? (
                    <span
                      className="cl-job-card-pay"
                      title="Estimated payout if you claim this job. The final amount can change if the team size, price, or add-ons change.">
                      <span className="lbl">Est. pay</span>
                      <span className="val">${job.estPay.toFixed(2)}</span>
                    </span>
                  ) : (
                    <span className="cl-job-card-pay" title="Dispatch sets the payout for this job when you're assigned.">
                      <span className="lbl">Pay</span>
                      <span className="val" style={{ fontSize: 13 }}>Set on assignment</span>
                    </span>
                  )}
                </div>

                <div className="cl-job-card-meta">
                  {(typeName || size) && (
                    <div className="row">
                      <span className="icon">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>
                      </span>
                      <span>
                        {typeName && <strong>{typeName}</strong>}
                        {size && (
                          <span style={{ color: "var(--primary-50)" }}>
                            {typeName ? " · " : ""}{size}
                          </span>
                        )}
                      </span>
                    </div>
                  )}
                  {job.location && (
                    <div className="row">
                      <span className="icon">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></svg>
                      </span>
                      <span className="cl-job-card-addr">{job.location}</span>
                    </div>
                  )}
                </div>

                {notes && <p className="cl-job-card-notes">{notes}</p>}

                <div className="cl-job-card-spots">
                  <span className="icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                  </span>
                  <span><strong>{spotsLeft}</strong> spot{spotsLeft !== 1 ? "s" : ""} remaining</span>
                </div>

                {errors[job.id] && (
                  <p style={{ fontSize: 12, color: "#dc2626", margin: 0 }}>{errors[job.id]}</p>
                )}

                {/* Two actions (item 8): look before you leap. Preview is
                    read-only — it never locks, assigns or hides the job, so
                    another cleaner can still claim it while this one reads. */}
                <div className="cl-job-card-actions">
                  <button
                    onClick={() => setPreviewId(job.id)}
                    disabled={isBusy}
                    className="cl-preview-btn">
                    Preview
                  </button>
                  <button
                    onClick={() => handleClaim(job.id)}
                    disabled={isBusy}
                    className="cl-claim-btn">
                    {isBusy ? "Claiming…" : "Claim this job"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <JobPreviewModal
        jobId={previewId}
        onClose={() => setPreviewId(null)}
        onClaim={async (id) => {
          await handleClaim(id);
          setPreviewId(null);
        }}
        claiming={busyId === previewId && previewId !== null}
      />
    </>
  );
}
