"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Wallet, Users, DollarSign, Calendar, AlertTriangle,
  ChevronDown, ChevronUp, Loader, Check,
} from "lucide-react";
import DatePicker from "@/components/ui/DatePicker";
import { createPayPeriod } from "../actions/createPayPeriod";
import PayPeriodDetail from "./PayPeriodDetail";

export type PayoutRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  baseAmount: number;
  adjustments: number;
  deductions: number;
  reimbursements: number;
  finalAmount: number;
  jobCount: number;
  totalHours: number;
  notes: string | null;
};

export type PayPeriodRow = {
  id: string;
  startDate: string;
  endDate: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "PAID" | "CANCELLED" | "REJECTED";
  notes: string | null;
  approvedAt: string | null;
  approvedBy: { id: string; name: string } | null;
  paidAt: string | null;
  totalFinal: number;
  employeeCount: number;
  payouts: PayoutRow[];
};

const STATUS_PILL: Record<PayPeriodRow["status"], { bg: string; color: string }> = {
  DRAFT:            { bg: "#f1f5f9", color: "#475569" },
  PENDING_APPROVAL: { bg: "#fffbeb", color: "#d97706" },
  APPROVED:         { bg: "#eff6ff", color: "#1d4ed8" },
  PAID:             { bg: "#dcfce7", color: "#15803d" },
  CANCELLED:        { bg: "#fee2e2", color: "#b91c1c" },
  REJECTED:         { bg: "#fee2e2", color: "#b91c1c" },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function PayoutsPageClient({ initialPeriods }: { initialPeriods: PayPeriodRow[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState(false);
  const [startDate, setStartDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 14); return d.toISOString().slice(0, 10); });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const stats = useMemo(() => ({
    totalPayouts: initialPeriods.reduce((s, p) => s + p.totalFinal, 0),
    drafts: initialPeriods.filter(p => p.status === "DRAFT").length,
    pendingApproval: initialPeriods.filter(p => p.status === "APPROVED").length,
    paidThisYear: initialPeriods.filter(p => p.status === "PAID" && p.paidAt && new Date(p.paidAt).getFullYear() === new Date().getFullYear()).reduce((s, p) => s + p.totalFinal, 0),
  }), [initialPeriods]);

  const handleCreate = async () => {
    setCreating(true);
    setCreateError(null);
    setCreateSuccess(false);
    const fd = new FormData();
    fd.append("startDate", startDate);
    fd.append("endDate", endDate);
    fd.append("notes", notes);
    const result = await createPayPeriod(fd);
    setCreating(false);
    if (result.error) {
      setCreateError(result.error);
    } else {
      setCreateSuccess(true);
      setTimeout(() => { setShowCreate(false); setCreateSuccess(false); setNotes(""); router.refresh(); }, 600);
    }
  };

  return (
    <div className="admin-font stack-24">
      <header className="row-between" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div className="stack-8">
          <p className="eyebrow">Finance</p>
          <h1 className="display">Payouts</h1>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setShowCreate(v => !v)}>
          <Plus size={16} /> New Pay Period
        </button>
      </header>

      <div className="astat-grid">
        <div className="astat">
          <div className="astat-head"><span>Total payouts</span><span className="astat-icon"><Wallet size={15} /></span></div>
          <div className="astat-value">${stats.totalPayouts.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
        </div>
        <div className="astat">
          <div className="astat-head"><span>Paid this year</span><span className="astat-icon"><DollarSign size={15} /></span></div>
          <div className="astat-value">${stats.paidThisYear.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
        </div>
        <div className="astat" style={stats.drafts > 0 ? { borderLeft: "3px solid #d97706" } : {}}>
          <div className="astat-head" style={stats.drafts > 0 ? { color: "#92400e" } : {}}>
            <span>Draft periods</span>
            <span className="astat-icon" style={stats.drafts > 0 ? { background: "#fffbeb", color: "#d97706" } : {}}>
              <AlertTriangle size={15} />
            </span>
          </div>
          <div className="astat-value" style={stats.drafts > 0 ? { color: "#92400e" } : {}}>{stats.drafts}</div>
          <div className="astat-delta">{stats.drafts > 0 ? "needs attention" : "none pending"}</div>
        </div>
        <div className="astat">
          <div className="astat-head"><span>Awaiting payment</span><span className="astat-icon"><Users size={15} /></span></div>
          <div className="astat-value">{stats.pendingApproval}</div>
          <div className="astat-delta">approved periods</div>
        </div>
      </div>

      {errorMsg && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "12px 16px", fontSize: 13, color: "#b91c1c", display: "flex", gap: 10, alignItems: "center" }}>
          <AlertTriangle size={14} />
          <span style={{ flex: 1 }}>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg(null)} style={{ fontSize: 12, color: "#b91c1c", cursor: "pointer", textDecoration: "underline", background: "none", border: 0 }}>dismiss</button>
        </div>
      )}

      {showCreate && (
        <div className="atable-wrap" style={{ padding: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--primary)", marginBottom: 20 }}>Create Pay Period</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
            <div className="field">
              <label className="label">Start Date</label>
              <DatePicker value={startDate} onChange={setStartDate} disabled={creating} size="md" />
            </div>
            <div className="field">
              <label className="label">End Date</label>
              <DatePicker value={endDate} onChange={setEndDate} disabled={creating} size="md" />
            </div>
            <div className="field">
              <label className="label">Notes</label>
              <input
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                disabled={creating}
                placeholder="Optional"
                className="input"
              />
            </div>
          </div>
          {createError && <p style={{ fontSize: 13, color: "#b91c1c", marginTop: 12 }}>{createError}</p>}
          {createSuccess && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#15803d", marginTop: 12 }}>
              <Check size={14} /> Pay period created successfully
            </div>
          )}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
            <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)} disabled={creating}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={handleCreate} disabled={creating} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {creating ? <><Loader size={14} className="animate-spin" /> Creating…</> : <><Check size={14} /> Create Period</>}
            </button>
          </div>
        </div>
      )}

      {initialPeriods.length === 0 ? (
        <div className="atable-wrap" style={{ padding: "80px 40px", textAlign: "center", color: "var(--primary-60)" }}>
          No pay periods yet. Create one to start managing payouts.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {initialPeriods.map(p => {
            const isExpanded = expandedId === p.id;
            const pill = STATUS_PILL[p.status];
            return (
              <div key={p.id} className="atable-wrap" style={{ overflow: "hidden", padding: 0 }}>
                <div
                  style={{ padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
                  onClick={() => setExpandedId(isExpanded ? null : p.id)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, flex: 1, minWidth: 0 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 12, background: "var(--primary-5)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Calendar size={18} style={{ color: "var(--primary)" }} />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <span className="col-client">{formatDate(p.startDate)} — {formatDate(p.endDate)}</span>
                        <span style={{ display: "inline-block", background: pill.bg, color: pill.color, fontSize: 10, fontWeight: 700, borderRadius: 20, padding: "2px 8px", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                          {p.status}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 4, fontSize: 12, color: "var(--primary-60)", flexWrap: "wrap" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Users size={12} /> {p.employeeCount} employees</span>
                        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><DollarSign size={12} /> ${p.totalFinal.toFixed(2)}</span>
                        {p.notes && <span>· {p.notes}</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{ color: "var(--primary-60)", flexShrink: 0 }}>
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </div>
                {isExpanded && (
                  <div style={{ borderTop: "1px solid var(--primary-10)" }}>
                    <PayPeriodDetail period={p} onError={setErrorMsg} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
