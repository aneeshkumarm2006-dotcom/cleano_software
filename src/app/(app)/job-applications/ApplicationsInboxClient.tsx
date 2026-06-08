"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { updateApplicationStatus } from "../actions/updateApplicationStatus";

type Status =
  | "NEW"
  | "CONTACTED"
  | "INTERVIEWING"
  | "HIRED"
  | "REJECTED"
  | "ARCHIVED";

interface Application {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  cityArea: string | null;
  availability: string | null;
  experience: string | null;
  hasTransport: boolean | null;
  resumeUrl: string | null;
  status: Status;
  notes: string | null;
  createdAt: string;
}

const STATUS_OPTIONS: Status[] = [
  "NEW",
  "CONTACTED",
  "INTERVIEWING",
  "HIRED",
  "REJECTED",
  "ARCHIVED",
];

const STATUS_TINT: Record<Status, { bg: string; fg: string }> = {
  NEW: { bg: "#fef3c7", fg: "#854d0e" },
  CONTACTED: { bg: "#dbeafe", fg: "#1e40af" },
  INTERVIEWING: { bg: "#ede9fe", fg: "#6d28d9" },
  HIRED: { bg: "#dcfce7", fg: "#15803d" },
  REJECTED: { bg: "#fee2e2", fg: "#b91c1c" },
  ARCHIVED: { bg: "#f1f5f9", fg: "#64748b" },
};

export default function ApplicationsInboxClient({
  applications,
}: {
  applications: Application[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<"ALL" | Status>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(
    applications[0]?.id ?? null
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<string>("");

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: applications.length };
    STATUS_OPTIONS.forEach((s) => {
      c[s] = applications.filter((a) => a.status === s).length;
    });
    return c;
  }, [applications]);

  const visible = useMemo(
    () => (filter === "ALL" ? applications : applications.filter((a) => a.status === filter)),
    [applications, filter]
  );

  const selected = applications.find((a) => a.id === selectedId) ?? null;

  async function setStatus(id: string, status: Status, notes?: string) {
    setSavingId(id);
    const res = await updateApplicationStatus({ applicationId: id, status, notes });
    setSavingId(null);
    if (res.success) router.refresh();
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "#0a1f24", marginBottom: 4 }}>
        Job Applications
      </h1>
      <p style={{ color: "#64748b", fontSize: 14, marginBottom: 20 }}>
        Applications from the public careers page.
      </p>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        {(["ALL", ...STATUS_OPTIONS] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            style={{
              padding: "6px 14px",
              borderRadius: 20,
              fontSize: 13,
              fontWeight: 600,
              border: "1px solid",
              borderColor: filter === s ? "#005F6A" : "#e2e8f0",
              background: filter === s ? "#005F6A" : "#fff",
              color: filter === s ? "#fff" : "#475569",
              cursor: "pointer",
            }}>
            {s} ({counts[s] ?? 0})
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 20 }}>
        {/* List */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {visible.length === 0 ? (
            <p style={{ color: "#94a3b8", fontSize: 14, padding: 24, textAlign: "center" }}>
              No applications.
            </p>
          ) : (
            visible.map((a) => (
              <button
                key={a.id}
                onClick={() => { setSelectedId(a.id); setNoteDraft(a.notes ?? ""); }}
                style={{
                  textAlign: "left",
                  background: a.id === selectedId ? "#f0f9fa" : "#fff",
                  border: "1px solid",
                  borderColor: a.id === selectedId ? "#005F6A" : "#e2e8f0",
                  borderRadius: 12,
                  padding: 14,
                  cursor: "pointer",
                }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 600, color: "#0a1f24" }}>{a.name}</span>
                  <span style={{ background: STATUS_TINT[a.status].bg, color: STATUS_TINT[a.status].fg, fontSize: 11, fontWeight: 600, borderRadius: 20, padding: "2px 10px" }}>
                    {a.status}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>
                  {a.cityArea ?? "—"} · {new Date(a.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Detail */}
        <div>
          {selected ? (
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0a1f24", marginBottom: 12 }}>
                {selected.name}
              </h2>
              <Row label="Email" value={selected.email} />
              <Row label="Phone" value={selected.phone ?? "—"} />
              <Row label="City / area" value={selected.cityArea ?? "—"} />
              <Row label="Availability" value={selected.availability ?? "—"} />
              <Row label="Transportation" value={selected.hasTransport == null ? "—" : selected.hasTransport ? "Yes" : "No"} />
              {selected.experience && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 2 }}>Experience</div>
                  <div style={{ fontSize: 14, color: "#0a1f24", whiteSpace: "pre-line" }}>{selected.experience}</div>
                </div>
              )}
              {selected.resumeUrl && (
                <a href={selected.resumeUrl} target="_blank" rel="noopener noreferrer"
                  style={{ display: "inline-block", marginTop: 12, fontSize: 14, color: "#005F6A", fontWeight: 600 }}>
                  View resume →
                </a>
              )}

              {/* Status actions */}
              <div style={{ marginTop: 18, borderTop: "1px solid #f1f5f9", paddingTop: 16 }}>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>Set status</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {STATUS_OPTIONS.map((s) => (
                    <button
                      key={s}
                      disabled={s === selected.status || savingId === selected.id}
                      onClick={() => setStatus(selected.id, s)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 600,
                        border: "none",
                        cursor: s === selected.status ? "default" : "pointer",
                        background: s === selected.status ? "#e2e8f0" : "#005F6A",
                        color: s === selected.status ? "#94a3b8" : "#fff",
                      }}>
                      {s}
                    </button>
                  ))}
                </div>

                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Admin notes</div>
                  <textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    rows={3}
                    style={{ width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", fontSize: 14, resize: "vertical" }}
                  />
                  <button
                    onClick={() => setStatus(selected.id, selected.status, noteDraft)}
                    disabled={savingId === selected.id}
                    style={{ marginTop: 8, padding: "7px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600, border: "none", background: "#005F6A", color: "#fff", cursor: "pointer" }}>
                    {savingId === selected.id ? "Saving…" : "Save notes"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <p style={{ color: "#94a3b8", fontSize: 14 }}>Select an application.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 14 }}>
      <span style={{ color: "#64748b" }}>{label}</span>
      <span style={{ color: "#0a1f24", fontWeight: 500, textAlign: "right" }}>{value}</span>
    </div>
  );
}
