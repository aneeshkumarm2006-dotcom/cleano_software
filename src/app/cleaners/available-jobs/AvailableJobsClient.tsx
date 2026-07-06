"use client";

import { useState } from "react";
import { claimJob } from "./claimJob";
import { fmtDate as fmtDateTz, fmtTime as fmtTimeTz } from "@/lib/time";

interface AvailableJob {
  id: string;
  jobNumber: number;
  clientName: string;
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

// Legacy imports left machine-generated notes on jobs ("Source Booking ID …",
// "Imported from BookingKoala …"). A data cleanup is nulling these, but hide
// them defensively so they never clutter cleaner cards.
function displayNotes(notes: string | null): string | null {
  if (!notes) return null;
  const trimmed = notes.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("Source Booking ID")) return null;
  if (trimmed.startsWith("Imported from BookingKoala")) return null;
  return trimmed;
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
        const notes = displayNotes(job.notes);

        return (
          <article key={job.id} className="cl-job-card">
            {/* Line 1: client name + job # */}
            <div className="cl-job-card-head">
              <h3 className="cl-job-card-client">{job.clientName}</h3>
              <span className="cl-job-card-id">Job #{job.jobNumber}</span>
            </div>

            {/* Line 2: date + time on one line, pay right-aligned */}
            <div className="cl-job-card-when">
              <span className="cl-job-card-datetime">
                {dateStr}
                {timeStr && <span className="time"> · {timeStr}</span>}
                {job.isFlexible && <span className="cl-pill flex">Flexible time</span>}
              </span>
              {job.price != null && (
                <span className="cl-job-card-pay">
                  <span className="lbl">Est. pay</span>
                  <span className="val">${Math.round(job.price / 2)}+</span>
                </span>
              )}
            </div>

            <div className="cl-job-card-meta">
              {job.jobType && (
                <div className="row">
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
