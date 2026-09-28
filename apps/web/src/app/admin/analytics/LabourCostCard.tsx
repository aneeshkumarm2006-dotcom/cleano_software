"use client";

import { useEffect, useState, useCallback } from "react";
import DatePicker from "@/components/ui/DatePicker";
import PremiumSelect from "@/components/ui/PremiumSelect";
import Input from "@/components/ui/Input";
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
  // Bright tones for contrast on the dark teal gradient.
  const pctColor =
    pct == null ? "#cbd5e1" : pct >= 50 ? "#f87171" : pct >= 35 ? "#fbbf24" : "#34d399";

  return (
    <div className="an-labour">
      <div className="an-labour-top">
        <div className="an-labour-head">
          <p className="eyebrow" style={{ color: "rgba(255,255,255,0.6)" }}>Labour cost %</p>
          <div className="an-labour-pct" style={{ color: pctColor }}>
            {loading ? "…" : pct == null ? "—" : `${pct}%`}
          </div>
          <div className="an-labour-cap">
            {data
              ? `Cleaner payout ÷ service revenue · ${money(data.totals.labourCost)} of ${money(data.totals.serviceRevenue)} · ${data.totals.jobCount} jobs`
              : "Cleaner payout as a share of collected service revenue."}
          </div>
        </div>
        <div className="an-filters an-filters-light">
          <label>From<DatePicker size="sm" value={filters.dateFrom ?? ""} onChange={(v) => set("dateFrom", v)} placeholder="Any" /></label>
          <label>To<DatePicker size="sm" value={filters.dateTo ?? ""} onChange={(v) => set("dateTo", v)} placeholder="Any" /></label>
          <label>Service<PremiumSelect size="sm" value={filters.serviceType ?? ""} onChange={(v) => set("serviceType", v)} options={[{ value: "", label: "All types" }, ...(data?.options.serviceTypes ?? []).map((t) => ({ value: t, label: t }))]} /></label>
          <label>Cleaner<PremiumSelect size="sm" value={filters.cleanerId ?? ""} onChange={(v) => set("cleanerId", v)} options={[{ value: "", label: "All cleaners" }, ...(data?.options.cleaners ?? []).map((c) => ({ value: c.id, label: c.name }))]} /></label>
          <label>Area<Input size="sm" placeholder="e.g. Montréal" value={filters.area ?? ""} onChange={(e) => set("area", e.target.value)} /></label>
        </div>
      </div>

      {data && (
        <div className="an-labour-tiles">
          <Tile label="Service revenue" value={money(data.totals.serviceRevenue)} />
          <Tile label="Cleaner payout" value={money(data.totals.labourCost)} />
          {/* Both are customer-funded pass-throughs handed to the crew (D3), not
              company income and not a company cost. Neither has ever been inside
              serviceRevenue or labourCost above; the labels say so now. */}
          <Tile label="Tips (to cleaners)" value={money(data.totals.tipAmount)} />
          <Tile label="Taxes" value={money(data.totals.taxAmount)} />
          <Tile label="Parking (to cleaners)" value={money(data.totals.transportation)} />
          <Tile label="Discounts" value={money(data.totals.discountAmount)} accent="#fbbf24" />
          <Tile label="Refunds" value={money(data.totals.refundAmount)} accent="#fca5a5" />
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="an-labour-tile">
      <div className="an-labour-tile-label">{label}</div>
      <div className="an-labour-tile-value" style={accent ? { color: accent } : undefined}>{value}</div>
    </div>
  );
}
