"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search, Plus, Users, DollarSign, AlertTriangle,
  Briefcase, Pencil, SlidersHorizontal,
  ChevronLeft, ChevronRight, Trash2, UserX, UserCheck, RotateCcw, Archive, Mail,
} from "lucide-react";
import PremiumSelect from "@/components/ui/PremiumSelect";
import ClientModal from "./ClientModal";
import ImportCsvButton from "@/components/csv/ImportCsvButton";
import BookingKoalaImportButton from "@/components/csv/BookingKoalaImportButton";
import { ConfirmDeleteModal } from "@/components/common/ConfirmDeleteModal";
import { deleteClient } from "../actions/deleteClient";
import { useRowSelection } from "@/components/common/useRowSelection";
import BulkActionBar, { type BulkAction } from "@/components/common/BulkActionBar";
import { bulkSoftDelete, bulkRestore } from "@/lib/bulk/actions";
import { bulkSetClientActive } from "../actions/bulkSetClientActive";
import { sendLoginInvites } from "../actions/sendLoginInvites";

interface Client {
  id: string;
  name: string;
  email: string | null;
  secondaryEmail: string | null;
  phone: string | null;
  secondaryPhone: string | null;
  company: string | null;
  address: string | null;
  aptNumber: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  notes: string | null;
  discountPercent: number;
  fixedPrice?: number | null;
  fixedPriceRecurring?: boolean;
  fixedPriceAllowFrequencyDiscount?: boolean;
  isActive: boolean;
  totalJobs: number;
  completedJobs: number;
  totalRevenue: number;
  unpaidJobs: number;
  lastJobDate: string | null;
}

interface ClientsPageClientProps {
  initialClients: Client[];
  initialStats: {
    totalClients: number;
    totalRevenue: number;
    activeClients: number;
    unpaidJobs: number;
  };
  initialSearch: string;
  initialPage: number;
  initialRowsPerPage: number;
  archived: boolean;
}

const AVATAR_COLORS = ["#008C9C", "#0284c7", "#7c3aed", "#dc2626", "#d97706", "#059669", "#0891b2", "#be185d"];

function avatarColor(name: string) {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
}

function initials(name: string) {
  return name.split(" ").slice(0, 2).map(p => p[0] ?? "").join("").toUpperCase();
}

function AStatCard({ icon: Icon, label, value, hint, warn }: {
  icon: React.ElementType; label: string; value: string; hint?: string; warn?: boolean;
}) {
  return (
    <div className="astat" style={warn ? { borderLeft: "3px solid #d97706" } : {}}>
      <div className="astat-head" style={warn ? { color: "#92400e" } : {}}>
        <span>{label}</span>
        <span className="astat-icon" style={warn ? { background: "#fffbeb", color: "#d97706" } : {}}>
          <Icon size={15} />
        </span>
      </div>
      <div className="astat-value" style={warn ? { color: "#92400e" } : {}}>{value}</div>
      {hint && <div className="astat-delta">{hint}</div>}
    </div>
  );
}

