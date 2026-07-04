"use client";

import { useEffect, useState } from "react";
import { Star, TrendingUp, Award, Clock } from "lucide-react";
import { getPerformanceData } from "../../actions/getPerformanceData";
import type { PerformanceData } from "../../actions/getPerformanceData.types";
import { SectionCard } from "./_shared";

function StarRow({ value }: { value: number }) {
  const filled = Math.round(value);
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`w-5 h-5 ${
            i < filled
              ? "fill-[#3E7596] text-[#3E7596]"
              : "text-[#008C9C]/20"
          }`}
        />
      ))}
    </div>
  );
}

function TrendChart({ data }: { data: PerformanceData["trend90Day"] }) {
  if (data.length === 0) {
    return (
      <p className="text-xs text-[#008C9C]/50 italic">
        No ratings yet in the last 90 days.
      </p>
    );
  }

  const width = 320;
  const height = 80;
  const padX = 8;
  const padY = 12;

  const xs = data.map((_, i) => i);
  const minX = 0;
  const maxX = Math.max(1, xs.length - 1);
  const minY = 1;
  const maxY = 5;

  const scaleX = (i: number) =>
    padX + ((i - minX) / (maxX - minX)) * (width - padX * 2);
  const scaleY = (v: number) =>
    height - padY - ((v - minY) / (maxY - minY)) * (height - padY * 2);

  const path = data
    .map((p, i) => `${i === 0 ? "M" : "L"} ${scaleX(i)} ${scaleY(p.average)}`)
    .join(" ");

  const last = data[data.length - 1];

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-20 overflow-visible">
        <line
          x1={padX}
          y1={scaleY(4)}
          x2={width - padX}
          y2={scaleY(4)}
          stroke="#008C9C"
          strokeOpacity="0.1"
          strokeDasharray="3 3"
        />
        <path
          d={path}
          fill="none"
          stroke="#008C9C"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {data.map((p, i) => (
          <circle
            key={i}
            cx={scaleX(i)}
            cy={scaleY(p.average)}
            r="2.5"
            fill="#008C9C"
          />
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-[#008C9C]/50 mt-1">
        <span>{new Date(data[0].date).toLocaleDateString("en-US")}</span>
        <span>Latest: {last.average.toFixed(2)}★</span>
      </div>
    </div>
  );
}

function formatDate(s: string) {
  return new Date(s).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface PerformanceSectionProps {
  employeeId?: string;
}

export default function PerformanceSection({
  employeeId,
}: PerformanceSectionProps) {
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const res = await getPerformanceData({ employeeId });
      if (cancelled) return;
      if (res.success) {
        setData(res.data);
        setError(null);
      } else {
        setError(res.error);
      }
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  if (loading) {
    return (
      <SectionCard title="Performance" icon={Award}>
        <p className="text-sm text-[#008C9C]/60">Loading performance...</p>
      </SectionCard>
    );
  }

  if (error || !data) {
    return (
      <SectionCard title="Performance" icon={Award}>
        <p className="text-sm text-red-600">
          {error ?? "Could not load performance data."}
        </p>
      </SectionCard>
    );
  }

  return (
    <div className="space-y-6">
      <SectionCard
        title="Current Rating"
        description="Average of ratings in the last 30 days."
        icon={Star}>
        <div className="cl-income-stats-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <div className="cl-income-mini">
            <div className="label">30-day rating</div>
            <div className="val">
              {data.rating30Day !== null ? data.rating30Day.toFixed(2) : "—"}
            </div>
            {data.rating30Day !== null ? (
              <div className="cl-form-hint">Based on {data.ratingCount30Day} rating{data.ratingCount30Day === 1 ? "" : "s"}</div>
            ) : (
              <div className="cl-form-hint">No ratings in the last 30 days</div>
            )}
          </div>
          <div className="cl-income-mini">
            <div className="label">Pay multiplier</div>
            <div className="val">{data.currentMultiplier.toFixed(2)}×</div>
            <div className="cl-form-hint">Tier: <strong style={{ color: "var(--ink)" }}>{data.tierLabel}</strong></div>
            {data.nextTierAt !== null && data.nextTierMultiplier !== null && (
              <div className="cl-form-hint">Reach {data.nextTierAt.toFixed(1)}★ for {data.nextTierMultiplier.toFixed(2)}×</div>
            )}
          </div>
          <div className="cl-income-mini">
            <div className="label">Rating window</div>
            <div className="val" style={{ fontSize: 15, fontFamily: "var(--font)", fontWeight: 500, lineHeight: 1.4 }}>
              Ratings count toward your average for 30 days.
            </div>
            {data.expiringSoon > 0 && (
              <div className="cl-form-hint" style={{ color: "var(--amber-700)" }}>{data.expiringSoon} rating{data.expiringSoon === 1 ? "" : "s"} expiring soon</div>
            )}
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="90-Day Trend"
        description="Daily average rating across the last 90 days."
        icon={TrendingUp}>
        <TrendChart data={data.trend90Day} />
      </SectionCard>

      <SectionCard
        title="Recent Ratings"
        description="Last 10 ratings received."
        icon={Star}>
        {data.recentRatings.length === 0 ? (
          <p style={{ fontSize: 13.5, color: "var(--primary-60)" }}>No recent ratings.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.recentRatings.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 16px", borderRadius: 12, background: "var(--primary-5)" }}>
                <StarRow value={r.rating} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 14, color: "var(--ink)", fontWeight: 600 }}>
                      {r.rating.toFixed(1)}&nbsp;{"★"}
                      {r.editedAt && (
                        <span style={{ fontSize: 11, color: "var(--primary-60)", fontWeight: 500, marginLeft: 6 }}>(edited)</span>
                      )}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--primary-60)" }}>{formatDate(r.createdAt)}</span>
                  </div>
                  {r.clientName && <p style={{ fontSize: 12, color: "var(--primary-70)", marginTop: 2 }}>Job for {r.clientName}</p>}
                  {r.notes && <p style={{ fontSize: 12, color: "var(--primary-70)", marginTop: 4, fontStyle: "italic" }}>"{r.notes}"</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
