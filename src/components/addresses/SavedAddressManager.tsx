"use client";

/**
 * The saved-address book UI, shared by the admin client page and the customer
 * portal account page (awerfixes.pdf item 2, round 3, stage 4).
 *
 * Presentational only: it takes its three actions as props, so admin mounts it
 * with the ADMIN/OWNER-gated actions in app/admin/actions/clientAddresses.ts
 * and the portal mounts it with the session-scoped ones in
 * app/(customer)/actions/clientAddresses.ts. Same UI, two authorisation
 * models, one component instead of a fork.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Star, Check, X, KeyRound, Home } from "lucide-react";
import { formatAddressLine, type SavedAddress } from "@/lib/client-address";
import { formatPropertySize } from "@/lib/property-size";
import {
  PROPERTY_TYPES,
  PROPERTY_TYPE_LABEL,
  type PropertyType,
} from "@/lib/property-type";

type ActionResult = { success?: boolean; error?: string };

interface Props {
  addresses: SavedAddress[];
  /** Extra hidden FormData entries every save carries (admin sends clientId). */
  extraFields?: Record<string, string>;
  onAdd: (fd: FormData) => Promise<ActionResult>;
  onUpdate: (fd: FormData) => Promise<ActionResult>;
  onDelete: (id: string) => Promise<ActionResult>;
  /** Shown when the client has no saved addresses yet. */
  emptyText?: string;
  /**
   * Access notes reach the assigned cleaner. Admins get the field; the wording
   * differs for a customer, so the label is injected rather than assumed.
   */
  accessNotesHint?: string;
}

const BLANK_FORM = {
  label: "Home",
  address: "",
  aptNumber: "",
  city: "",
  postalCode: "",
  accessNotes: "",
  // Property size (item 3). Held as STRINGS, like every other field here: ""
  // is "leave it unrecorded" and "0" is a real answer (a studio), and the two
  // are indistinguishable once a number type gets involved.
  propertyType: "" as PropertyType | "",
  bedCount: "",
  bathCount: "",
  halfBathCount: "",
  squareFootage: "",
  isDefault: false,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid rgba(0,140,156,0.2)",
  fontSize: 13,
  outline: "none",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "var(--primary-60)",
  display: "block",
  marginBottom: 4,
};

