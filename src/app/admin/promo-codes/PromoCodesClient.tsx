"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ToggleLeft, ToggleRight, Loader2, Power, RotateCcw, Archive, ArchiveRestore } from "lucide-react";
import DatePicker from "@/components/customer/DatePicker";
import PremiumSelect from "@/components/ui/PremiumSelect";
import { ConfirmDeleteModal } from "@/components/common/ConfirmDeleteModal";
import { useRowSelection } from "@/components/common/useRowSelection";
import BulkActionBar, { type BulkAction } from "@/components/common/BulkActionBar";
import { bulkSoftDelete, bulkRestore } from "@/lib/bulk/actions";
import { createPromoCode, togglePromoCode, deletePromoCode, bulkSetPromoActive } from "./actions";

interface PromoCode {
  id: string;
  code: string;
  description: string | null;
  discountType: string;
  discountValue: number;
  maxUses: number | null;
  usesCount: number;
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
}

export default function PromoCodesClient({ codes, archived = false }: { codes: PromoCode[]; archived?: boolean }) {
  const router = useRouter();
  const [list, setList] = useState(codes);
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [discountType, setDiscountType] = useState<"FIXED" | "PERCENT">("FIXED");
  const [discountValue, setDiscountValue] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setCreating(true);
    const res = await createPromoCode({ code, description, discountType, discountValue: parseFloat(discountValue), maxUses: maxUses ? parseInt(maxUses) : null, expiresAt: expiresAt || null });
    setCreating(false);
    if (!res.success) { setFormError(res.error ?? "Failed"); return; }
    setCode(""); setDescription(""); setDiscountValue(""); setMaxUses(""); setExpiresAt("");
    setShowForm(false);
    window.location.reload();
  }

  async function handleToggle(id: string) {
    setBusyId(id);
    await togglePromoCode(id);
    setList(l => l.map(c => c.id === id ? { ...c, isActive: !c.isActive } : c));
    setBusyId(null);
  }

  async function runDelete() {
    if (!deleteId) return;
    const id = deleteId;
    setDeleteId(null);
    setBusyId(id);
    await deletePromoCode(id);
    setList(l => l.filter(c => c.id !== id));
    setBusyId(null);
  }

  const visibleIds = useMemo(() => list.map((c) => c.id), [list]);
  const selection = useRowSelection(visibleIds);
  const { selectedIds, clear } = selection;

  // Run a bulk mutation, then clear the selection and refresh server data.
  const runBulk = async (fn: () => Promise<{ success: boolean; error?: string }>) => {
    const res = await fn();
    if (!res.success) throw new Error(res.error || "Bulk action failed");
    clear();
    router.refresh();
  };

  const bulkActions: BulkAction[] = archived
    ? [
        {
          key: "restore",
          label: "Restore",
          icon: <RotateCcw size={14} />,
          onRun: () => runBulk(() => bulkRestore("promoCode", selectedIds)),
        },
      ]
    : [
        {
          key: "activate",
          label: "Activate",
          icon: <Power size={14} />,
          onRun: () => runBulk(() => bulkSetPromoActive(selectedIds, true)),
        },
        {
          key: "deactivate",
          label: "Deactivate",
          icon: <Power size={14} />,
          onRun: () => runBulk(() => bulkSetPromoActive(selectedIds, false)),
        },
        {
          key: "delete",
          label: "Delete",
          icon: <Trash2 size={14} />,
          variant: "danger",
          confirm: "Archive the selected promo codes? They can be restored from the Archived view.",
          onRun: () => runBulk(() => bulkSoftDelete("promoCode", selectedIds)),
        },
      ];

  const toggleArchived = () => {
    clear();
    router.push(`/admin/promo-codes${archived ? "" : "?archived=1"}`);
  };

  function fmt(c: PromoCode) {
    return c.discountType === "PERCENT" ? `${c.discountValue}% off` : `$${c.discountValue.toFixed(2)} off`;
  }

  return (
    <div className="admin-font stack-24">
      <header className="row-between" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div className="stack-8">
          <p className="eyebrow">Sales & Marketing</p>
          <h1 className="display">
            Promo Codes{" "}
            <span style={{ color: "var(--primary-40)", fontWeight: 300 }}>· {list.length}</span>
          </h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className={`btn ${archived ? "btn-primary" : "btn-secondary"}`}
            onClick={toggleArchived}
            title={archived ? "Back to active promo codes" : "View archived promo codes"}>
            {archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
            {archived ? "Active" : "Archived"}
          </button>
          {!archived && (
            <button type="button" className="btn btn-primary" onClick={() => setShowForm(v => !v)}>
              <Plus size={16} /> New code
            </button>
          )}
        </div>
      </header>

      {showForm && (
        <form onSubmit={handleCreate} className="atable-wrap" style={{ padding: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--primary)", marginBottom: 20 }}>New promo code</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
            <div className="field">
              <label className="label">Code</label>
              <input
                required
                className="input"
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase())}
                placeholder="SUMMER20"
                maxLength={24}
                style={{ fontFamily: "monospace", letterSpacing: "0.05em" }}
              />
            </div>
            <div className="field">
              <label className="label">Description</label>
              <input
                className="input"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Summer 2026 promo"
              />
            </div>
            <div className="field">
              <label className="label">Discount type</label>
              <PremiumSelect
                value={discountType}
                onChange={v => setDiscountType(v as "FIXED" | "PERCENT")}
                options={[{ value: "FIXED", label: "Fixed ($)" }, { value: "PERCENT", label: "Percentage (%)" }]}
                size="sm"
              />
            </div>
            <div className="field">
              <label className="label">Value {discountType === "FIXED" ? "($)" : "(%)"}</label>
              <input
                required type="number" min="0.01" step="0.01"
                className="input"
                value={discountValue}
                onChange={e => setDiscountValue(e.target.value)}
                placeholder={discountType === "FIXED" ? "20.00" : "15"}
              />
            </div>
            <div className="field">
              <label className="label">Max uses (blank = unlimited)</label>
              <input
                type="number" min="1"
                className="input"
                value={maxUses}
                onChange={e => setMaxUses(e.target.value)}
                placeholder="100"
              />
            </div>
            <div className="field">
              <label className="label">Expires (blank = never)</label>
              <DatePicker
                value={expiresAt}
                onChange={setExpiresAt}
                min={new Date().toISOString().slice(0, 10)}
                placeholder="No expiry"
              />
            </div>
          </div>
          {formError && <p style={{ fontSize: 13, color: "#b91c1c", marginTop: 12 }}>{formError}</p>}
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button type="submit" disabled={creating} className="btn btn-primary" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {creating && <Loader2 size={14} className="animate-spin" />}
              Create
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="btn btn-ghost">Cancel</button>
          </div>
        </form>
      )}

      {list.length === 0 ? (
        <div className="atable-wrap" style={{ padding: "80px 40px", textAlign: "center", color: "var(--primary-60)" }}>
          {archived ? "No archived promo codes." : "No promo codes yet."}
        </div>
      ) : (
        <div className="atable-wrap">
          <div className="atable-scroll">
            <table className="atable">
              <thead>
                <tr>
                  <th style={{ width: 40, paddingRight: 0 }}>
                    <input
                      type="checkbox"
                      aria-label="Select all promo codes"
                      checked={selection.allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = selection.someSelected;
                      }}
                      onChange={selection.toggleAll}
                      style={{ cursor: "pointer", width: 16, height: 16 }}
                    />
                  </th>
                  <th>Code</th>
                  <th>Discount</th>
                  <th className="num">Uses</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th className="col-actions" />
                </tr>
              </thead>
              <tbody>
                {list.map(c => (
                  <tr key={c.id} className={selection.isSelected(c.id) ? "row-selected" : undefined}>
                    <td style={{ width: 40, paddingRight: 0 }} onClick={(ev) => ev.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${c.code}`}
                        checked={selection.isSelected(c.id)}
                        onChange={() => selection.toggle(c.id)}
                        style={{ cursor: "pointer", width: 16, height: 16 }}
                      />
                    </td>
                    <td style={{ minWidth: 140 }}>
                      <div className="col-client" style={{ fontFamily: "monospace", letterSpacing: "0.06em" }}>{c.code}</div>
                      {c.description && <div className="col-client-sub">{c.description}</div>}
                    </td>
                    <td>
                      <span style={{ fontWeight: 600, color: "var(--ink)", fontSize: 13 }}>{fmt(c)}</span>
                    </td>
                    <td className="num">
                      <span style={{ fontWeight: 600, color: "var(--ink)" }}>{c.usesCount}</span>
                      {c.maxUses && <span style={{ color: "var(--primary-40)", fontSize: 12 }}> / {c.maxUses}</span>}
                    </td>
                    <td>
                      <span style={{ fontSize: 12, color: "var(--primary-70)" }}>
                        {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString("en-US") : "Never"}
                      </span>
                    </td>
                    <td>
                      <span style={{
                        display: "inline-block",
                        background: c.isActive ? "#dcfce7" : "#f1f5f9",
                        color: c.isActive ? "#15803d" : "#475569",
                        fontSize: 11, fontWeight: 600, borderRadius: 20, padding: "2px 10px",
                      }}>
                        {c.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="col-actions" onClick={(ev) => ev.stopPropagation()}>
                      {!archived && (
                        <div className="row" style={{ gap: 6 }}>
                          <button
                            type="button"
                            className="icon-btn"
                            title={c.isActive ? "Deactivate" : "Activate"}
                            disabled={busyId === c.id}
                            onClick={() => handleToggle(c.id)}>
                            {c.isActive
                              ? <ToggleRight size={16} style={{ color: "#008C9C" }} />
                              : <ToggleLeft size={16} />}
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            title="Delete"
                            disabled={busyId === c.id}
                            onClick={() => setDeleteId(c.id)}
                            style={{ color: "#ef4444" }}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selection.count > 0 && (
        <BulkActionBar
          count={selection.count}
          noun="promo code"
          actions={bulkActions}
          onClear={clear}
        />
      )}

      <style>{`
        .atable tr.row-selected td { background: var(--primary-05, #f0fdfa); }
      `}</style>

      <ConfirmDeleteModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={runDelete}
        fileName="this promo code"
        title="Delete promo code?"
        message="This action cannot be undone."
      />
    </div>
  );
}
