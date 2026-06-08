"use client";

import { useEffect, useState, useCallback } from "react";
import { TrendingUp, TrendingDown, RefreshCw, PauseCircle } from "lucide-react";
import {
  getRetentionKpi,
  type RetentionKpi,
  type RetentionClientRow,
} from "../actions/getRetentionKpi";
import { updateRecurringCancellation } from "../actions/updateRecurringCancellation";

type Preset = "month" | "quarter" | "year" | "custom";
type Bucket = "retained" | "cancelled" | "paused" | "reactivated";

function fmtDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function presetRange(p: Exclude<Preset, "custom">): { from: string; to: string } {
  const now = new Date();
  const to = fmtDate(now);
  if (p === "month") return { from: fmtDate(new Date(now.getFullYear(), now.getMonth(), 1)), to };
  if (p === "quarter") {
    const q = Math.floor(now.getMonth() / 3) * 3;
    return { from: fmtDate(new Date(now.getFullYear(), q, 1)), to };
  }
  return { from: fmtDate(new Date(now.getFullYear(), 0, 1)), to };
}

export default function RetentionKpiClient() {
  const [preset, setPreset] = useState<Preset>("month");
  const [range, setRange] = useState(presetRange("month"));
  const [data, setData] = useState<RetentionKpi | null>(null);
  const [loading, setLoading] = useState(true);
  const [bucket, setBucket] = useState<Bucket>("cancelled");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getRetentionKpi(range);
    if (res.success) setData(res);
    setLoading(false);
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);

  function choosePreset(p: Preset) {
    setPreset(p);
    if (p !== "custom") setRange(presetRange(p));
  }

  async function markReplied(cancellationId: string | null) {
    if (!cancellationId) return;
    await updateRecurringCancellation({ id: cancellationId, markReplied: true });
    load();
  }

  const rows: RetentionClientRow[] = data ? data[bucket] : [];

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "#0a1f24", marginBottom: 4 }}>
        Recurring Client Retention
      </h1>
      <p style={{ color: "#64748b", fontSize: 14, marginBottom: 20 }}>
        How many recurring customers stay with us over time.
      </p>

      {/* Period selector */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 22 }}>
        {(["month", "quarter", "year", "custom"] as Preset[]).map((p) => (
          <button key={p} onClick={() => choosePreset(p)}
            style={{
              padding: "6px 14px", borderRadius: 20, fontSize: 13, fontWeight: 600,
              border: "1px solid", borderColor: preset === p ? "#005F6A" : "#e2e8f0",
              background: preset === p ? "#005F6A" : "#fff", color: preset === p ? "#fff" : "#475569",
              cursor: "pointer",
            }}>
            {p === "month" ? "This month" : p === "quarter" ? "This quarter" : p === "year" ? "This year" : "Custom"}
          </button>
        ))}
        {preset === "custom" && (
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} style={DATE} />
            <span style={{ color: "#94a3b8" }}>→</span>
            <input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} style={DATE} />
          </span>
        )}
      </div>

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 26 }}>
        <KpiCard
          icon={<TrendingUp size={18} />}
          tint="#15803d"
          label="Retention rate"
          value={loading ? "…" : data?.retentionRate == null ? "—" : `${data.retentionRate}%`}
          sub={data ? `${data.retainedCount} of ${data.startingCount} retained` : ""}
        />
        <KpiCard
          icon={<TrendingDown size={18} />}
          tint="#b91c1c"
          label="Churn rate"
          value={loading ? "…" : data?.churnRate == null ? "—" : `${data.churnRate}%`}
          sub={data ? `${data.cancelledCount} cancelled` : ""}
        />
        <KpiCard
          icon={<RefreshCw size={18} />}
          tint="#1e40af"
          label="Reactivations"
          value={loading ? "…" : String(data?.reactivatedCount ?? 0)}
          sub="won back this period"
        />
        <KpiCard
          icon={<PauseCircle size={18} />}
          tint="#b45309"
          label="Paused / inactive"
          value={loading ? "…" : String(data?.pausedCount ?? 0)}
          sub="recurring, deactivated"
        />
      </div>

      {/* Drill-down */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {(["retained", "cancelled", "paused", "reactivated"] as Bucket[]).map((b) => {
          const count = data ? data[b].length : 0;
          return (
            <button key={b} onClick={() => setBucket(b)}
              style={{
                padding: "6px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                border: "1px solid", borderColor: bucket === b ? "#005F6A" : "#e2e8f0",
                background: bucket === b ? "#f0f9fa" : "#fff", color: bucket === b ? "#005F6A" : "#475569",
                cursor: "pointer", textTransform: "capitalize",
              }}>
              {b} ({count})
            </button>
          );
        })}
      </div>

      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden" }}>
        {rows.length === 0 ? (
          <p style={{ padding: 28, textAlign: "center", color: "#94a3b8", fontSize: 14 }}>
            No clients in this bucket for the selected period.
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#f8fafc", textAlign: "left", color: "#64748b", fontSize: 12 }}>
                <th style={TH}>Client</th>
                <th style={TH}>Frequency</th>
                {bucket === "cancelled" && <th style={TH}>Cancelled</th>}
                {bucket === "cancelled" && <th style={TH}>Offer</th>}
                {bucket === "reactivated" && <th style={TH}>Reactivated</th>}
                {bucket === "cancelled" && <th style={TH}>Reply</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.clientId}-${r.cancellationId ?? "x"}`} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={TD}>
                    <div style={{ fontWeight: 600, color: "#0a1f24" }}>{r.name}</div>
                    <div style={{ fontSize: 12, color: "#94a3b8" }}>{r.email ?? "—"}</div>
                  </td>
                  <td style={TD}>{r.frequency ?? "—"}</td>
                  {bucket === "cancelled" && (
                    <td style={TD}>{r.cancelledAt ? new Date(r.cancelledAt).toLocaleDateString() : "—"}</td>
                  )}
                  {bucket === "cancelled" && (
                    <td style={TD}>
                      <span style={{ fontSize: 12, color: "#475569" }}>{r.offerStatus ?? "—"}</span>
                      {r.reactivatedAt && <span style={{ fontSize: 11, color: "#15803d", marginLeft: 6 }}>· reactivated</span>}
                    </td>
                  )}
                  {bucket === "reactivated" && (
                    <td style={TD}>{r.reactivatedAt ? new Date(r.reactivatedAt).toLocaleDateString() : "—"}</td>
                  )}
                  {bucket === "cancelled" && (
                    <td style={TD}>
                      {r.repliedAt ? (
                        <span style={{ fontSize: 12, color: "#15803d" }}>Replied</span>
                      ) : (
                        <button onClick={() => markReplied(r.cancellationId)}
                          style={{ fontSize: 12, color: "#005F6A", background: "none", border: "1px solid #cbd5e1", borderRadius: 6, padding: "3px 8px", cursor: "pointer" }}>
                          Mark replied
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const DATE: React.CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 9px", fontSize: 13 };
const TH: React.CSSProperties = { padding: "10px 14px", fontWeight: 600 };
const TD: React.CSSProperties = { padding: "10px 14px", color: "#0a1f24", verticalAlign: "top" };

function KpiCard({ icon, tint, label, value, sub }: { icon: React.ReactNode; tint: string; label: string; value: string; sub: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: tint, marginBottom: 10 }}>
        {icon}
        <span style={{ fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
      </div>
      <div style={{ fontSize: 32, fontWeight: 800, color: tint, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6 }}>{sub}</div>
    </div>
  );
}