export default function SavedAddressManager({
  addresses,
  extraFields,
  onAdd,
  onUpdate,
  onDelete,
  emptyText = "No saved addresses yet.",
  accessNotesHint = "Door codes, gate codes, parking — shown to the assigned cleaner.",
}: Props) {
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

  function openEdit(addr: SavedAddress) {
    setForm({
      label: addr.label,
      address: addr.address,
      aptNumber: addr.aptNumber || "",
      city: addr.city || "",
      postalCode: addr.postalCode || "",
      accessNotes: addr.accessNotes || "",
      // `?? ""` and not `|| ""`: a stored 0 must survive into the field, or
      // editing a studio's access notes would quietly erase its "0 bedrooms".
      propertyType: addr.propertyType ?? "",
      bedCount: addr.bedCount?.toString() ?? "",
      bathCount: addr.bathCount?.toString() ?? "",
      halfBathCount: addr.halfBathCount?.toString() ?? "",
      squareFootage: addr.squareFootage?.toString() ?? "",
      isDefault: addr.isDefault,
    });
    setEditId(addr.id);
    setError(null);
    setShowAdd(true);
  }

  function cancel() {
    setShowAdd(false);
    setEditId(null);
    setError(null);
  }

  const set = (k: keyof typeof BLANK_FORM, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function handleSave() {
    if (!form.address.trim()) {
      setError("Address is required");
      return;
    }
    setSaving(true);
    setError(null);

    const fd = new FormData();
    for (const [k, v] of Object.entries(extraFields ?? {})) fd.append(k, v);
    fd.append("label", form.label);
    fd.append("address", form.address);
    fd.append("aptNumber", form.aptNumber);
    fd.append("city", form.city);
    fd.append("postalCode", form.postalCode);
    fd.append("accessNotes", form.accessNotes);
    // Always posted, blank included — a cleared field is an admin deliberately
    // saying "we don't know", and the actions read an empty string as null.
    fd.append("propertyType", form.propertyType);
    fd.append("bedCount", String(form.bedCount));
    fd.append("bathCount", String(form.bathCount));
    fd.append("halfBathCount", String(form.halfBathCount));
    fd.append("squareFootage", String(form.squareFootage));
    if (form.isDefault) fd.append("isDefault", "on");
    if (editId) fd.append("id", editId);

    const result = editId ? await onUpdate(fd) : await onAdd(fd);
    setSaving(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setShowAdd(false);
    setEditId(null);
    router.refresh();
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this address?")) return;
    // Previously the result was discarded, so a rejected delete looked like a
    // successful one until the refresh silently put the row back.
    const result = await onDelete(id);
    if (result?.error) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div style={{ marginTop: 8 }}>
      {addresses.length === 0 && !showAdd && (
        <p style={{ fontSize: 13, color: "var(--primary-50)", margin: "0 0 12px" }}>
          {emptyText}
        </p>
      )}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          marginBottom: showAdd ? 0 : 8,
        }}>
        {addresses.map((addr) => (
          <div
            key={addr.id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "10px 12px",
              borderRadius: 12,
              background: addr.isDefault ? "rgba(0,140,156,0.06)" : "rgba(0,140,156,0.03)",
              border: addr.isDefault
                ? "1px solid rgba(0,140,156,0.15)"
                : "1px solid rgba(0,140,156,0.08)",
            }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--primary)",
                  }}>
                  {addr.label}
                </span>
                {addr.isDefault && (
                  <Star
                    size={10}
                    style={{ fill: "var(--primary)", color: "var(--primary)", flexShrink: 0 }}
                  />
                )}
              </div>
              {/* One formatter everywhere, so an imported row that carries its
                  unit inside the street string can't print it twice here. */}
              <p style={{ fontSize: 13, color: "var(--ink)", margin: 0 }}>
                {formatAddressLine(addr)}
              </p>
              {/* What is AT this address (item 3) — so an admin can see at a
                  glance that the condo is already recorded as 2 bed / 1 bath
                  and stop retyping it on every booking. */}
              {formatPropertySize(addr) && (
                <p
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 12,
                    color: "var(--primary-60)",
                    margin: "4px 0 0",
                  }}>
                  <Home size={11} style={{ flexShrink: 0 }} />
                  {formatPropertySize(addr)}
                </p>
              )}
              {addr.accessNotes && (
                <p
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 12,
                    color: "var(--primary-60)",
                    margin: "4px 0 0",
                  }}>
                  <KeyRound size={11} style={{ flexShrink: 0 }} />
                  {addr.accessNotes}
                </p>
              )}
            </div>
            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
              <button
                onClick={() => openEdit(addr)}
                aria-label={`Edit ${addr.label} address`}
                style={{
                  padding: "4px 8px",
                  borderRadius: 8,
                  background: "transparent",
                  border: "1px solid rgba(0,140,156,0.15)",
                  cursor: "pointer",
                  color: "var(--primary-60)",
                }}>
                <Pencil size={12} />
              </button>
              <button
                onClick={() => handleDelete(addr.id)}
                aria-label={`Remove ${addr.label} address`}
                style={{
                  padding: "4px 8px",
                  borderRadius: 8,
                  background: "transparent",
                  border: "1px solid rgba(220,38,38,0.2)",
                  cursor: "pointer",
                  color: "#dc2626",
                }}>
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {showAdd && (
        <div
          style={{
            padding: 16,
            borderRadius: 14,
            background: "rgba(0,140,156,0.04)",
            border: "1px solid rgba(0,140,156,0.1)",
            marginBottom: 10,
          }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 10,
              marginBottom: 10,
            }}>
            <div>
              <label style={labelStyle}>Label</label>
              <input
                value={form.label}
                onChange={(e) => set("label", e.target.value)}
                placeholder="e.g. Home, Office"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Apt / Unit</label>
              <input
                value={form.aptNumber}
                onChange={(e) => set("aptNumber", e.target.value)}
                placeholder="optional"
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>
              Street address <span style={{ color: "#dc2626" }}>*</span>
            </label>
            <input
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
              placeholder="123 rue Sainte-Catherine, Montréal"
              style={inputStyle}
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 10,
              marginBottom: 10,
            }}>
            <div>
              <label style={labelStyle}>City</label>
              <input
                value={form.city}
                onChange={(e) => set("city", e.target.value)}
                placeholder="Montréal"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Postal code</label>
              <input
                value={form.postalCode}
                onChange={(e) => set("postalCode", e.target.value.toUpperCase())}
                placeholder="H3Z 1H2"
                style={inputStyle}
              />
            </div>
          </div>

          {/* ── Property size (item 3) ───────────────────────────────────
              Saved against the DOOR, not the booking, so admin stops
              re-entering the same apartment/house size every time this
              customer books. Every field is optional: "not recorded" is a
              legitimate state, and a blank here never overwrites a size the
              job forms have already learned. */}
          <div
            style={{
              padding: 12,
              borderRadius: 10,
              background: "rgba(0,140,156,0.03)",
              border: "1px solid rgba(0,140,156,0.08)",
              marginBottom: 10,
            }}>
            <p
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--primary)",
                margin: "0 0 8px",
              }}>
              Property size
            </p>

            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>Property type</label>
              <select
                value={form.propertyType}
                onChange={(e) => set("propertyType", e.target.value)}
                style={{ ...inputStyle, background: "#fff" }}>
                <option value="">Not recorded</option>
                {PROPERTY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PROPERTY_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
                gap: 10,
              }}>
              <div>
                <label style={labelStyle}>Bedrooms</label>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={form.bedCount}
                  onChange={(e) => set("bedCount", e.target.value)}
                  placeholder="—"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Bathrooms</label>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={form.bathCount}
                  onChange={(e) => set("bathCount", e.target.value)}
                  placeholder="—"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Half baths</label>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={form.halfBathCount}
                  onChange={(e) => set("halfBathCount", e.target.value)}
                  placeholder="—"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Square feet</label>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={form.squareFootage}
                  onChange={(e) => set("squareFootage", e.target.value)}
                  placeholder="—"
                  style={inputStyle}
                />
              </div>
            </div>
            <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--primary-50)" }}>
              Pre-fills every new booking at this address. Leave blank if you
              don&apos;t know — a booking that records it will fill it in.
            </p>
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Access notes</label>
            <textarea
              value={form.accessNotes}
              onChange={(e) => set("accessNotes", e.target.value)}
              placeholder="e.g. Buzzer 402, gate code 1974, park in visitor spot 3"
              rows={2}
              style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
            />
            <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--primary-50)" }}>
              {accessNotesHint}
            </p>
          </div>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              color: "var(--ink-soft)",
              cursor: "pointer",
              marginBottom: 12,
            }}>
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => set("isDefault", e.target.checked)}
            />
            Set as default address
          </label>

          {error && <p style={{ color: "#dc2626", fontSize: 12, marginBottom: 8 }}>{error}</p>}

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "7px 14px",
                borderRadius: 8,
                background: "var(--primary)",
                color: "#fff",
                border: "none",
                cursor: saving ? "not-allowed" : "pointer",
                fontSize: 13,
                fontWeight: 600,
                opacity: saving ? 0.7 : 1,
              }}>
              <Check size={13} />
              {saving ? "Saving…" : "Save address"}
            </button>
            <button
              onClick={cancel}
              disabled={saving}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "7px 14px",
                borderRadius: 8,
                background: "transparent",
                color: "var(--primary-60)",
                border: "1px solid rgba(0,140,156,0.15)",
                cursor: "pointer",
                fontSize: 13,
              }}>
              <X size={13} />
              Cancel
            </button>
          </div>
        </div>
      )}

      {!showAdd && (
        <>
          {error && <p style={{ color: "#dc2626", fontSize: 12, marginBottom: 8 }}>{error}</p>}
          <button
            onClick={openAdd}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 14px",
              borderRadius: 8,
              background: "transparent",
              color: "var(--primary)",
              border: "1px dashed rgba(0,140,156,0.3)",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 500,
            }}>
            <Plus size={13} /> Add address
          </button>
        </>
      )}
    </div>
  );
}
