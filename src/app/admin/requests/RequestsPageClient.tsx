"use client";

import { useMemo, useState } from "react";
import { CalendarClock, MapPin, Briefcase, CheckCircle2, X } from "lucide-react";
import { resolveJobRequest } from "../actions/resolveJobRequest";
import { fmtDate, fmtTime } from "@/lib/time";
import { avatarColor, initials } from "@/lib/avatar";

interface JobRow {
  id: string;
  jobNumber: number;
  status: string;
  isFlexible: boolean;
  startTime: string;
  location: string | null;
  jobType: string | null;
  price: number | null;
  cancellationRequestedAt: string | null;
  rescheduleRequestedAt: string | null;
  client: { id: string; name: string; email: string | null; phone: string | null } | null;
  cleaners: { id: string; name: string }[];
}

type Filter = "all" | "cancellation" | "reschedule";
type Kind = "cancellation" | "reschedule";

function relativeTime(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
function money(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function RequestsPageClient({ jobs }: { jobs: JobRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ job: JobRow; kind: Kind; decision: "approve" | "deny" } | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const filtered = useMemo(() => {
    if (filter === "cancellation") return jobs.filter((j) => j.cancellationRequestedAt);
    if (filter === "reschedule") return jobs.filter((j) => j.rescheduleRequestedAt);
    return jobs;
  }, [jobs, filter]);

  const counts = {
    all: jobs.length,
    cancellation: jobs.filter((j) => j.cancellationRequestedAt).length,
    reschedule: jobs.filter((j) => j.rescheduleRequestedAt).length,
  };

  function open(job: JobRow, kind: Kind, decision: "approve" | "deny") {
    setNote("");
    setPending({ job, kind, decision });
  }

  async function confirmHandle() {
    if (!pending) return;
    setSubmitting(true);
    setError(null);
    const res = await resolveJobRequest({
      jobId: pending.job.id,
      kind: pending.kind,
      decision: pending.decision,
      note: note.trim() || undefined,
    });
    setSubmitting(false);
    if (!res.success) { setError(res.error || "Failed to resolve"); return; }
    setPending(null);
  }

  const TABS: [Filter, string][] = [
    ["all", "All"],
    ["cancellation", "Cancellation"],
    ["reschedule", "Reschedule"],
  ];

  return (
    <div className="admin-font stack-24" style={{ maxWidth: 1200, margin: "0 auto" }}>
      <header>
        <p className="eyebrow">Operations</p>
        <h1 className="display" style={{ fontSize: "clamp(32px, 4.2vw, 46px)", marginTop: 6 }}>
          Pending <em>requests.</em>{" "}
          <span style={{ color: "var(--primary-40)", fontWeight: 300, fontFamily: "var(--font-serif)" }}>· {jobs.length}</span>
        </h1>
        <p className="subtitle" style={{ marginTop: 10, fontSize: 15.5 }}>
          Customer-initiated cancellation and reschedule requests awaiting your approval.
        </p>
      </header>

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "12px 16px", fontSize: 13, color: "#b91c1c" }}>
          {error}
        </div>
      )}

      <div className="atabs">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" className={`atab ${filter === k ? "active" : ""}`} onClick={() => setFilter(k)}>
            {label}
            {counts[k] > 0 && <span className="atab-count">{counts[k]}</span>}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="dcard" style={{ padding: 64, textAlign: "center" }}>
          <div style={{ width: 56, height: 56, margin: "0 auto 16px", borderRadius: 16, background: "var(--primary-5)", color: "var(--primary-40)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <CheckCircle2 size={28} />
          </div>
          <h3 className="title-sm" style={{ marginBottom: 6 }}>All caught up</h3>
          <p className="subtitle" style={{ fontSize: 14, margin: 0 }}>
            No {filter === "all" ? "" : filter + " "}requests need your attention right now.
          </p>
        </div>
      ) : (
        <div className="req-grid">
          {filtered.map((j) => {
            const kinds: Kind[] = [];
            if (j.cancellationRequestedAt) kinds.push("cancellation");
            if (j.rescheduleRequestedAt) kinds.push("reschedule");
            const requestedAt = j.cancellationRequestedAt ?? j.rescheduleRequestedAt;
            const when = new Date(j.startTime);
            return (
              <article key={j.id} className="req-card">
                <div className="req-card-top">
                  <div>
                    <div className="req-jobno">Job #{j.jobNumber}</div>
                    {requestedAt && <div className="req-when">Requested {relativeTime(requestedAt)}</div>}
                  </div>
                  <div className="req-badges">
                    {kinds.map((k) => (
                      <span key={k} className={`req-badge ${k === "cancellation" ? "cancel" : "resched"}`}>
                        {k === "cancellation" ? "Cancellation" : "Reschedule"}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="req-rows">
                  <div className="req-row">
                    <span className="req-row-ic"><CalendarClock size={15} /></span>
                    <div className="req-row-main">
                      {fmtDate(when, { weekday: "short", month: "short", day: "numeric" })}
                      {" · "}
                      {j.isFlexible ? "flexible time" : fmtTime(when)}
                    </div>
                  </div>
                  {j.location && (
                    <div className="req-row">
                      <span className="req-row-ic"><MapPin size={15} /></span>
                      <div className="req-row-main">{j.location}</div>
                    </div>
                  )}
                  {j.client && (
                    <div className="req-row">
                      <span className="req-row-ic">
                        <span className="avatar" style={{ background: avatarColor(j.client.name), width: 24, height: 24, fontSize: 10 }}>{initials(j.client.name)}</span>
                      </span>
                      <div>
                        <div className="req-row-main">{j.client.name}</div>
                        <div className="req-row-sub">{[j.client.email, j.client.phone].filter(Boolean).join(" · ") || "—"}</div>
                      </div>
                    </div>
                  )}
                  <div className="req-row">
                    <span className="req-row-ic"><Briefcase size={15} /></span>
                    <div className="req-row-main">
                      {j.cleaners.length > 0 ? (
                        <span className="avstack">
                          {j.cleaners.slice(0, 3).map((c) => (
                            <span key={c.id} className="avatar" style={{ background: avatarColor(c.name) }} title={c.name}>{initials(c.name)}</span>
                          ))}
                        </span>
                      ) : (
                        <span style={{ color: "var(--primary-40)", fontStyle: "italic", fontWeight: 400 }}>Unassigned</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="req-foot">
                  <div className="req-price">{j.price != null ? money(j.price) : "—"}</div>
                  <div className="req-actions">
                    <a href={`/admin/jobs/${j.id}`} className="btn btn-secondary btn-sm">Open job</a>
                    {kinds.map((k) => (
                      <span key={k} style={{ display: "inline-flex", gap: 8 }}>
                        <button className="btn btn-secondary btn-sm req-deny" onClick={() => open(j, k, "deny")}>Deny</button>
                        <button
                          className={`btn btn-sm ${k === "cancellation" ? "req-approve-cancel" : "req-approve-resched"}`}
                          onClick={() => open(j, k, "approve")}>
                          {k === "cancellation" ? "Approve cancellation" : "Approve reschedule"}
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {pending && (
        <div className="req-modal-overlay" onClick={() => !submitting && setPending(null)}>
          <div className="req-modal" onClick={(e) => e.stopPropagation()}>
            <div className="req-modal-head">
              <h3>{pending.decision === "deny" ? "Deny request" : pending.kind === "cancellation" ? "Approve cancellation" : "Approve reschedule"}</h3>
              <button className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => !submitting && setPending(null)}><X size={16} /></button>
            </div>
            <p className="req-modal-body">
              {pending.decision === "deny"
                ? `Keep Job #${pending.job.jobNumber} as scheduled and let the customer know their request was declined.`
                : pending.kind === "cancellation"
                ? `Cancel Job #${pending.job.jobNumber}. The slot will be freed and the customer notified.`
                : `Approve the reschedule for Job #${pending.job.jobNumber}. The cleaners and customer will be notified.`}
            </p>
            <label className="req-modal-label">Customer-facing note <span>(optional)</span></label>
            <textarea
              className="textarea"
              rows={3}
              disabled={submitting}
              placeholder={pending.decision === "deny" ? "Let them know why, and offer alternatives…" : "Add a friendly note to include in the confirmation…"}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="req-modal-foot">
              <button className="btn btn-ghost btn-sm" disabled={submitting} onClick={() => setPending(null)}>Cancel</button>
              <button
                className={`btn btn-sm ${pending.decision === "deny" ? "btn-secondary req-deny" : pending.kind === "cancellation" ? "req-approve-cancel" : "req-approve-resched"}`}
                disabled={submitting}
                onClick={confirmHandle}>
                {submitting ? "Working…" : pending.decision === "deny" ? "Deny request" : pending.kind === "cancellation" ? "Approve cancellation" : "Approve reschedule"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
