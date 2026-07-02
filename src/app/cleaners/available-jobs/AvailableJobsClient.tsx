"use client";

import { useState } from "react";
import { claimJob } from "./claimJob";
import { fmtDate as fmtDateTz, fmtTime as fmtTimeTz } from "@/lib/time";

interface AvailableJob {
  id: string;
  jobNumber: number;
  startTime: string;
  isFlexible: boolean;
  location: string | null;
  jobType: string | null;
  price: number | null;
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

export default function AvailableJobsClient({ jobs }: { jobs: AvailableJob[] }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});

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

  const visible = jobs.filter((j) => !claimed.has(j.id));

  if (visible.length === 0) {
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
    <div className="cl-jobs-grid">
      {visible.map((job) => {
        const spotsLeft = job.requiredCleaners - job.claimedCount;
        const isBusy = busyId === job.id;
        const dateStr = fmtDate(job.startTime);
        const timeStr = !job.isFlexible ? fmtTime(job.startTime) : null;

        return (
          <article key={job.id} className="cl-job-card">
            <div className="cl-job-card-head">
              <div>
                <div className="cl-job-card-id">JOB #{job.jobNumber}</div>
                <h3 className="cl-job-card-date">
                  {dateStr}
                  {timeStr && (
                    <span style={{ fontFamily: "var(--font)", fontSize: 14, color: "var(--primary-60)", fontWeight: 500, marginLeft: 8 }}>
                      · {timeStr}
                    </span>
                  )}
                </h3>
                {job.isFlexible && (
                  <span className="cl-pill flex" style={{ marginTop: 8 }}>Flexible time</span>
                )}
              </div>
              {job.price != null && (
                <div className="cl-job-card-pay">
                  <div className="cl-job-card-pay-lbl">Est. pay</div>
                  <div className="cl-job-card-pay-val">
                    ${Math.round(job.price / 2)}<sup>+</sup>
                  </div>
                </div>
              )}
            </div>

            <div className="cl-job-card-meta">
              {job.location && (
                <div className="row" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></svg>
                  </span>
                  <span>{job.location}</span>
                </div>
              )}
              {job.jobType && (
                <div className="row" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>
                  </span>
                  <span>
                    <strong style={{ fontFamily: "var(--font-mono)", fontSize: 12, letterSpacing: "0.04em" }}>{job.jobType}</strong>
                    {(job.bedCount || job.bathCount) && (
                      <span style={{ color: "var(--primary-50)" }}> · {job.bedCount ?? 0}bd / {job.bathCount ?? 0}ba</span>
                    )}
                  </span>
                </div>
              )}
              {job.isFlexible && (
                <div className="row" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                  </span>
                  <span>Time TBD by admin</span>
                </div>
              )}
              <div className="row" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="icon">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                </span>
                <span><strong>{spotsLeft}</strong> spot{spotsLeft !== 1 ? "s" : ""} remaining</span>
              </div>
            </div>

            {job.notes && (
              <p style={{ fontSize: 12, color: "var(--primary-60)", background: "var(--cream)", borderRadius: 10, padding: "10px 14px", fontStyle: "italic", margin: 0 }}>
                {job.notes}
              </p>
            )}

            {errors[job.id] && (
              <p style={{ fontSize: 12, color: "#dc2626", margin: 0 }}>{errors[job.id]}</p>
            )}

            <button
              onClick={() => handleClaim(job.id)}
              disabled={isBusy}
              className="cl-claim-btn">
              {isBusy ? "Claiming…" : "Claim this job"}
            </button>
          </article>
        );
      })}
    </div>
  );
}