export default function ClientsPageClient({
  initialClients,
  initialStats,
  initialSearch,
  initialPage,
  initialRowsPerPage,
  archived,
}: ClientsPageClientProps) {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState(initialSearch);
  const [page, setPage] = useState(initialPage);
  const [rowsPerPage, setRowsPerPage] = useState(initialRowsPerPage);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [activityFilter, setActivityFilter] = useState<"all" | "active" | "inactive">("all");
  const [unpaidFilter, setUnpaidFilter] = useState<"all" | "has" | "none">("all");
  const [discountFilter, setDiscountFilter] = useState<"all" | "has" | "none">("all");
  const [sortBy, setSortBy] = useState<"name" | "revenue" | "jobs" | "recent">("name");

  const activeFilterCount = [
    activityFilter !== "all",
    unpaidFilter !== "all",
    discountFilter !== "all",
    sortBy !== "name",
  ].filter(Boolean).length;

  const clearFilters = () => {
    setActivityFilter("all"); setUnpaidFilter("all");
    setDiscountFilter("all"); setSortBy("name"); setPage(1);
  };

  const filtered = useMemo(() => {
    return initialClients
      .filter(c => {
        if (searchTerm) {
          const q = searchTerm.toLowerCase();
          if (
            !c.name.toLowerCase().includes(q) &&
            !(c.email?.toLowerCase().includes(q)) &&
            !(c.phone?.toLowerCase().includes(q)) &&
            !(c.address?.toLowerCase().includes(q))
          ) return false;
        }
        if (activityFilter === "active" && c.totalJobs === 0) return false;
        if (activityFilter === "inactive" && c.totalJobs > 0) return false;
        if (unpaidFilter === "has" && c.unpaidJobs === 0) return false;
        if (unpaidFilter === "none" && c.unpaidJobs > 0) return false;
        if (discountFilter === "has" && c.discountPercent <= 0) return false;
        if (discountFilter === "none" && c.discountPercent > 0) return false;
        return true;
      })
      .sort((a, b) => {
        switch (sortBy) {
          case "revenue": return b.totalRevenue - a.totalRevenue;
          case "jobs":    return b.totalJobs - a.totalJobs;
          case "recent": {
            const at = a.lastJobDate ? new Date(a.lastJobDate).getTime() : 0;
            const bt = b.lastJobDate ? new Date(b.lastJobDate).getTime() : 0;
            return bt - at;
          }
          default: return a.name.localeCompare(b.name);
        }
      });
  }, [initialClients, searchTerm, activityFilter, unpaidFilter, discountFilter, sortBy]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / rowsPerPage));
  const startIdx = (page - 1) * rowsPerPage;
  const paginated = filtered.slice(startIdx, startIdx + rowsPerPage);

  const goToPage = (p: number) => setPage(Math.min(Math.max(1, p), totalPages));

  const visibleIds = useMemo(() => paginated.map((c) => c.id), [paginated]);
  const selection = useRowSelection(visibleIds);

  const afterBulk = () => { selection.clear(); router.refresh(); };

  const bulkActions: BulkAction[] = archived
    ? [
        {
          key: "restore",
          label: "Restore",
          icon: <RotateCcw size={14} />,
          onRun: async () => { await bulkRestore("client", selection.selectedIds); afterBulk(); },
        },
      ]
    : [
        {
          key: "invite",
          label: "Send invite",
          icon: <Mail size={14} />,
          onRun: async () => {
            const res = await sendLoginInvites("customer", selection.selectedIds);
            if (res.success) {
              alert(
                `Invites sent to ${res.sent}.` +
                  (res.skippedActive ? ` Skipped ${res.skippedActive} already logged in.` : "") +
                  (res.skippedNoEmail ? ` ${res.skippedNoEmail} had no email.` : "")
              );
            } else {
              alert(res.error ?? "Failed to send invites");
            }
            afterBulk();
          },
        },
        {
          key: "deactivate",
          label: "Deactivate",
          icon: <UserX size={14} />,
          onRun: async () => { await bulkSetClientActive(selection.selectedIds, false); afterBulk(); },
        },
        {
          key: "activate",
          label: "Activate",
          icon: <UserCheck size={14} />,
          onRun: async () => { await bulkSetClientActive(selection.selectedIds, true); afterBulk(); },
        },
        {
          key: "delete",
          label: "Delete",
          icon: <Trash2 size={14} />,
          variant: "danger",
          confirm: `Delete ${selection.count} client${selection.count === 1 ? "" : "s"}? Recoverable from Archived.`,
          onRun: async () => { await bulkSoftDelete("client", selection.selectedIds); afterBulk(); },
        },
      ];

  const handleCreate = () => { setSelectedClient(null); setModalMode("create"); setIsModalOpen(true); };
  const handleEdit = (c: Client) => { setSelectedClient(c); setModalMode("edit"); setIsModalOpen(true); };

  const [clientToDelete, setClientToDelete] = useState<Client | null>(null);

  const handleDelete = (c: Client) => {
    if (c.totalJobs > 0) {
      setErrorMsg(`Cannot delete "${c.name}" — ${c.totalJobs} job${c.totalJobs === 1 ? "" : "s"} linked.`);
      return;
    }
    setClientToDelete(c);
  };

  const confirmDeleteClient = async () => {
    if (!clientToDelete) return;
    setDeletingId(clientToDelete.id);
    const result = await deleteClient(clientToDelete.id);
    setDeletingId(null);
    setClientToDelete(null);
    if (result.error) setErrorMsg(result.error);
    else router.refresh();
  };

  return (
    <div className="admin-font stack-24">
      <header className="row-between" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div className="stack-8">
          <p className="eyebrow">Records</p>
          <h1 className="display">
            Clients{" "}
            <span style={{ color: "var(--primary-40)", fontWeight: 300 }}>· {initialStats.totalClients}</span>
          </h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a
            href={archived ? "/admin/clients" : "/admin/clients?archived=1"}
            className={`btn ${archived ? "btn-primary" : "btn-secondary"}`}>
            <Archive size={16} /> {archived ? "Active clients" : "Archived"}
          </a>
          {!archived && (
            <>
              <BookingKoalaImportButton />
              <ImportCsvButton entity="clients" />
              <button type="button" className="btn btn-primary" onClick={handleCreate}>
                <Plus size={16} /> New Client
              </button>
            </>
          )}
        </div>
      </header>

      <div className="astat-grid">
        <AStatCard icon={Users}       label="Total clients" value={String(initialStats.totalClients)} hint="all time" />
        <AStatCard icon={Briefcase}   label="Active clients" value={String(initialStats.activeClients)} hint="with jobs" />
        <AStatCard icon={DollarSign}  label="Total revenue"  value={`$${initialStats.totalRevenue.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`} />
        <AStatCard
          icon={AlertTriangle} label="Unpaid jobs"
          value={String(initialStats.unpaidJobs)}
          warn={initialStats.unpaidJobs > 0}
          hint={initialStats.unpaidJobs > 0 ? "needs attention" : "all clear"}
        />
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
            placeholder="Search clients by name, email, phone, or address…"
          />
        </div>
        <button
          type="button"
          className={`afilter-toggle${showFilters ? " open" : ""}`}
          onClick={() => setShowFilters(v => !v)}>
          <SlidersHorizontal size={14} />
          Filters
          {activeFilterCount > 0 && (
            <span className="afilter-badge">{activeFilterCount}</span>
          )}
        </button>
        <PremiumSelect
          value={String(rowsPerPage)}
          onChange={v => { setRowsPerPage(Number(v)); setPage(1); }}
          options={[5, 10, 25, 50, 100].map(n => ({ value: String(n), label: `${n} / page` }))}
          size="sm"
          style={{ width: 110 }}
        />
        <span style={{ fontSize: 13, color: "var(--primary-60)" }}>
          {total} client{total !== 1 ? "s" : ""}
        </span>
      </div>

      {showFilters && (
        <div className="afilter-panel">
          <div className="field">
            <label className="label">Activity</label>
            <PremiumSelect
              value={activityFilter}
              onChange={v => { setActivityFilter(v as typeof activityFilter); setPage(1); }}
              options={[{ value: "all", label: "All clients" }, { value: "active", label: "Has jobs" }, { value: "inactive", label: "No jobs" }]}
              size="sm"
            />
          </div>
          <div className="field">
            <label className="label">Unpaid</label>
            <PremiumSelect
              value={unpaidFilter}
              onChange={v => { setUnpaidFilter(v as typeof unpaidFilter); setPage(1); }}
              options={[{ value: "all", label: "All" }, { value: "has", label: "Has unpaid" }, { value: "none", label: "No unpaid" }]}
              size="sm"
            />
          </div>
          <div className="field">
            <label className="label">Discount</label>
            <PremiumSelect
              value={discountFilter}
              onChange={v => { setDiscountFilter(v as typeof discountFilter); setPage(1); }}
              options={[{ value: "all", label: "All" }, { value: "has", label: "Has discount" }, { value: "none", label: "No discount" }]}
              size="sm"
            />
          </div>
          <div className="field">
            <label className="label">Sort by</label>
            <PremiumSelect
              value={sortBy}
              onChange={v => setSortBy(v as typeof sortBy)}
              options={[
                { value: "name", label: "Name (A–Z)" },
                { value: "revenue", label: "Revenue (High–Low)" },
                { value: "jobs", label: "Most jobs" },
                { value: "recent", label: "Recent activity" },
              ]}
              size="sm"
            />
          </div>
          <div className="afilter-panel-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>Clear all</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowFilters(false)}>Done</button>
          </div>
        </div>
      )}

      {total === 0 ? (
        <div className="atable-wrap" style={{ padding: "80px 40px", textAlign: "center", color: "var(--primary-60)" }}>
          No clients match these filters.
        </div>
      ) : (
        <div className="atable-wrap">
          <div id="cl-desktop">
            <div className="atable-scroll">
              <table className="atable">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>
                      <input
                        type="checkbox"
                        aria-label="Select all clients"
                        checked={selection.allSelected}
                        ref={(el) => { if (el) el.indeterminate = selection.someSelected; }}
                        onChange={selection.toggleAll}
                        style={{ cursor: "pointer", width: 16, height: 16 }}
                      />
                    </th>
                    <th>Client</th>
                    <th>Contact</th>
                    <th className="num">Jobs</th>
                    <th className="num">Revenue</th>
                    <th className="num">Unpaid</th>
                    <th>Last job</th>
                    <th className="col-actions" />
                  </tr>
                </thead>
                <tbody>
                  {paginated.map(c => (
                    <tr
                      key={c.id}
                      className={selection.isSelected(c.id) ? "row-selected" : undefined}
                      onClick={() => { window.location.href = `/admin/clients/${c.id}`; }}>
                      <td onClick={(e) => e.stopPropagation()} style={{ width: 40 }}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${c.name}`}
                          checked={selection.isSelected(c.id)}
                          onChange={() => selection.toggle(c.id)}
                          style={{ cursor: "pointer", width: 16, height: 16 }}
                        />
                      </td>
                      <td style={{ minWidth: 200 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span
                            className="avatar"
                            style={{ background: avatarColor(c.name), fontSize: 12, width: 36, height: 36 }}>
                            {initials(c.name)}
                          </span>
                          <div>
                            <div className="col-client">{c.name}</div>
                            {c.address && <div className="col-client-sub" style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>{c.address}</div>}
                          </div>
                        </div>
                      </td>
                      <td style={{ minWidth: 180 }}>
                        {c.email && <div className="col-client-sub">{c.email}</div>}
                        {c.phone && <div className="col-client-sub">{c.phone}</div>}
                        {!c.email && !c.phone && <span style={{ color: "var(--primary-40)" }}>—</span>}
                      </td>
                      <td className="num">
                        <span style={{ fontWeight: 600, color: "var(--ink)" }}>{c.totalJobs}</span>
                        {c.completedJobs > 0 && (
                          <div style={{ fontSize: 11, color: "var(--primary-60)" }}>{c.completedJobs} done</div>
                        )}
                      </td>
                      <td className="num" style={{ fontWeight: 600, color: "var(--ink)" }}>
                        ${c.totalRevenue.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </td>
                      <td className="num">
                        {c.unpaidJobs > 0 ? (
                          <span style={{ fontWeight: 600, color: "#d97706" }}>{c.unpaidJobs}</span>
                        ) : <span style={{ color: "var(--primary-40)" }}>—</span>}
                      </td>
                      <td>
                        <span style={{ fontSize: 12, color: "var(--primary-70)" }}>
                          {c.lastJobDate ? new Date(c.lastJobDate).toLocaleDateString("en-US") : "—"}
                        </span>
                      </td>
                      <td className="col-actions" onClick={e => e.stopPropagation()}>
                        <div className="row">
                          <button
                            type="button"
                            className="icon-btn"
                            title="Edit"
                            onClick={() => handleEdit(c)}>
                            <Pencil size={14} />
                          </button>
                          <a href={`/admin/clients/${c.id}`} className="btn btn-secondary btn-sm">View</a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div id="cl-mobile" style={{ display: "none", flexDirection: "column", gap: 10, padding: 16 }}>
            {paginated.map(c => (
              <article key={c.id} className={`jcard${selection.isSelected(c.id) ? " row-selected" : ""}`} style={{ cursor: "pointer" }} onClick={() => { window.location.href = `/admin/clients/${c.id}`; }}>
                <div className="jcard-top">
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${c.name}`}
                      checked={selection.isSelected(c.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => selection.toggle(c.id)}
                      style={{ cursor: "pointer", width: 16, height: 16 }}
                    />
                    <span className="avatar" style={{ background: avatarColor(c.name), fontSize: 12, width: 36, height: 36 }}>
                      {initials(c.name)}
                    </span>
                    <div>
                      <div className="jcard-client">{c.name}</div>
                      {c.email && <div className="jcard-meta">{c.email}</div>}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="jcard-price">${c.totalRevenue.toFixed(0)}</div>
                    <div className="jcard-meta">{c.totalJobs} job{c.totalJobs !== 1 ? "s" : ""}</div>
                  </div>
                </div>
                {c.unpaidJobs > 0 && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "#d97706", fontWeight: 600 }}>
                    {c.unpaidJobs} unpaid job{c.unpaidJobs !== 1 ? "s" : ""}
                  </div>
                )}
              </article>
            ))}
          </div>

          <div className="apager">
            <span>Showing {startIdx + 1}–{Math.min(startIdx + rowsPerPage, total)} of {total}</span>
            <div className="apager-controls">
              <button type="button" className="apager-btn" disabled={page === 1} onClick={() => goToPage(1)}>«</button>
              <button type="button" className="apager-btn" disabled={page === 1} onClick={() => goToPage(page - 1)}>
                <ChevronLeft size={14} />
              </button>
              <span className="apager-btn active">{page}</span>
              <span style={{ fontSize: 12, color: "var(--primary-50)", alignSelf: "center" }}>/ {totalPages}</span>
              <button type="button" className="apager-btn" disabled={page >= totalPages} onClick={() => goToPage(page + 1)}>
                <ChevronRight size={14} />
              </button>
              <button type="button" className="apager-btn" disabled={page >= totalPages} onClick={() => goToPage(totalPages)}>»</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media (max-width: 900px) {
          #cl-desktop { display: none !important; }
          #cl-mobile  { display: flex !important; }
        }
        .atable tbody tr.row-selected { background: var(--primary-05, #f0fdff); }
        .jcard.row-selected { outline: 2px solid var(--primary-40, #008C9C); outline-offset: -1px; }
      `}</style>

      <ClientModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        mode={modalMode}
        client={selectedClient}
      />

      <ConfirmDeleteModal
        isOpen={!!clientToDelete}
        onClose={() => setClientToDelete(null)}
        onConfirm={confirmDeleteClient}
        fileName={clientToDelete?.name ?? "this client"}
        title="Delete client?"
        message="This action cannot be undone."
      />

      <BulkActionBar
        noun="client"
        count={selection.count}
        actions={bulkActions}
        onClear={selection.clear}
      />
    </div>
  );
}
