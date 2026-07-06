"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Star, Check, X } from "lucide-react";
import { addClientAddress, updateClientAddress, deleteClientAddress } from "../actions/clientAddresses";

interface ClientAddress {
  id: string;
  label: string;
  address: string;
  aptNumber: string | null;
  isDefault: boolean;
}

interface Props {
  clientId: string;
  addresses: ClientAddress[];
}

const BLANK_FORM = { label: "Home", address: "", aptNumber: "", isDefault: false };

export default function ClientAddressManager({ clientId, addresses }: Props) {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openAdd() {
    setForm(BLANK_FORM);
    setEditId(null);
    setError(null);
    setShowAdd(true);
  }

  function openEdit(addr: ClientAddress) {
    setForm({ label: addr.label, address: addr.address, aptNumber: addr.aptNumber || "", isDefault: addr.isDefault });
    setEditId(addr.id);
    setError(null);
    setShowAdd(true);
  }

  function cancel() {
    setShowAdd(false);
    setEditId(null);
    setError(null);
  }

  async function handleSave() {
    if (!form.address.trim()) { setError("Address is required"); return; }
    setSaving(true);
    setError(null);
    const fd = new FormData();
    fd.append("clientId", clientId);
    fd.append("label", form.label);
    fd.append("address", form.address);
    fd.append("aptNumber", form.aptNumber);
    if (form.isDefault) fd.append("isDefault", "on");
    if (editId) fd.append("id", editId);

    const result = editId ? await updateClientAddress(fd) : await addClientAddress(fd);
    setSaving(false);
    if (result.error) { setError(result.error); return; }
    setShowAdd(false);
    setEditId(null);
    router.refresh();
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this address?")) return;
    await deleteClientAddress(id);
    router.refresh();
  }

  return (
    <div style={{ marginTop: 8 }}>
      {addresses.length === 0 && !showAdd && (
        <p style={{ fontSize: 13, color: "var(--primary-50)", margin: "0 0 12px" }}>No saved addresses yet.</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: showAdd ? 0 : 8 }}>
        {addresses.map((addr) => (
          <div key={addr.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", borderRadius: 12, background: addr.isDefault ? "rgba(0,140,156,0.06)" : "rgba(0,140,156,0.03)", border: addr.isDefault ? "1px solid rgba(0,140,156,0.15)" : "1px solid rgba(0,140,156,0.08)" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--primary)" }}>{addr.label}</span>
                {addr.isDefault && <Star size={10} style={{ fill: "var(--primary)", color: "var(--primary)", flexShrink: 0 }} />}
              </div>
              <p style={{ fontSize: 13, color: "var(--ink)", margin: 0 }}>
                {addr.address}{addr.aptNumber ? `, ${addr.aptNumber}` : ""}
              </p>
            </div>
            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
              <button onClick={() => openEdit(addr)} style={{ padding: "4px 8px", borderRadius: 8, background: "transparent", border: "1px solid rgba(0,140,156,0.15)", cursor: "pointer", color: "var(--primary-60)" }}>
                <Pencil size={12} />
              </button>
              <button onClick={() => handleDelete(addr.id)} style={{ padding: "4px 8px", borderRadius: 8, background: "transparent", border: "1px solid rgba(220,38,38,0.2)", cursor: "pointer", color: "#dc2626" }}>
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {showAdd && (
        <div style={{ padding: 16, borderRadius: 14, background: "rgba(0,140,156,0.04)", border: "1px solid rgba(0,140,156,0.1)", marginBottom: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 10 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--primary-60)", display: "block", marginBottom: 4 }}>Label</label>
              <input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="e.g. Home, Office" style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(0,140,156,0.2)", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--primary-60)", display: "block", marginBottom: 4 }}>Apt / Unit</label>
              <input value={form.aptNumber} onChange={(e) => setForm((f) => ({ ...f, aptNumber: e.target.value }))} placeholder="optional" style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(0,140,156,0.2)", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--primary-60)", display: "block", marginBottom: 4 }}>Street address <span style={{ color: "#dc2626" }}>*</span></label>
            <input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="123 rue Sainte-Catherine, Montréal" style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(0,140,156,0.2)", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink-soft)", cursor: "pointer", marginBottom: 12 }}>
            <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))} />
            Set as default address
          </label>
          {error && <p style={{ color: "#dc2626", fontSize: 12, marginBottom: 8 }}>{error}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleSave} disabled={saving} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, background: "var(--primary)", color: "#fff", border: "none", cursor: saving ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
              <Check size={13} />{saving ? "Saving…" : "Save address"}
            </button>
            <button onClick={cancel} disabled={saving} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, background: "transparent", color: "var(--primary-60)", border: "1px solid rgba(0,140,156,0.15)", cursor: "pointer", fontSize: 13 }}>
              <X size={13} />Cancel
            </button>
          </div>
        </div>
      )}

      {!showAdd && (
        <button onClick={openAdd} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, background: "transparent", color: "var(--primary)", border: "1px dashed rgba(0,140,156,0.3)", cursor: "pointer", fontSize: 13, fontWeight: 500 }}>
          <Plus size={13} /> Add address
        </button>
      )}
    </div>
  );
}
