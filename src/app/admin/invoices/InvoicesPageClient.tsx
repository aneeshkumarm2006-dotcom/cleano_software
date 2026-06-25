"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Search, Plus, FileText, DollarSign, AlertTriangle,
  ChevronLeft, ChevronRight, Send, CheckCircle2, Clock, XCircle,
  Eye, Loader, SlidersHorizontal,
} from "lucide-react";
import PremiumSelect from "@/components/ui/PremiumSelect";
import CreateInvoiceModal from "./CreateInvoiceModal";
import { sendInvoice } from "../actions/sendInvoice";
import { updateInvoice } from "../actions/updateInvoice";

interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  sortOrder: number;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  status: string;
  clientId: string;
  clientName: string;
  clientEmail: string | null;
  clientPhone: string | null;
  clientAddress: string | null;
  jobId: string | null;
  jobClientName: string | null;
  jobType: string | null;
  jobDate: string | null;
  subtotal: number;
  gstAmount: number;
  qstAmount: number;
  discountAmount: number;
  totalAmount: number;
  notes: string | null;
  dueDate: string | null;
  sentAt: string | null;
  paidAt: string | null;
  createdAt: string;
  lineItems: LineItem[];
}

interface ClientOption {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  discountPercent?: number | null;
}

interface InvoicesPageClientProps {
  invoices: Invoice[];
  clients: ClientOption[];
  taxConfig: { gstRate: number; qstRate: number; gstNumber: string; qstNumber: string };
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  DRAFT:     { label: "Draft",     bg: "#f1f5f9", color: "#475569" },
  SENT:      { label: "Sent",      bg: "#eff6ff", color: "#1d4ed8" },
  PAID:      { label: "Paid",      bg: "#dcfce7", color: "#15803d" },
  OVERDUE:   { label: "Overdue",   bg: "#fffbeb", color: "#d97706" },
  CANCELLED: { label: "Cancelled", bg: "#fee2e2", color: "#b91c1c" },
};

function StatusPill({ status }: { status: string }) {
  const c = STATUS_CONFIG[status] ?? { label: status, bg: "#f1f5f9", color: "#475569" };
  return (
    <span style={{ display: "inline-block", background: c.bg, color: c.color, fontSize: 11, fontWeight: 600, borderRadius: 20, padding: "2px 10px" }}>
      {c.label}
    </span>
  );
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "SENT":      return <Send size={12} style={{ color: "#1d4ed8" }} />;
    case "PAID":      return <CheckCircle2 size={12} style={{ color: "#15803d" }} />;
    case "OVERDUE":   return <Clock size={12} style={{ color: "#d97706" }} />;
    case "CANCELLED": return <XCircle size={12} style={{ color: "#b91c1c" }} />;
    default:          return <FileText size={12} style={{ color: "#94a3b8" }} />;
  }
}

const AVATAR_COLORS = ["#008C9C", "#0284c7", "#7c3aed", "#dc2626", "#d97706", "#059669"];
function avatarColor(name: string) { return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length]; }
function initials(name: string) { return name.split(" ").slice(0, 2).map(p => p[0] ?? "").join("").toUpperCase(); }

