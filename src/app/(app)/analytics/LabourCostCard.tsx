"use client";

import { useEffect, useState, useCallback } from "react";
import { Users } from "lucide-react";
import {
  getLabourCostMetric,
  type LabourMetric,
  type LabourFilters,
} from "../actions/getLabourCostMetric";

function money(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function LabourCostCard() {
  const [filters, setFilters] = useState<LabourFilters>({});
  const [data, setData] = useState<LabourMetric | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getLabourCostMetric(filters);
    if (res.success) {
      setData({
        labourPercentage: res.labourPercentage,
        totals: res.totals,
        options: res.options,
      });
    }
    setLoading(false);
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  function set<K extends keyof LabourFilters>(k: K, v: LabourFilters[K]) {
    setFilters((f) => ({ ...f, [k]: v || null }));
  }

  const pct = data?.labourPercentage;
  const pctColor =
    pct == null ? "#64748b" : pct >= 50 ? "#b91c1c" : pct >= 35 ? "#b45309" : "#15803d";

  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 24, marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <Users size={20} style={{ color: "#005F6A" }} />
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0a1f24" }}>Labour Cost %</h2>
      </div>
      <p style={{ fontSize: 13, color: "#64748b", marginBottom: 18 }}>
        Cleaner payout as a share of collected service revenue (completed &amp; paid jobs). Tips, taxes and transportation are excluded from revenue.
      </p>

      {/* Filters */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <Filter label="From">
          <input type="date" value={filters.dateFrom ?? ""} onChange={(e) => set("dateFrom", e.target.value)} style={INPUT} />
        </Filter>
        <Filter label="To">
          <input type="date" value={filters.dateTo ?? ""} onChange={(e) => set("dateTo", e.target.value)} style={INPUT} />
        </Filter>
        <Filter label="Service type">
          <select value={filters.serviceType ?? ""} onChange={(e) => set("serviceType", e.target.value)} style={INPUT}>
            <option value="">All</option>
            {data?.options.serviceTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Filter>
        <Filter label="Cleaner">
          <select value={filters.cleanerId ?? ""} onChange={(e) => set("cleanerId", e.target.value)} style={INPUT}>
            <option value="">All</option>
            {data?.options.cleaners.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Filter>
        <Filter label="Area">
          <input type="text" placeholder="e.g. Montréal" value={filters.area ?? ""} onChange={(e) => set("area", e.target.value)} style={INPUT} />
        </Filter>
      </div>

      {/* Headline */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 18 }}>
        <span style={{ fontSize: 44, fontWeight: 800, color: pctColor, lineHeight: 1 }}>
          {loading ? "…" : pct == null ? "—" : `${pct}%`}
        </span>
        <span style={{ fontSize: 14, color: "#64748b" }}>
          {data ? `${money(data.totals.labourCost)} labour / ${money(data.totals.serviceRevenue)} revenue · ${data.totals.jobCount} jobs` : ""}
        </span>
      </div>

      {/* Breakdown */}
      {data && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <Stat label="Service revenue" value={money(data.totals.serviceRevenue)} />
          <Stat label="Cleaner payout (labour)" value={money(data.totals.labourCost)} />
          <Stat label="Tips" value={money(data.totals.tipAmount)} />
          <Stat label="Taxes" value={money(data.totals.taxAmount)} />
          <Stat label="Transportation" value={money(data.totals.transportation)} />
          <Stat label="Discounts" value={money(data.totals.discountAmount)} />
          <Stat label="Refunds" value={money(data.totals.refundAmount)} />
        </div>
      )}
    </div>
  );
}

const INPUT: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  padding: "7px 10px",
  fontSize: 13,
  color: "#0a1f24",
  background: "#fff",
  minWidth: 120,
};

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "#f8fafc", border: "1px solid #f1f5f9", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#0a1f24" }}>{value}</div>
    </div>
  );
}
