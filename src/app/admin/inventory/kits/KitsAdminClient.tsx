"use client";

import { useMemo, useState, useTransition } from "react";
import { Search, Package, Users } from "lucide-react";
import {
  assignToCleanerKit,
  removeFromCleanerKit,
} from "../../actions/assignToCleanerKit";

interface KitItem {
  employeeProductId: string;
  productId: string;
  productName: string;
  unit: string;
  category: string;
  quantity: number;
  masterStock: number;
}

interface Cleaner {
  id: string;
  name: string;
  email: string;
  kit: KitItem[];
}

interface Product {
  id: string;
  name: string;
  unit: string;
  stockLevel: number;
  category: string;
}

interface Props {
  cleaners: Cleaner[];
  products: Product[];
}

const AVATAR_COLORS = ["#008C9C", "#0284c7", "#7c3aed", "#dc2626", "#d97706", "#059669"];
function avatarColor(name: string) { return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length]; }
function initials(name: string) { return name.split(" ").slice(0, 2).map(p => p[0] ?? "").join("").toUpperCase(); }

export default function KitsAdminClient({ cleaners, products }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(
    cleaners[0]?.id ?? null
  );
  const [search, setSearch] = useState("");
  const [addProductId, setAddProductId] = useState("");
  const [addQty, setAddQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cleaners;
    return cleaners.filter(
      (c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
    );
  }, [cleaners, search]);

  const selected = cleaners.find((c) => c.id === selectedId) ?? null;

  function add() {
    if (!selected || !addProductId || addQty <= 0) return;
    setBusy(true);
    setError(null);
    startTransition(async () => {
      const result = await assignToCleanerKit({
        cleanerId: selected.id,
        productId: addProductId,
        quantity: addQty,
      });
      setBusy(false);
      if (!result.success) {
        setError(result.error ?? "Failed to add");
        return;
      }
      setAddProductId("");
      setAddQty(1);
    });
  }

  function remove(item: KitItem) {
    if (!selected) return;
    const qty = Number(prompt(`Remove how many ${item.productName}?`, "1"));
    if (!qty || qty <= 0) return;
    setBusy(true);
    setError(null);
    startTransition(async () => {
      const result = await removeFromCleanerKit({
        cleanerId: selected.id,
        productId: item.productId,
        quantity: qty,
      });
      setBusy(false);
      if (!result.success) {
        setError(result.error ?? "Failed to remove");
      }
    });
  }

  return (
    <div className="admin-font stack-24">
      <header className="stack-8">
        <p className="eyebrow">Inventory</p>
        <h1 className="display">Cleaner Kits</h1>
        <p style={{ fontSize: 14, color: "var(--primary-60)" }}>
          Assign items to each cleaner's personal kit. Master stock only drops when a cleaner reports damage or loss.
        </p>
      </header>

      <div className="astat-grid">
        <div className="astat">
          <div className="astat-head"><span>Cleaners</span><span className="astat-icon"><Users size={15} /></span></div>
          <div className="astat-value">{cleaners.length}</div>
          <div className="astat-delta">with kit management</div>
        </div>
        <div className="astat">
          <div className="astat-head"><span>Products</span><span className="astat-icon"><Package size={15} /></span></div>
          <div className="astat-value">{products.length}</div>
          <div className="astat-delta">assignable items</div>
        </div>
      </div>

      <div className="stack-mobile" style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 20, alignItems: "start" }}>
        {/* Cleaner list */}
        <div className="atable-wrap" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: 12, borderBottom: "1px solid var(--primary-10)" }}>
            <div style={{ position: "relative" }}>
              <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--primary-40)", pointerEvents: "none" }} />
              <input
                type="text"
                placeholder="Search cleaners…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input"
                style={{ paddingLeft: 32, width: "100%", fontSize: 13 }}
              />
            </div>
          </div>
          <div style={{ maxHeight: 540, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: "24px 16px", textAlign: "center", fontSize: 13, color: "var(--primary-50)" }}>No cleaners found.</div>
            ) : filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedId(c.id)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 14px",
                  textAlign: "left",
                  background: c.id === selectedId ? "var(--primary-5)" : "transparent",
                  borderTop: "1px solid var(--primary-10)",
                  cursor: "pointer",
                  borderLeft: c.id === selectedId ? "3px solid var(--primary)" : "3px solid transparent",
                }}>
                <span className="avatar" style={{ background: avatarColor(c.name), fontSize: 11, width: 32, height: 32, flexShrink: 0 }}>
                  {initials(c.name)}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: "var(--primary-60)", marginTop: 1 }}>{c.kit.length} kit item{c.kit.length === 1 ? "" : "s"}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Selected cleaner's kit */}
        <div className="atable-wrap" style={{ padding: 20 }}>
          {!selected ? (
            <p style={{ fontSize: 14, color: "var(--primary-50)", padding: "40px 0", textAlign: "center" }}>
              Pick a cleaner from the left to manage their kit.
            </p>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <span className="avatar" style={{ background: avatarColor(selected.name), fontSize: 14, width: 40, height: 40, flexShrink: 0 }}>
                  {initials(selected.name)}
                </span>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>{selected.name}</div>
                  <div style={{ fontSize: 12, color: "var(--primary-60)", marginTop: 2 }}>{selected.email}</div>
                </div>
              </div>

              <div style={{ background: "var(--primary-5)", borderRadius: 10, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--primary-60)", marginBottom: 10 }}>
                  Add to kit
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <select
                    value={addProductId}
                    onChange={(e) => setAddProductId(e.target.value)}
                    className="input"
                    style={{ flex: "1 1 200px", fontSize: 13 }}>
                    <option value="">Select product…</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} (master: {p.stockLevel} {p.unit})
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    value={addQty}
                    onChange={(e) => setAddQty(Math.max(1, Number(e.target.value)))}
                    className="input"
                    style={{ width: 90, fontSize: 13 }}
                  />
                  <button
                    type="button"
                    onClick={add}
                    disabled={!addProductId || busy}
                    className="btn btn-primary"
                    style={{ opacity: !addProductId || busy ? 0.5 : 1 }}>
                    {busy ? "…" : "Add"}
                  </button>
                </div>
                {error && <p style={{ marginTop: 8, fontSize: 12, color: "#dc2626" }}>{error}</p>}
              </div>

              {selected.kit.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--primary-50)", textAlign: "center", padding: "32px 0" }}>
                  No items in this cleaner's kit yet.
                </p>
              ) : (
                <div className="atable-scroll">
                  <table className="atable">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>In kit</th>
                        <th>Master stock</th>
                        <th className="col-actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {selected.kit.map((item) => (
                        <tr key={item.employeeProductId}>
                          <td><span className="col-client">{item.productName}</span></td>
                          <td style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                            {item.quantity} {item.unit}
                          </td>
                          <td style={{ fontSize: 12, color: "var(--primary-60)", fontVariantNumeric: "tabular-nums" }}>
                            {item.masterStock} {item.unit}
                          </td>
                          <td className="col-actions">
                            <button
                              type="button"
                              onClick={() => remove(item)}
                              disabled={busy}
                              className="btn btn-ghost btn-sm">
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 700px) {
          .kits-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
