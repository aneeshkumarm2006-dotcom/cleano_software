"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DollarSign, Users, Sparkles, Target, Upload, TrendingUp } from "lucide-react";
import { CPieChart, CLineChart } from "@/components/ui/Chart";
import type { CpaReport } from "@/lib/cpa-meta";
import { CHANNELS, PAID_CHANNELS, money, money2, pct } from "@/lib/cpa-meta";
import { addAdSpend } from "../actions/adSpendActions";

export default function ReportsView({ report }: { report: CpaReport }) {
  const router = useRouter();
  const [channel, setChannel] = useState("all");
  const [trendKey, setTrendKey] = useState<"bookings" | "cpa">("cpa");

  const rows = channel === "all" ? report.rows : report.rows.filter((r) => r.id === channel);
  const organic = report.rows.filter((r) => !r.paid && r.leads > 0);
  const donutData = report.rows
    .filter((r) => r.paid && r.spend > 0)
    .map((r) => ({ name: r.name, value: r.spend }));

  const presentChannels = report.rows.map((r) => r.id);

  return (
    <div className="admin-font">
      <header className="row-between" style={{ marginBottom: 24, alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div className="stack-8" style={{ minWidth: 0 }}>
          <p className="eyebrow">Marketing</p>
          <h1 className="display" style={{ fontSize: "clamp(34px, 4.2vw, 48px)", whiteSpace: "nowrap" }}>
            Lead source &amp; True CPA
          </h1>
        </div>
        <div className="cpa-filter">
          <span className="cpa-filter-label">Channel</span>
          <select className="aselect" value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="all">All channels</option>
            {CHANNELS.filter((c) => presentChannels.includes(c.id)).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </header>

      <div className="astat-grid" style={{ marginBottom: 24 }}>
        <Stat icon={DollarSign} label="Ad spend" value={money(report.totals.spend)} hint="paid channels" />
        <Stat icon={Users} label="Leads" value={report.totals.leads} hint="attributed contacts" />
        <Stat icon={Sparkles} label="First cleanings" value={report.totals.firstClean} hint="paying customers acquired" />
        <Stat icon={Target} label="True CPA" value={money2(report.totals.cpa)} hint="spend ÷ first cleanings" emphasize />
      </div>

      {/* Chart row */}
      <div className="cpa-charts" style={{ marginBottom: 24 }}>
        <div className="dcard">
          <div className="dcard-head"><h3>Spend by channel</h3><span style={{ fontSize: 12, color: "var(--primary-50)" }}>paid only</span></div>
          {donutData.length ? (
            <CPieChart data={donutData} dataKey="value" nameKey="name" height={260} />
          ) : (
            <div style={{ padding: "60px 0", textAlign: "center", color: "var(--primary-50)", fontSize: 14 }}>
              No ad spend recorded yet — add some below to see the channel split.
            </div>
          )}
        </div>
        <div className="dcard">
          <div className="dcard-head">
            <h3>Trend · last 6 months</h3>
            <div className="cpa-toggle">
              <button className={`cpa-toggle-btn ${trendKey === "cpa" ? "on" : ""}`} onClick={() => setTrendKey("cpa")}>CPA</button>
              <button className={`cpa-toggle-btn ${trendKey === "bookings" ? "on" : ""}`} onClick={() => setTrendKey("bookings")}>Bookings</button>
            </div>
          </div>
          <CLineChart data={report.trend} dataKeys={[trendKey]} xKey="name" height={260} />
        </div>
      </div>

      {/* CPA-by-source table */}
      <div className="atable-wrap" style={{ marginBottom: 24 }}>
        <div className="atable-scroll">
          <table className="atable cpa-table">
            <thead>
              <tr>
                <th>Source</th>
                <th className="num">Spend</th>
                <th className="num">Leads</th>
                <th className="num">Booked</th>
                <th className="num">First clean</th>
                <th className="num">Returning</th>
                <th className="num">Conv %</th>
                <th className="num cpa-col">True CPA</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
                      <span style={{ width: 9, height: 9, borderRadius: 3, background: r.color }} />
                      {r.name}
                      {!r.paid ? <span className="tagchip" style={{ marginLeft: 4 }}>organic</span> : null}
                    </span>
                  </td>
                  <td className="num">{r.spend > 0 ? money(r.spend) : <span style={{ color: "var(--primary-40)" }}>—</span>}</td>
                  <td className="num">{r.leads}</td>
                  <td className="num">{r.booked}</td>
                  <td className="num">{r.firstClean}</td>
                  <td className="num">{r.returning}</td>
                  <td className="num">{pct(r.conv)}</td>
                  <td className="num cpa-col" style={{ fontWeight: 700 }}>
                    {r.cpa != null ? money2(r.cpa) : <span style={{ color: "var(--emerald-600)", fontWeight: 600 }}>$0</span>}
                  </td>
                </tr>
              ))}
              {channel === "all" ? (
                <tr className="cpa-total-row">
                  <td style={{ fontWeight: 700 }}>Blended total</td>
                  <td className="num" style={{ fontWeight: 700 }}>{money(report.totals.spend)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{report.totals.leads}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{report.totals.booked}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{report.totals.firstClean}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{report.totals.returning}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{pct(report.totals.conv)}</td>
                  <td className="num cpa-col" style={{ fontWeight: 800 }}>{money2(report.totals.cpa)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="cpa-bottom">
        <SpendImportPanel onAdded={() => router.refresh()} />
        <OrganicSubReport organic={organic} />
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, hint, emphasize }: { icon: typeof DollarSign; label: string; value: string | number; hint: string; emphasize?: boolean }) {
  return (
    <div className="astat" style={emphasize ? { borderColor: "var(--primary-30)", boxShadow: "inset 0 0 0 1px var(--primary-15)" } : undefined}>
      <div className="astat-head"><span>{label}</span><span className="astat-icon"><Icon size={16} /></span></div>
      <div className="astat-value" style={emphasize ? { color: "var(--primary)" } : undefined}>{value}</div>
      <div className="astat-delta">{hint}</div>
    </div>
  );
}

function SpendImportPanel({ onAdded }: { onAdded: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [channel, setChannel] = useState(PAID_CHANNELS[0].id);
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    const amt = Number(amount);
    if (!amt || amt <= 0) { alert("Enter an amount greater than 0"); return; }
    startTransition(async () => {
      const res = await addAdSpend({ channel, date, amount: amt, source: "Manual" });
      if ("error" in res) { alert(res.error); return; }
      setAmount("");
      onAdded();
    });
  }

  return (
    <div className="dcard">
      <div className="dcard-head"><h3><Upload size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />Import ad spend</h3></div>
      <p style={{ fontSize: 13, color: "var(--primary-60)", margin: "0 0 14px" }}>
        Record spend by channel and date. Every entry live-recomputes True CPA across the report.
      </p>
      <div className="cpa-form">
        <div className="field">
          <label className="label">Channel</label>
          <select className="aselect" value={channel} onChange={(e) => setChannel(e.target.value)}>
            {PAID_CHANNELS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label">Date</label>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label className="label">Amount (CAD)</label>
          <input className="input" type="number" min="0" step="1" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <button className="btn btn-primary" disabled={pending} onClick={submit} style={{ alignSelf: "end" }}>Add spend</button>
      </div>
    </div>
  );
}

function OrganicSubReport({ organic }: { organic: CpaReport["rows"] }) {
  const max = useMemo(() => Math.max(1, ...organic.map((r) => r.firstClean)), [organic]);
  return (
    <div className="dcard">
      <div className="dcard-head"><h3><TrendingUp size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />Referral &amp; word-of-mouth</h3><span style={{ fontSize: 12, color: "var(--emerald-600)", fontWeight: 600 }}>$0 CPA</span></div>
      {organic.length === 0 ? (
        <div style={{ padding: "32px 0", textAlign: "center", color: "var(--primary-50)", fontSize: 14 }}>No organic channels with leads yet.</div>
      ) : (
        <div className="stack-12" style={{ marginTop: 6 }}>
          {organic.map((r) => (
            <div key={r.id}>
              <div className="row-between" style={{ marginBottom: 5 }}>
                <span style={{ fontSize: 13.5, color: "var(--ink)", fontWeight: 500 }}>{r.name}</span>
                <span style={{ fontSize: 12.5, color: "var(--primary-60)" }}>{r.firstClean} customers · {r.returning} repeat</span>
              </div>
              <div className="score-bar" style={{ maxWidth: "100%", height: 8 }}>
                <span className="score-fill" style={{ width: `${(r.firstClean / max) * 100}%`, background: r.color }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
