"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Gift, DollarSign, X, Archive, CheckCircle, Ban, Trash2, RotateCcw } from "lucide-react";
import { useRowSelection } from "@/components/common/useRowSelection";
import BulkActionBar, { type BulkAction } from "@/components/common/BulkActionBar";
import { bulkSoftDelete, bulkRestore } from "@/lib/bulk/actions";
import { bulkSetGiftCardStatus } from "../actions/bulkSetGiftCardStatus";
import { avatarColor, initials } from "@/lib/avatar";

type Status = "PENDING_PAYMENT" | "ACTIVE" | "REDEEMED" | "REFUNDED" | "CANCELLED";

interface GiftCard {
  id: string;
  code: string;
  amount: number;
  status: Status;
  purchaserName: string;
  purchaserEmail: string;
  recipientName: string;
  recipientEmail: string;
  personalMessage: string | null;
  coverKey: string;
  scheduledDeliveryDate: string | null;
  deliveredAt: string | null;
  redeemedAt: string | null;
  createdAt: string;
}

const STATUS_TINT: Record<Status, { bg: string; fg: string }> = {
  PENDING_PAYMENT: { bg: "#f1f5f9", fg: "#475569" },
  ACTIVE:          { bg: "#dcfce7", fg: "#166534" },
  REDEEMED:        { bg: "#dbeafe", fg: "#1e40af" },
  REFUNDED:        { bg: "#fef3c7", fg: "#854d0e" },
  CANCELLED:       { bg: "#fee2e2", fg: "#991b1b" },
};

