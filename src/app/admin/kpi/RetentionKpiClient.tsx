"use client";

import { useEffect, useState, useCallback } from "react";
import RingChart from "@/components/ui/RingChart";
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
function avatarBg(name: string): string {
  const palette = ["#2c6e75","#1a5c63","#3d7f87","#0e4a52","#4f9097","#246a72","#538c94","#1c6068"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0x7fffffff;
  return palette[h % palette.length];
}
function initials(name: string): string {
  return (name || "?").split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase();
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
  const [bucket, setBucket] = useState<Bucket>("retained");
  // Tracks whether the user has manually picked a bucket; until then we
  // auto-select the first bucket that actually has rows for the period.
  const [bucketTouched, setBucketTouched] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getRetentionKpi(range);
    if (res.success) setData(res);
    setLoading(false);
  }, [range]);

  useEffect(() => { load(); }, [load]);

  // When new data arrives and the user hasn't chosen a tab, open on the first
  // bucket that has data (retained first), so the page never lands on an empty tab.
  useEffect(() => {
    if (!data || bucketTouched) return;
    const order: Bucket[] = ["retained", "cancelled", "paused", "reactivated"];
    const firstWithData = order.find((b) => data[b].length > 0);
    setBucket(firstWithData ?? "retained");
  }, [data, bucketTouched]);

  function chooseBucket(b: Bucket) {
    setBucketTouched(true);
    setBucket(b);
  }

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
  const retentionRate = data?.retentionRate ?? 0;
  const churnRate = data?.churnRate ?? 0;
  const v = (n: string | number) => (loading ? "…" : n);

  const PERIODS: { id: Preset; label: string }[] = [
    { id: "month", label: "This month" },
    { id: "quarter", label: "This quarter" },
    { id: "year", label: "This year" },
    { id: "custom", label: "Custom" },
  ];
  const BUCKETS: { id: Bucket; label: string }[] = [
    { id: "retained", label: "Retained" },
    { id: "cancelled", label: "Cancelled" },
    { id: "paused", label: "Paused" },
    { id: "reactivated", label: "Reactivated" },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <header style={{ marginBottom: 24 }}>
        <p className="eyebrow">Insights · Retention</p>
        <h1 className="display" style={{ fontSize: "clamp(32px, 4.2vw, 46px)", marginTop: 6 }}>
          Recurring client <em>retention.</em>
        </h1>
        <p className="subtitle" style={{ marginTop: 10, fontSize: 15.5 }}>
          How many recurring customers stay, churn, pause, or come back.
        </p>
      </header>

      {/* Period selector */}
      <div className="k-period">
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {PERIODS.map((p) => (
            <button key={p.id} className={`an-chip ${preset === p.id ? "active" : ""}`} onClick={() => choosePreset(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="row" style={{ gap: 10 }}>
            <label className="k-date">From<input type="date" className="input" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} /></label>
            <label className="k-date">To<input type="date" className="input" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} /></label>
          </div>
        )}
      </div>

      {/* KPI cards + ring */}
      <div className="k-top">
        <div className="k-cards">
          <div className="an-tile">
            <div className="an-tile-label">Retention rate</div>
            <div className="an-tile-value" style={{ color: "var(--emerald-600)" }}>{v(data?.retentionRate == null ? "—" : `${data.retentionRate}%`)}</div>
            <div className="an-tile-hint">{data ? `${data.retainedCount} of ${data.startingCount} retained` : ""}</div>
          </div>
          <div className="an-tile">
            <div className="an-tile-label">Churn rate</div>
            <div className="an-tile-value" style={{ color: churnRate > 25 ? "var(--error)" : "var(--amber-700)" }}>{v(data?.churnRate == null ? "—" : `${data.churnRate}%`)}</div>
            <div className="an-tile-hint">{data ? `${data.cancelledCount} cancelled` : ""}</div>
          </div>
          <div className="an-tile">
            <div className="an-tile-label">Reactivations</div>
            <div className="an-tile-value" style={{ color: "var(--primary)" }}>{v(data?.reactivatedCount ?? 0)}</div>
            <div className="an-tile-hint">won back this period</div>
          </div>
          <div className="an-tile">
            <div className="an-tile-label">Paused / inactive</div>
            <div className="an-tile-value" style={{ color: "var(--amber-700)" }}>{v(data?.pausedCount ?? 0)}</div>
            <div className="an-tile-hint">recurring, deactivated</div>
          </div>
        </div>
        <div className="dcard k-ring">
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <RingChart used={data?.retainedCount ?? 0} total={data?.startingCount || 1} size={140} strokeWidth={12} usedColor="#059669" remainingColor="var(--cream-deep)" />
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>Retention</div>
              <div style={{ fontSize: 12, color: "var(--primary-60)" }}>{data?.retainedCount ?? 0}/{data?.startingCount ?? 0} clients</div>
            </div>
          </div>
        </div>
      </div>

      {/* Bucket filter */}
      <div className="row" style={{ gap: 8, flexWrap: "wrap", margin: "24px 0 16px" }}>
        {BUCKETS.map((b) => (
          <button key={b.id} className={`k-bucket ${bucket === b.id ? "active" : ""}`} onClick={() => chooseBucket(b.id)}>
            {b.label}<span className="k-bucket-count">{data ? data[b.id].length : 0}</span>
          </button>
        ))}
      </div>

      {/* Client table */}
      <div className="atable-wrap">
        <div className="atable-scroll">
          <table className="atable">
            <thead>
              <tr>
                <th>Client</th>
                <th>Frequency</th>
                {bucket === "cancelled" && <><th>Cancelled</th><th>Win-back offer</th><th>Reply</th><th></th></>}
                {bucket === "reactivated" && <th>Reactivated</th>}
                {bucket === "paused" && <th>Status</th>}
                {bucket === "retained" && <th>Recurring since</th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: "center", padding: 48, color: "var(--primary-50)" }}>
                  {loading ? "Loading…" : "No clients in this bucket for the selected period."}
                </td></tr>
              ) : rows.map((r) => (
                <tr key={`${r.clientId}-${r.cancellationId ?? "x"}`} style={{ cursor: "default" }}>
                  <td>
                    <div className="row" style={{ gap: 10 }}>
                      <div className="avatar" style={{ background: avatarBg(r.name) }}>{initials(r.name)}</div>
                      <div><div className="col-client">{r.name}</div><div className="col-client-sub">{r.email ?? "—"}</div></div>
                    </div>
                  </td>
                  <td><span className="pill" style={{ background: "var(--primary-5)", color: "var(--primary)" }}>{r.frequency ?? "—"}</span></td>

                  {bucket === "cancelled" && (
                    <>
                      <td style={{ fontSize: 13, color: "var(--ink-soft)" }}>{r.cancelledAt ? new Date(r.cancelledAt).toLocaleDateString() : "—"}</td>
                      <td style={{ fontSize: 13, color: "var(--primary-70)" }}>
                        {r.offerStatus ?? "—"}
                        {r.reactivatedAt && <span style={{ fontSize: 11, color: "var(--emerald-600)", marginLeft: 6 }}>· reactivated</span>}
                      </td>
                      <td>
                        {r.repliedAt
                          ? <span style={{ fontSize: 12.5, color: "var(--emerald-600)" }}>Replied</span>
                          : <span className="pill" style={{ background: "var(--amber-100)", color: "var(--amber-800)" }}>Awaiting reply</span>}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {!r.repliedAt && <button className="btn btn-secondary btn-sm" onClick={() => markReplied(r.cancellationId)}>Mark replied</button>}
                      </td>
                    </>
                  )}
                  {bucket === "reactivated" && <td style={{ fontSize: 13, color: "var(--emerald-600)", fontWeight: 600 }}>{r.reactivatedAt ? new Date(r.reactivatedAt).toLocaleDateString() : "—"}</td>}
                  {bucket === "paused" && <td style={{ fontSize: 13, color: "var(--primary-70)" }}>Deactivated</td>}
                  {bucket === "retained" && <td style={{ fontSize: 13, color: "var(--ink-soft)" }}>{r.startDate ? new Date(r.startDate).toLocaleDateString() : "—"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