export default function InvoicesPageClient({ invoices, clients, taxConfig }: InvoicesPageClientProps) {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const stats = useMemo(() => ({
    total: invoices.length,
    collected: invoices.filter(i => i.status === "PAID").reduce((s, i) => s + i.totalAmount, 0),
    pending: invoices.filter(i => i.status === "SENT" || i.status === "OVERDUE").reduce((s, i) => s + i.totalAmount, 0),
    overdue: invoices.filter(i => i.status === "OVERDUE").length,
  }), [invoices]);

  const filtered = useMemo(() => invoices.filter(inv => {
    if (statusFilter && inv.status !== statusFilter) return false;
    if (clientFilter && inv.clientId !== clientFilter) return false;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      return inv.invoiceNumber.toLowerCase().includes(q) || inv.clientName.toLowerCase().includes(q);
    }
    return true;
  }), [invoices, searchTerm, statusFilter, clientFilter]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / rowsPerPage));
  const startIdx = (page - 1) * rowsPerPage;
  const paginated = filtered.slice(startIdx, startIdx + rowsPerPage);
  const goToPage = (p: number) => setPage(Math.min(Math.max(1, p), totalPages));

  const activeFilterCount = [statusFilter !== "", clientFilter !== ""].filter(Boolean).length;

  const handleSend = async (id: string) => {
    setSendingId(id);
    const r = await sendInvoice(id);
    setSendingId(null);
    if (!r.success) setErrorMsg(r.error || "Failed to send"); else router.refresh();
  };

  const handleMarkPaid = async (id: string) => {
    setMarkingPaidId(id);
    const r = await updateInvoice({ id, status: "PAID" });
    setMarkingPaidId(null);
    if (!r.success) setErrorMsg(r.error || "Failed to mark paid"); else router.refresh();
  };

  return (
    <div className="admin-font stack-24">
      <header className="row-between" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div className="stack-8">
          <p className="eyebrow">Finance</p>
          <h1 className="display">
            Invoices{" "}
            <span style={{ color: "var(--primary-40)", fontWeight: 300 }}>· {stats.total}</span>
          </h1>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setIsModalOpen(true)}>
          <Plus size={16} /> New Invoice
        </button>
      </header>

      <div className="astat-grid">
        <div className="astat">
          <div className="astat-head"><span>Total invoices</span><span className="astat-icon"><FileText size={15} /></span></div>
          <div className="astat-value">{stats.total}</div>
        </div>
        <div className="astat">
          <div className="astat-head"><span>Collected</span><span className="astat-icon"><DollarSign size={15} /></span></div>
          <div className="astat-value">${stats.collected.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
          <div className="astat-delta">paid invoices</div>
        </div>
        <div className="astat">
          <div className="astat-head"><span>Pending</span><span className="astat-icon"><Clock size={15} /></span></div>
          <div className="astat-value">${stats.pending.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
          <div className="astat-delta">sent / overdue</div>
        </div>
        <div className="astat" style={stats.overdue > 0 ? { borderLeft: "3px solid #d97706" } : {}}>
          <div className="astat-head" style={stats.overdue > 0 ? { color: "#92400e" } : {}}>
            <span>Overdue</span>
            <span className="astat-icon" style={stats.overdue > 0 ? { background: "#fffbeb", color: "#d97706" } : {}}>
              <AlertTriangle size={15} />
            </span>
          </div>
          <div className="astat-value" style={stats.overdue > 0 ? { color: "#92400e" } : {}}>{stats.overdue}</div>
          <div className="astat-delta">{stats.overdue > 0 ? "needs attention" : "all clear"}</div>
        </div>
      </div>

      {errorMsg && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "12px 16px", fontSize: 13, color: "#b91c1c", display: "flex", gap: 10, alignItems: "center" }}>
          <AlertTriangle size={14} />
          <span style={{ flex: 1 }}>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg(null)} style={{ fontSize: 12, color: "#b91c1c", cursor: "pointer", textDecoration: "underline", background: "none", border: 0 }}>dismiss</button>
        </div>
      )}

      <div className="atoolbar">
        <div className="atoolbar-search">
          <span className="atoolbar-search-icon"><Search size={14} /></span>
          <input
            className="input"
            value={searchTerm}
            onChange={e => { setSearchTerm(e.target.value); setPage(1); }}
            placeholder="Search by invoice # or client…"
          />
        </div>
        <button type="button" className={`afilter-toggle${showFilters ? " open" : ""}`} onClick={() => setShowFilters(v => !v)}>
          <SlidersHorizontal size={14} />
          Filters
          {activeFilterCount > 0 && <span className="afilter-badge">{activeFilterCount}</span>}
        </button>
        <PremiumSelect
          value={String(rowsPerPage)}
          onChange={v => { setRowsPerPage(Number(v)); setPage(1); }}
          options={[5, 10, 25, 50].map(n => ({ value: String(n), label: `${n} / page` }))}
          size="sm"
          style={{ width: 110 }}
        />
        <span style={{ fontSize: 13, color: "var(--primary-60)" }}>{total} invoice{total !== 1 ? "s" : ""}</span>
      </div>

      {showFilters && (
        <div className="afilter-panel">
          <div className="field">
            <label className="label">Status</label>
            <PremiumSelect
              value={statusFilter}
              onChange={v => { setStatusFilter(v); setPage(1); }}
              options={[
                { value: "", label: "All statuses" },
                { value: "DRAFT", label: "Draft" },
                { value: "SENT", label: "Sent" },
                { value: "PAID", label: "Paid" },
                { value: "OVERDUE", label: "Overdue" },
                { value: "CANCELLED", label: "Cancelled" },
              ]}
              size="sm"
            />
          </div>
          <div className="field">
            <label className="label">Client</label>
            <PremiumSelect
              value={clientFilter}
              onChange={v => { setClientFilter(v); setPage(1); }}
              options={[{ value: "", label: "All clients" }, ...clients.map(c => ({ value: c.id, label: c.name }))]}
              size="sm"
            />
          </div>
          <div className="afilter-panel-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setStatusFilter(""); setClientFilter(""); setPage(1); }}>Clear all</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowFilters(false)}>Done</button>
          </div>
        </div>
      )}

      {total === 0 ? (
        <div className="atable-wrap" style={{ padding: "80px 40px", textAlign: "center", color: "var(--primary-60)" }}>
          No invoices match these filters.
        </div>
      ) : (
        <div className="atable-wrap">
          <div id="inv-desktop">
            <div className="atable-scroll">
              <table className="atable">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Client</th>
                    <th>Date</th>
                    <th>Due</th>
                    <th className="num">Amount</th>
                    <th>Status</th>
                    <th className="col-actions" />
                  </tr>
                </thead>
                <tbody>
                  {paginated.map(inv => (
                    <tr key={inv.id} onClick={() => { window.location.href = `/admin/invoices/${inv.id}`; }}>
                      <td style={{ minWidth: 140 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <StatusIcon status={inv.status} />
                          <span className="col-client">{inv.invoiceNumber}</span>
                        </div>
                        {inv.jobType && <div className="col-client-sub">{inv.jobType}</div>}
                      </td>
                      <td style={{ minWidth: 180 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span className="avatar" style={{ background: avatarColor(inv.clientName), fontSize: 11, width: 28, height: 28, flexShrink: 0 }}>
                            {initials(inv.clientName)}
                          </span>
                          <div className="col-client">{inv.clientName}</div>
                        </div>
                      </td>
                      <td><span style={{ fontSize: 12, color: "var(--primary-70)" }}>{new Date(inv.createdAt).toLocaleDateString("en-US")}</span></td>
                      <td>
                        <span style={{ fontSize: 12, color: inv.status === "OVERDUE" ? "#d97706" : "var(--primary-70)" }}>
                          {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString("en-US") : "—"}
                        </span>
                      </td>
                      <td className="num" style={{ fontWeight: 600, color: "var(--ink)" }}>${inv.totalAmount.toFixed(2)}</td>
                      <td><StatusPill status={inv.status} /></td>
                      <td className="col-actions" onClick={e => e.stopPropagation()}>
                        <div className="row" style={{ gap: 6 }}>
                          <a href={`/admin/invoices/${inv.id}`} className="btn btn-secondary btn-sm" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <Eye size={12} /> View
                          </a>
                          {inv.status === "DRAFT" && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={sendingId === inv.id}
                              onClick={() => handleSend(inv.id)}
                              style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              {sendingId === inv.id ? <Loader size={12} className="animate-spin" /> : <Send size={12} />}
                              Send
                            </button>
                          )}
                          {(inv.status === "SENT" || inv.status === "OVERDUE") && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={markingPaidId === inv.id}
                              onClick={() => handleMarkPaid(inv.id)}
                              style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              {markingPaidId === inv.id ? <Loader size={12} className="animate-spin" /> : <DollarSign size={12} />}
                              Paid
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div id="inv-mobile" style={{ display: "none", flexDirection: "column", gap: 10, padding: 16 }}>
            {paginated.map(inv => (
              <article key={inv.id} className="jcard" style={{ cursor: "pointer" }} onClick={() => { window.location.href = `/admin/invoices/${inv.id}`; }}>
                <div className="jcard-top">
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                      <StatusIcon status={inv.status} />
                      <div className="jcard-client">{inv.invoiceNumber}</div>
                    </div>
                    <div className="jcard-meta">{inv.clientName}</div>
                    {inv.dueDate && <div className="jcard-meta">Due {new Date(inv.dueDate).toLocaleDateString("en-US")}</div>}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="jcard-price">${inv.totalAmount.toFixed(2)}</div>
                    <div style={{ marginTop: 4 }}><StatusPill status={inv.status} /></div>
                  </div>
                </div>
                <div className="jcard-row" style={{ paddingTop: 10, borderTop: "1px solid var(--primary-10)", marginTop: 10, gap: 8 }} onClick={e => e.stopPropagation()}>
                  <a href={`/admin/invoices/${inv.id}`} className="btn btn-secondary btn-sm" style={{ flex: 1, justifyContent: "center" }}>View</a>
                  {inv.status === "DRAFT" && (
                    <button type="button" className="btn btn-ghost btn-sm" disabled={sendingId === inv.id} onClick={() => handleSend(inv.id)} style={{ flex: 1 }}>
                      {sendingId === inv.id ? "Sending…" : "Send"}
                    </button>
                  )}
                  {(inv.status === "SENT" || inv.status === "OVERDUE") && (
                    <button type="button" className="btn btn-ghost btn-sm" disabled={markingPaidId === inv.id} onClick={() => handleMarkPaid(inv.id)} style={{ flex: 1 }}>
                      {markingPaidId === inv.id ? "Processing…" : "Mark Paid"}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>

          <div className="apager">
            <span>Showing {startIdx + 1}–{Math.min(startIdx + rowsPerPage, total)} of {total}</span>
            <div className="apager-controls">
              <button type="button" className="apager-btn" disabled={page === 1} onClick={() => goToPage(1)}>«</button>
              <button type="button" className="apager-btn" disabled={page === 1} onClick={() => goToPage(page - 1)}><ChevronLeft size={14} /></button>
              <span className="apager-btn active">{page}</span>
              <span style={{ fontSize: 12, color: "var(--primary-50)", alignSelf: "center" }}>/ {totalPages}</span>
              <button type="button" className="apager-btn" disabled={page >= totalPages} onClick={() => goToPage(page + 1)}><ChevronRight size={14} /></button>
              <button type="button" className="apager-btn" disabled={page >= totalPages} onClick={() => goToPage(totalPages)}>»</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media (max-width: 900px) {
          #inv-desktop { display: none !important; }
          #inv-mobile  { display: flex !important; }
        }
      `}</style>

      <CreateInvoiceModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        clients={clients}
        taxConfig={taxConfig}
      />
    </div>
  );
}