const FILTERS: Array<{ value: Status | "ALL"; label: string }> = [
  { value: "ALL",             label: "All" },
  { value: "ACTIVE",          label: "Active" },
  { value: "REDEEMED",        label: "Redeemed" },
  { value: "PENDING_PAYMENT", label: "Pending" },
  { value: "REFUNDED",        label: "Refunded" },
  { value: "CANCELLED",       label: "Cancelled" },
];

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function fmtDay(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function GiftCardsAdminClient({ cards, archived = false }: { cards: GiftCard[]; archived?: boolean }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Status | "ALL">("ALL");
  const [open, setOpen] = useState<GiftCard | null>(null);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cards.filter(c => {
      if (filter !== "ALL" && c.status !== filter) return false;
      if (!q) return true;
      return (
        c.code.toLowerCase().includes(q) ||
        c.purchaserName.toLowerCase().includes(q) ||
        c.purchaserEmail.toLowerCase().includes(q) ||
        c.recipientName.toLowerCase().includes(q) ||
        c.recipientEmail.toLowerCase().includes(q)
      );
    });
  }, [cards, filter, search]);

  const visibleIds = useMemo(() => filtered.map((c) => c.id), [filtered]);
  const sel = useRowSelection(visibleIds);

  const afterBulk = () => { sel.clear(); router.refresh(); };

  const bulkActions: BulkAction[] = archived
    ? [
        {
          key: "restore",
          label: "Restore",
          icon: <RotateCcw size={14} />,
          onRun: async () => { await bulkRestore("giftCard", sel.selectedIds); afterBulk(); },
        },
      ]
    : [
        {
          key: "activate",
          label: "Activate",
          icon: <CheckCircle size={14} />,
          onRun: async () => { await bulkSetGiftCardStatus(sel.selectedIds, "ACTIVE"); afterBulk(); },
        },
        {
          key: "deactivate",
          label: "Deactivate",
          icon: <Ban size={14} />,
          onRun: async () => { await bulkSetGiftCardStatus(sel.selectedIds, "CANCELLED"); afterBulk(); },
        },
        {
          key: "delete",
          label: "Delete",
          icon: <Trash2 size={14} />,
          variant: "danger",
          confirm: `Delete ${sel.count} gift card${sel.count === 1 ? "" : "s"}? Recoverable from Archived.`,
          onRun: async () => { await bulkSoftDelete("giftCard", sel.selectedIds); afterBulk(); },
        },
      ];

  const stats = useMemo(() => {
    const active = cards.filter(c => c.status === "ACTIVE");
    const redeemed = cards.filter(c => c.status === "REDEEMED");
    return {
      activeCount: active.length,
      activeValue: active.reduce((s, c) => s + c.amount, 0),
      redeemedCount: redeemed.length,
      redeemedValue: redeemed.reduce((s, c) => s + c.amount, 0),
    };
  }, [cards]);

  return (
    <div className="admin-font stack-24">
      <header className="row-between" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div className="stack-8">
          <p className="eyebrow">Sales & Marketing</p>
          <h1 className="display">
            {archived ? "Archived gift cards" : "Gift Cards"}{" "}
            <span style={{ color: "var(--primary-40)", fontWeight: 300 }}>· {cards.length}</span>
          </h1>
          <p style={{ fontSize: 14, color: "var(--primary-60)" }}>Every gift card purchased through the public landing page.</p>
        </div>
        <a
          href={archived ? "/admin/gift-cards" : "/admin/gift-cards?archived=1"}
          className={`btn ${archived ? "btn-primary" : "btn-secondary"}`}>
          <Archive size={16} /> {archived ? "Active gift cards" : "Archived"}
        </a>
      </header>

      <div className="astat-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
        <div className="astat">
          <div className="astat-head"><span>Outstanding</span><span className="astat-icon"><Gift size={15} /></span></div>
          <div className="astat-value">${stats.activeValue.toFixed(2)}</div>
          <div className="astat-delta">{stats.activeCount} active cards</div>
        </div>
        <div className="astat">
          <div className="astat-head"><span>Redeemed total</span><span className="astat-icon"><DollarSign size={15} /></span></div>
          <div className="astat-value">${stats.redeemedValue.toFixed(2)}</div>
          <div className="astat-delta">{stats.redeemedCount} redeemed</div>
        </div>
      </div>

      <div className="atoolbar">
        <div className="atoolbar-search">
          <span className="atoolbar-search-icon"><Search size={14} /></span>
          <input
            className="input"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by code, buyer, or recipient…"
          />
        </div>
      </div>

      <div className="atabs">
        {FILTERS.map(f => (
          <button key={f.value} type="button" className={`atab${filter === f.value ? " active" : ""}`} onClick={() => setFilter(f.value)}>
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="atable-wrap" style={{ padding: "80px 40px", textAlign: "center", color: "var(--primary-60)" }}>
          No gift cards match.
        </div>
      ) : (
        <div className="atable-wrap">
          <div id="gc-desktop">
            <div className="atable-scroll">
              <table className="atable">
                <thead>
                  <tr>
                    <th className="col-select" style={{ width: 40, textAlign: "center" }}>
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={sel.allSelected}
                        ref={el => { if (el) el.indeterminate = sel.someSelected; }}
                        onChange={sel.toggleAll}
                        style={{ cursor: "pointer" }}
                      />
                    </th>
                    <th>Code</th>
                    <th>From</th>
                    <th>To</th>
                    <th className="num">Amount</th>
                    <th>Status</th>
                    <th>Delivery</th>
                    <th>Purchased</th>
                    <th className="col-actions" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(c => (
                    <tr key={c.id} className={sel.isSelected(c.id) ? "row-selected" : undefined}>
                      <td className="col-select" style={{ textAlign: "center" }} onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label="Select row"
                          checked={sel.isSelected(c.id)}
                          onChange={() => sel.toggle(c.id)}
                          style={{ cursor: "pointer" }}
                        />
                      </td>
                      <td style={{ minWidth: 120 }}>
                        <span className="col-client" style={{ fontFamily: "monospace", letterSpacing: "0.06em" }}>{c.code}</span>
                      </td>
                      <td style={{ minWidth: 160 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span className="avatar" style={{ background: avatarColor(c.purchaserName), fontSize: 10, width: 28, height: 28, flexShrink: 0 }}>
                            {initials(c.purchaserName)}
                          </span>
                          <div>
                            <div className="col-client">{c.purchaserName}</div>
                            <div className="col-client-sub">{c.purchaserEmail}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ minWidth: 160 }}>
                        <div className="col-client">{c.recipientName}</div>
                        <div className="col-client-sub">{c.recipientEmail}</div>
                      </td>
                      <td className="num" style={{ fontWeight: 700, color: "var(--ink)" }}>${c.amount.toFixed(2)}</td>
                      <td>
                        <span style={{ display: "inline-block", background: STATUS_TINT[c.status].bg, color: STATUS_TINT[c.status].fg, fontSize: 11, fontWeight: 600, borderRadius: 20, padding: "2px 10px" }}>
                          {c.status.replace("_", " ")}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: 12, color: "var(--primary-70)" }}>
                          {c.deliveredAt ? `Sent ${fmtDay(c.deliveredAt)}` : c.scheduledDeliveryDate ? `Sched. ${fmtDay(c.scheduledDeliveryDate)}` : "—"}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: 12, color: "var(--primary-70)" }}>{fmtDay(c.createdAt)}</span>
                      </td>
                      <td className="col-actions">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(c)}>Details</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div id="gc-mobile" style={{ display: "none", flexDirection: "column", gap: 10, padding: 16 }}>
            {filtered.map(c => (
              <article key={c.id} className={`jcard${sel.isSelected(c.id) ? " row-selected" : ""}`}>
                <div className="jcard-top">
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <input
                      type="checkbox"
                      aria-label="Select row"
                      checked={sel.isSelected(c.id)}
                      onChange={() => sel.toggle(c.id)}
                      onClick={e => e.stopPropagation()}
                      style={{ cursor: "pointer", marginTop: 3 }}
                    />
                    <div>
                      <div className="jcard-client" style={{ fontFamily: "monospace", letterSpacing: "0.06em" }}>{c.code}</div>
                      <div className="jcard-meta">{c.purchaserName} → {c.recipientName}</div>
                      <div className="jcard-meta">{fmtDay(c.createdAt)}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="jcard-price">${c.amount.toFixed(2)}</div>
                    <div style={{ marginTop: 4 }}>
                      <span style={{ display: "inline-block", background: STATUS_TINT[c.status].bg, color: STATUS_TINT[c.status].fg, fontSize: 11, fontWeight: 600, borderRadius: 20, padding: "2px 10px" }}>
                        {c.status.replace("_", " ")}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="jcard-row" style={{ paddingTop: 10, borderTop: "1px solid var(--primary-10)", marginTop: 10 }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(c)}>Details</button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {open && (
        <div onClick={() => setOpen(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,60,70,0.55)", backdropFilter: "blur(2px)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, maxWidth: 480, width: "100%", padding: 28, boxShadow: "0 20px 60px rgba(0,60,70,0.25)", maxHeight: "85vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, fontFamily: "monospace", color: "var(--primary)" }}>{open.code}</h2>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--primary-70)" }}>
                  ${open.amount.toFixed(2)} · {open.status.replace("_", " ")}
                </p>
              </div>
              <button type="button" onClick={() => setOpen(null)} style={{ background: "none", border: 0, cursor: "pointer", color: "var(--primary-50)", padding: 4 }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              {[
                { label: "From", value: `${open.purchaserName} (${open.purchaserEmail})` },
                { label: "To", value: `${open.recipientName} (${open.recipientEmail})` },
                { label: "Personal message", value: open.personalMessage ?? "—" },
                { label: "Purchased", value: fmtDate(open.createdAt) },
                { label: "Scheduled delivery", value: fmtDay(open.scheduledDeliveryDate) },
                { label: "Delivered", value: fmtDate(open.deliveredAt) },
                { label: "Redeemed", value: fmtDate(open.redeemedAt) },
              ].map(f => (
                <div key={f.label}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--primary-50)", marginBottom: 2 }}>{f.label}</div>
                  <div style={{ fontSize: 14, color: "var(--ink)", whiteSpace: "pre-wrap" }}>{f.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <BulkActionBar
        count={sel.count}
        actions={bulkActions}
        onClear={sel.clear}
        noun="gift card"
        total={visibleIds.length}
        allSelected={sel.allSelected}
        onToggleAll={sel.toggleAll}
      />

      <style>{`
        @media (max-width: 900px) {
          #gc-desktop { display: none !important; }
          #gc-mobile  { display: flex !important; }
        }
        .atable tbody tr.row-selected td { background: var(--primary-05, #f0fdff); }
        .jcard.row-selected { outline: 2px solid var(--primary-40, #008C9C); outline-offset: -1px; }
      `}</style>
    </div>
  );
}
