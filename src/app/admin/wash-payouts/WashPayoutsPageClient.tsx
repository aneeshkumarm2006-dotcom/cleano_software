"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Sparkles,
  Wallet,
  Users,
  AlertTriangle,
  Search,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";
import { overrideRagWashFlag } from "../actions/overrideRagWashFlag";

type Status = "PENDING" | "COMPLETED" | "FAILED";

interface CleanerLedgerRow {
  id: string;
  name: string;
  email: string;
  ragCredits: number;
  padCredits: number;
}

interface PayoutRow {
  id: string;
  employeeId: string;
  employeeName: string;
  amount: number;
  ragCreditsUsed: number;
  padCreditsUsed: number;
  status: Status;
  createdAt: string;
}

interface FlaggedJobRow {
  id: string;
  jobNumber: number;
  clientName: string;
  clockOutTime: string | null;
  projectedRags: number | null;
  actualRags: number | null;
  employeeName: string;
}

interface Props {
  cleaners: CleanerLedgerRow[];
  payouts: PayoutRow[];
  flaggedJobs: FlaggedJobRow[];
}

type Tab = "ledger" | "payouts" | "flags";

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function WashPayoutsPageClient({
  cleaners,
  payouts,
  flaggedJobs,
}: Props) {
  const [tab, setTab] = useState<Tab>("ledger");
  const [search, setSearch] = useState("");
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [, startReview] = useTransition();

  function handleOverride(jobId: string) {
    setReviewingId(jobId);
    startReview(async () => {
      const result = await overrideRagWashFlag(jobId);
      setReviewingId(null);
      if (!result.success) {
        alert(result.error ?? "Failed to clear flag");
      }
    });
  }

  const filteredCleaners = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cleaners;
    return cleaners.filter(
      (c) =>
        c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
    );
  }, [cleaners, search]);

  const totalPaid = payouts
    .filter((p) => p.status === "COMPLETED")
    .reduce((s, p) => s + p.amount, 0);
  const pendingTotal = payouts
    .filter((p) => p.status === "PENDING")
    .reduce((s, p) => s + p.amount, 0);
  const ledgerOpenTotal = cleaners.reduce(
    (s, c) => s + (c.ragCredits / 50) * 3 + (c.padCredits / 20) * 2,
    0
  );

  return (
    <div className="admin-font">
      <header
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginBottom: 32,
          gap: 16,
          flexWrap: "wrap",
        }}>
        <div>
          <p className="admin-eyebrow">Operations</p>
          <h1 className="admin-page-title">
            Wash payouts{" "}
            <span style={{ color: "var(--primary-40)", fontWeight: 300 }}>
              · {cleaners.length}
            </span>
          </h1>
        </div>
      </header>

      <div className="astat-grid" style={{ marginBottom: 28 }}>
        <div className="astat">
          <div className="astat-head">
            <span className="astat-label">Total cleaners</span>
            <div className="astat-icon"><Users size={15} /></div>
          </div>
          <div className="astat-value">{cleaners.length}</div>
        </div>
        <div className="astat">
          <div className="astat-head">
            <span className="astat-label">Pending payouts</span>
            <div className="astat-icon"><Clock size={15} /></div>
          </div>
          <div className="astat-value">${pendingTotal.toFixed(2)}</div>
        </div>
        <div className="astat">
          <div className="astat-head">
            <span className="astat-label">Paid all-time</span>
            <div className="astat-icon"><Wallet size={15} /></div>
          </div>
          <div className="astat-value">${totalPaid.toFixed(2)}</div>
        </div>
        <div className="astat">
          <div className="astat-head">
            <span className="astat-label">Outstanding credits</span>
            <div className="astat-icon"><Sparkles size={15} /></div>
          </div>
          <div className="astat-value">${ledgerOpenTotal.toFixed(2)}</div>
          <div className="astat-delta">claimable by cleaners</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ marginBottom: 18 }}>
        <div className="atabs">
          <button
            type="button"
            className={`atab ${tab === "ledger" ? "active" : ""}`}
            onClick={() => setTab("ledger")}>
            Cleaner ledger
            <span className="atab-count">{cleaners.length}</span>
          </button>
          <button
            type="button"
            className={`atab ${tab === "payouts" ? "active" : ""}`}
            onClick={() => setTab("payouts")}>
            Payouts
            <span className="atab-count">{payouts.length}</span>
          </button>
          <button
            type="button"
            className={`atab ${tab === "flags" ? "active" : ""}`}
            onClick={() => setTab("flags")}>
            Flagged jobs
            <span className="atab-count">{flaggedJobs.length}</span>
          </button>
        </div>
      </div>

      {tab === "ledger" && (
        <>
          <div className="atoolbar" style={{ marginBottom: 18 }}>
            <div className="atoolbar-search">
              <Search className="atoolbar-search-icon" size={16} />
              <input
                className="input"
                type="search"
                placeholder="Search cleaners…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          {filteredCleaners.length === 0 ? (
            <div
              style={{
                padding: 32,
                textAlign: "center",
                color: "var(--primary-50)",
                background: "#fff",
                border: "1px solid var(--primary-10)",
                borderRadius: 14,
              }}>
              No cleaners match this search.
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gap: 10,
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              }}>
              {filteredCleaners.map((c) => {
                const ragUnits = Math.floor(c.ragCredits / 50);
                const padUnits = Math.floor(c.padCredits / 20);
                const claimable = ragUnits * 3 + padUnits * 2;
                return (
                  <article
                    key={c.id}
                    style={{
                      background: "#fff",
                      border: "1px solid var(--primary-10)",
                      borderRadius: 14,
                      padding: 16,
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--primary-deep)" }}>
                        {c.name}
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--primary-50)" }}>
                        {c.email}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 18, fontSize: 12 }}>
                      <div>
                        <div style={{ color: "var(--primary-50)", fontWeight: 600 }}>Rag credits</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--primary-deep)", fontVariantNumeric: "tabular-nums" }}>
                          {c.ragCredits}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: "var(--primary-50)", fontWeight: 600 }}>Pad credits</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--primary-deep)", fontVariantNumeric: "tabular-nums" }}>
                          {c.padCredits}
                        </div>
                      </div>
                    </div>
                    <div
                      style={{
                        marginTop: 2,
                        padding: "8px 12px",
                        borderRadius: 10,
                        background: claimable > 0 ? "rgba(16, 185, 129, 0.08)" : "var(--primary-5)",
                        color: claimable > 0 ? "#047857" : "var(--primary-60)",
                        fontSize: 12,
                        fontWeight: 600,
                      }}>
                      ${claimable.toFixed(2)} claimable
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === "payouts" && (
        <div
          style={{
            background: "#fff",
            border: "1px solid var(--primary-10)",
            borderRadius: 14,
            overflow: "hidden",
          }}>
          {payouts.length === 0 ? (
            <div style={{ textAlign: "center", padding: 32, fontSize: 13, color: "var(--primary-50)" }}>
              No payouts yet.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--primary-5)", textAlign: "left" }}>
                  <th style={th}>Cleaner</th>
                  <th style={th}>Amount</th>
                  <th style={th}>Credits used</th>
                  <th style={th}>Status</th>
                  <th style={th}>Date</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id} style={{ borderTop: "1px solid var(--primary-10)" }}>
                    <td style={td}>{p.employeeName}</td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
                      ${p.amount.toFixed(2)}
                    </td>
                    <td style={{ ...td, fontSize: 12, color: "var(--primary-60)" }}>
                      {p.ragCreditsUsed} rag · {p.padCreditsUsed} pad
                    </td>
                    <td style={td}>
                      <StatusPill status={p.status} />
                    </td>
                    <td style={{ ...td, fontSize: 12, color: "var(--primary-60)" }}>
                      {fmt(p.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      )}

      {tab === "flags" && (
        <div
          style={{
            background: "#fff",
            border: "1px solid var(--primary-10)",
            borderRadius: 14,
            overflow: "hidden",
          }}>
          {flaggedJobs.length === 0 ? (
            <div style={{ textAlign: "center", padding: 32, fontSize: 13, color: "var(--primary-50)" }}>
              No jobs over projection in the last 50 completed.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--primary-5)", textAlign: "left" }}>
                  <th style={th}>Job</th>
                  <th style={th}>Client</th>
                  <th style={th}>Cleaner</th>
                  <th style={th}>Projected</th>
                  <th style={th}>Actual</th>
                  <th style={th}>Completed</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {flaggedJobs.map((j) => (
                  <tr key={j.id} style={{ borderTop: "1px solid var(--primary-10)" }}>
                    <td style={td}>#{j.jobNumber}</td>
                    <td style={td}>{j.clientName}</td>
                    <td style={td}>{j.employeeName}</td>
                    <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>
                      {j.projectedRags ?? 0}
                    </td>
                    <td
                      style={{
                        ...td,
                        fontVariantNumeric: "tabular-nums",
                        color: "#b91c1c",
                        fontWeight: 700,
                      }}>
                      {j.actualRags ?? 0}
                    </td>
                    <td style={{ ...td, fontSize: 12, color: "var(--primary-60)" }}>
                      {fmt(j.clockOutTime)}
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <button
                        type="button"
                        disabled={reviewingId === j.id}
                        onClick={() => handleOverride(j.id)}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 6,
                          background: reviewingId === j.id ? "var(--primary-30)" : "var(--primary)",
                          color: "#fff",
                          fontSize: 12,
                          fontWeight: 600,
                          border: "none",
                          cursor: reviewingId === j.id ? "default" : "pointer",
                        }}>
                        {reviewingId === j.id ? "Clearing…" : "Mark reviewed"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
          <div
            style={{
              padding: "10px 16px",
              fontSize: 11.5,
              color: "var(--primary-60)",
              background: "var(--primary-5)",
              borderTop: "1px solid var(--primary-10)",
            }}>
            <AlertTriangle size={11} style={{ verticalAlign: "middle", marginRight: 4 }} />
            Jobs where actual rag use exceeded projection by ≥10%. Review for accuracy or special-case adjustments.
          </div>
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = {
  padding: "10px 14px",
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--primary-60)",
};

const td: React.CSSProperties = {
  padding: "12px 14px",
  fontSize: 13,
  color: "var(--ink)",
};

function StatusPill({ status }: { status: Status }) {
  const map = {
    PENDING: { bg: "rgba(234, 179, 8, 0.14)", color: "#b45309", icon: <Clock size={12} /> },
    COMPLETED: { bg: "rgba(16, 185, 129, 0.14)", color: "#047857", icon: <CheckCircle2 size={12} /> },
    FAILED: { bg: "rgba(220, 38, 38, 0.12)", color: "#b91c1c", icon: <XCircle size={12} /> },
  } as const;
  const cfg = map[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 9px",
        borderRadius: 999,
        background: cfg.bg,
        color: cfg.color,
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
      }}>
      {cfg.icon}
      {status}
    </span>
  );
}
