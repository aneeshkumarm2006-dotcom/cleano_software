"use client";

import { useMemo, useState } from "react";
import { Inbox, Check, X, ExternalLink } from "lucide-react";
import { resolveJobRequest } from "../actions/resolveJobRequest";

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

export default function RequestsPageClient({ jobs }: { jobs: JobRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ jobId: string; kind: "cancellation" | "reschedule"; decision: "approve" | "deny"; msg: string } | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const filtered = useMemo(() => {
    if (filter === "cancellation") return jobs.filter(j => j.cancellationRequestedAt);
    if (filter === "reschedule") return jobs.filter(j => j.rescheduleRequestedAt);
    return jobs;
  }, [jobs, filter]);

  const counts = {
    all: jobs.length,
    cancellation: jobs.filter(j => j.cancellationRequestedAt).length,
    reschedule: jobs.filter(j => j.rescheduleRequestedAt).length,
  };

  function handle(jobId: string, kind: "cancellation" | "reschedule", decision: "approve" | "deny") {
    const msg = kind === "cancellation" && decision === "approve"
      ? "Approve this cancellation? The job will be marked as CANCELLED."
      : `Mark this ${kind} request as ${decision === "approve" ? "approved" : "denied"}?`;
    setNote("");
    setPending({ jobId, kind, decision, msg });
  }

  async function confirmHandle() {
    if (!pending) return;
    const { jobId, kind, decision } = pending;
    setSubmitting(true);
    setError(null);
    const res = await resolveJobRequest({ jobId, kind, decision, note: note.trim() || undefined });
    setSubmitting(false);
    if (!res.success) { setError(res.error || "Failed to resolve"); return; }
    setPending(null);
    setBusyId(jobId);
    setBusyId(null);
  }

  return (
    <div className="admin-font stack-24">
      <header className="stack-8">
        <p className="eyebrow">Operations</p>
        <h1 className="display" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Inbox size={28} style={{ color: "var(--primary)" }} />
          Pending Requests
          {jobs.length > 0 && (
            <span style={{ background: "#005F6A", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 20, padding: "2px 12px", marginLeft: 4 }}>
              {jobs.length}
            </span>
          )}
        </h1>
        <p style={{ fontSize: 14, color: "var(--primary-60)" }}>
          Customer-initiated cancellation and reschedule requests that need a decision from you.
        </p>
      </header>

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "12px 16px", fontSize: 13, color: "#b91c1c" }}>
          {error}
        </div>
      )}

      <div className="atabs">
        {([["all", `All (${counts.all})`], ["cancellation", `Cancellation (${counts.cancellation})`], ["reschedule", `Reschedule (${counts.reschedule})`]] as [Filter, string][]).map(([k, label]) => (
          <button key={k} type="button" className={`atab${filter === k ? " active" : ""}`} onClick={() => setFilter(k)}>
            {label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="atable-wrap" style={{ padding: "80px 40px", textAlign: "center", color: "var(--primary-60)" }}>
          No pending requests. 🎉
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filtered.map(j => {
            const kinds: ("cancellation" | "reschedule")[] = [];
            if (j.cancellationRequestedAt) kinds.push("cancellation");
            if (j.rescheduleRequestedAt) kinds.push("reschedule");
            const requestedAt = j.cancellationRequestedAt ?? j.rescheduleRequestedAt;
            const startStr = new Date(j.startTime).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

            return (
              <article key={j.id} className="jcard">
                <div className="jcard-top">
                  <div>
                    <div className="jcard-meta" style={{ marginBottom: 4 }}>Job #{j.jobNumber}</div>
                    <div className="jcard-client">{startStr}{j.isFlexible && <span style={{ fontSize: 12, color: "var(--primary-60)", fontWeight: 400, marginLeft: 6 }}>(flexible)</span>}</div>
                    {j.location && <div className="jcard-meta">{j.location}</div>}
                    {j.client && (
                      <div className="jcard-meta" style={{ marginTop: 4 }}>
                        {j.client.name}{j.client.email ? ` · ${j.client.email}` : ""}{j.client.phone ? ` · ${j.client.phone}` : ""}
                      </div>
                    )}
                    {j.cleaners.length > 0 && <div className="jcard-meta">with {j.cleaners.map(c => c.name).join(", ")}</div>}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                    {kinds.map(k => (
                      <span key={k} style={{
                        display: "inline-block",
                        background: k === "cancellation" ? "#fee2e2" : "#fffbeb",
                        color: k === "cancellation" ? "#b91c1c" : "#d97706",
                        fontSize: 10, fontWeight: 700, borderRadius: 20, padding: "3px 10px",
                        letterSpacing: "0.06em", textTransform: "uppercase",
                      }}>
                        {k}
                      </span>
                    ))}
                    {j.price !== null && <div className="jcard-price">${j.price.toFixed(2)}</div>}
                  </div>
                </div>

                <div className="jcard-row" style={{ paddingTop: 12, borderTop: "1px solid var(--primary-10)", marginTop: 10, flexWrap: "wrap", gap: 8 }}>
                  <a href={`/jobs/${j.id}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--primary-60)", textDecoration: "none" }}>
                    <ExternalLink size={13} /> Open job
                  </a>
                  <div style={{ flex: 1 }} />
                  {kinds.map(k => (
                    <div key={k} style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        disabled={busyId === j.id}
                        onClick={() => handle(j.id, k, "approve")}
                        className="btn btn-sm"
                        style={{
                          background: k === "cancellation" ? "#dc2626" : "#059669",
                          color: "#fff", border: 0,
                          display: "inline-flex", alignItems: "center", gap: 4,
                        }}>
                        <Check size={13} /> Approve {k}
                      </button>
                      <button
                        type="button"
                        disabled={busyId === j.id}
                        onClick={() => handle(j.id, k, "deny")}
                        className="btn btn-ghost btn-sm"
                        style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <X size={13} /> Deny
                      </button>
                    </div>
                  ))}
                </div>
                {requestedAt && (
                  <div style={{ fontSize: 10, color: "var(--primary-40)", marginTop: 6 }}>
                    Requested {new Date(requestedAt).toLocaleString()}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {pending && (
        <div
          onClick={() => !submitting && setPending(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,60,70,0.55)", backdropFilter: "blur(2px)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, maxWidth: 480, width: "100%", padding: 28, boxShadow: "0 20px 60px rgba(0,60,70,0.25)" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
              <div>
                <h2 style={{ fontSize: 22, color: "var(--primary)", margin: "0 0 6px", fontWeight: 400 }}>
                  {pending.decision === "approve" ? `Approve ${pending.kind}?` : `Deny ${pending.kind}?`}
                </h2>
                <p style={{ fontSize: 13.5, color: "var(--primary-60)", margin: 0, lineHeight: 1.5 }}>{pending.msg}</p>
              </div>
              <button type="button" onClick={() => !submitting && setPending(null)} style={{ background: "none", border: 0, cursor: "pointer", color: "var(--primary-50)", padding: 4 }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ marginTop: 22 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--primary-60)", marginBottom: 8 }}>
                {pending.decision === "deny" ? "Reason (optional, shown to customer)" : "Note (optional, shown to customer)"}
              </label>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={4}
                disabled={submitting}
                placeholder={pending.decision === "deny" ? "e.g. We're outside our cancellation window…" : "Any extra context to share."}
                style={{ width: "100%", borderRadius: 12, border: "1px solid rgba(0,95,106,0.15)", padding: "10px 12px", fontSize: 14, fontFamily: "inherit", color: "var(--ink)", resize: "vertical", outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
              <button type="button" onClick={() => !submitting && setPending(null)} disabled={submitting} className="btn btn-ghost">Cancel</button>
              <button
                type="button"
                onClick={confirmHandle}
                disabled={submitting}
                className="btn"
                style={{ background: pending.decision === "approve" ? "var(--primary)" : "#b91c1c", color: "#fff", border: 0, opacity: submitting ? 0.6 : 1 }}>
                {submitting ? "Working…" : pending.decision === "approve" ? "Approve" : "Deny"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
