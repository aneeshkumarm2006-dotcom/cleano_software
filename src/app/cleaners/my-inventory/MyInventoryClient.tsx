"use client";

import { useState, useTransition } from "react";
import { reportDamagedItem } from "@/app/admin/actions/reportDamagedItem";
import { createInventoryRequest } from "@/app/admin/actions/createInventoryRequest";
import { updateMyInventoryCount } from "@/app/admin/actions/updateMyInventoryCount";
import { addMyInventoryItem } from "./addMyInventoryItem";

interface PendingRequest {
  quantity: number;
  createdAt: string;
}

interface InventoryItem {
  id: string;
  productId: string;
  productName: string;
  productDescription: string | null;
  unit: string;
  quantity: number;
  refillThreshold: number;
  usesDefaultThreshold: boolean;
  usagePerJob: number;
  assignedAt: string;
  updatedAt: string;
  isLow: boolean;
  isOutOfStock: boolean;
  pendingRequest: PendingRequest | null;
}

interface Location {
  id: string;
  name: string;
  address: string | null;
}

interface CatalogProduct {
  id: string;
  name: string;
  unit: string | null;
}

interface MyInventoryClientProps {
  items: InventoryItem[];
  locations?: Location[];
  catalog?: CatalogProduct[];
}

/** Shared modal shell — matches the damage-report dialog already in use here. */
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 14,
          maxWidth: 420,
          width: "100%",
          padding: 24,
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
        }}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  marginTop: 16,
  fontSize: 12,
  fontWeight: 600,
  color: "var(--primary-70)",
};

const inputStyle: React.CSSProperties = {
  marginTop: 4,
  width: "100%",
  padding: "8px 12px",
  fontSize: 14,
  border: "1px solid var(--primary-15)",
  borderRadius: 8,
};

export default function MyInventoryClient({ items, catalog = [] }: MyInventoryClientProps) {
  const needAttn = items.filter((i) => i.isLow || i.isOutOfStock).length;
  const totalUnits = items.reduce((s, i) => s + i.quantity, 0);
  const hasItems = items.length > 0;

  /* ---------------------------- damage / loss ---------------------------- */
  const [damageItem, setDamageItem] = useState<InventoryItem | null>(null);
  const [damageQty, setDamageQty] = useState(1);
  const [damageReason, setDamageReason] = useState("");
  const [damageKind, setDamageKind] = useState<"damaged" | "lost">("damaged");
  const [damageError, setDamageError] = useState<string | null>(null);
  const [damageBusy, startDamage] = useTransition();

  function openDamage(item: InventoryItem) {
    setDamageItem(item);
    setDamageQty(1);
    setDamageReason("");
    setDamageKind("damaged");
    setDamageError(null);
  }

  function submitDamage() {
    if (!damageItem) return;
    setDamageError(null);
    startDamage(async () => {
      const result = await reportDamagedItem({
        productId: damageItem.productId,
        quantity: damageQty,
        reason: damageReason,
        kind: damageKind,
      });
      if (!result.success) {
        setDamageError(result.error ?? "Failed to report");
        return;
      }
      setDamageItem(null);
    });
  }

  /* ---------------------------- refill request ---------------------------- */
  // Locally-requested ids, so the button flips to "Requested" straight away
  // (the server revalidation refreshes `pendingRequest` right behind it).
  const [justRequested, setJustRequested] = useState<Set<string>>(new Set());
  const [refillItem, setRefillItem] = useState<InventoryItem | null>(null);
  const [refillQty, setRefillQty] = useState(1);
  const [refillReason, setRefillReason] = useState("");
  const [refillError, setRefillError] = useState<string | null>(null);
  const [refillBusy, startRefill] = useTransition();

  function isPending(item: InventoryItem) {
    return !!item.pendingRequest || justRequested.has(item.productId);
  }

  function openRefill(item: InventoryItem) {
    setRefillItem(item);
    // Suggest topping back up to a comfortable level above the refill line.
    const suggested = Math.max(
      1,
      Math.ceil(item.refillThreshold * 2 - item.quantity)
    );
    setRefillQty(suggested);
    setRefillReason("");
    setRefillError(null);
  }

  function submitRefill() {
    if (!refillItem) return;
    setRefillError(null);
    startRefill(async () => {
      const res = await createInventoryRequest({
        productId: refillItem.productId,
        quantity: refillQty,
        reason: refillReason.trim() || "Running low — refill requested",
      });
      if (!res.success) {
        setRefillError(res.error ?? "Failed to request refill");
        return;
      }
      setJustRequested((prev) => new Set(prev).add(refillItem.productId));
      setRefillItem(null);
    });
  }

  /* --------------------- starting inventory (add item) --------------------- */
  // Spec item 15: cleaners record what they already have on hand — products
  // not yet in the kit — without waiting for an admin assignment.
  const [addOpen, setAddOpen] = useState(false);
  const [addProductId, setAddProductId] = useState("");
  const [addQty, setAddQty] = useState(1);
  const [addError, setAddError] = useState<string | null>(null);
  const [addBusy, startAdd] = useTransition();
  const inKit = new Set(items.map((i) => i.productId));
  const addable = catalog.filter((p) => !inKit.has(p.id));

  function submitAdd() {
    if (!addProductId) {
      setAddError("Pick a product");
      return;
    }
    setAddError(null);
    startAdd(async () => {
      const res = await addMyInventoryItem({ productId: addProductId, quantity: addQty });
      if (!res.success) {
        setAddError(res.error ?? "Failed to add item");
        return;
      }
      setAddOpen(false);
      setAddProductId("");
      setAddQty(1);
    });
  }

  /* ------------------------- cleaner count correction ------------------------- */
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [editQty, setEditQty] = useState(0);
  const [editReason, setEditReason] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editBusy, startEdit] = useTransition();

  function openEdit(item: InventoryItem) {
    setEditItem(item);
    setEditQty(item.quantity);
    setEditReason("");
    setEditError(null);
  }

  function submitEdit() {
    if (!editItem) return;
    setEditError(null);
    startEdit(async () => {
      const res = await updateMyInventoryCount({
        productId: editItem.productId,
        quantity: editQty,
        reason: editReason,
      });
      if (!res.success) {
        setEditError(res.error ?? "Failed to update count");
        return;
      }
      setEditItem(null);
    });
  }

  return (
    <div className="cl-page-wrap">
      <div className="cl-page-head">
        <div>
          <h1 className="cl-page-title">My inventory</h1>
          <p className="cl-page-sub">Equipment and supplies assigned to you.</p>
        </div>
      </div>

      {/* Hero */}
      <div className="cl-inv-hero">
        <div className="cl-inv-hero-main">
          <span className="greet-label">Your kit</span>
          <h2>
            {items.length} item{items.length === 1 ? "" : "s"} <em>in your bag.</em>
          </h2>
          <p className="desc">
            {!hasItems
              ? "Nothing assigned yet — pick up your starter supplies from storage."
              : needAttn === 0
                ? "You're fully stocked. Nice work keeping the kit topped up."
                : `${needAttn} ${needAttn === 1 ? "item is" : "items are"} running low — request a refill or pick replacements up from storage.`}
          </p>
          <div className="cl-inv-hero-actions">
            <a href="/cleaners/my-inventory/checkout" className="cl-inv-hero-btn">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></svg>
              Pick up from storage
            </a>
            {addable.length > 0 && (
              <button
                type="button"
                className="cl-inv-hero-btn"
                onClick={() => { setAddOpen(true); setAddError(null); }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                Add item I already have
              </button>
            )}
          </div>
        </div>

        {/* Stat cards are meaningless with an empty kit — hide them until there
            is something to count. */}
        {hasItems && (
          <>
            <div className={`cl-inv-hero-stat${needAttn > 0 ? " alert" : ""}`}>
              <div className="top">
                <span>Needs attention</span>
                <span className="icon-bubble">
                  {needAttn > 0 ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  )}
                </span>
              </div>
              <div className="big">{needAttn}</div>
              <div className="sub">{needAttn === 0 ? "All items stocked" : `${needAttn} at or below refill threshold`}</div>
            </div>

            <div className="cl-inv-hero-stat">
              <div className="top">
                <span>Total units</span>
                <span className="icon-bubble">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>
                </span>
              </div>
              <div className="big">{totalUnits}</div>
              <div className="sub">across {items.length} item{items.length === 1 ? "" : "s"}</div>
            </div>
          </>
        )}
      </div>

      {/* Section header — only once there's something to list. */}
      {hasItems && (
        <div className="cl-inv-section">
          <h2>
            Assigned items
            <span className="count">{items.length}</span>
          </h2>
        </div>
      )}

      {!hasItems ? (
        <div className="cl-empty-block">
          <div className="icon-bubble">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></svg>
          </div>
          <div>No items assigned yet. <a href="/cleaners/my-inventory/checkout" style={{ color: "var(--primary)", textDecoration: "underline" }}>Pick up from storage.</a></div>
        </div>
      ) : (
        <div className="cl-inv-list">
          {items.map((item) => {
            const pct = Math.min(100, (item.quantity / Math.max(item.refillThreshold * 2, 1)) * 100);
            const threshPct = Math.min(100, (item.refillThreshold / Math.max(item.refillThreshold * 2, 1)) * 100);
            const statusCls = item.isOutOfStock ? "empty" : item.isLow ? "low" : "";
            const pillCls = item.isOutOfStock ? "empty" : item.isLow ? "low" : "ok";
            const pending = isPending(item);
            const needsRefill = item.isLow || item.isOutOfStock;

            return (
              <article key={item.id} className={`cl-inv-row ${statusCls}`}>
                <div className="ir-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>
                </div>

                <div className="ir-meta">
                  <div className="name-row">
                    <span className="ir-name">{item.productName}</span>
                    <span className={`cl-pill ${pillCls}`}>
                      {item.isOutOfStock ? "Empty" : item.isLow ? "Low" : "OK"}
                    </span>
                    {pending && (
                      <span className="cl-pill pending">Refill requested</span>
                    )}
                  </div>
                  {item.productDescription && (
                    <p className="ir-desc">{item.productDescription}</p>
                  )}
                  {needsRefill && !pending && (
                    <p className="ir-desc" style={{ color: item.isOutOfStock ? "var(--error-text)" : "var(--amber-800)", fontWeight: 600 }}>
                      {item.isOutOfStock
                        ? "Out of stock — request a refill."
                        : `Running low (${item.quantity} ${item.unit} left) — request a refill.`}
                    </p>
                  )}
                </div>

                <div className="ir-meter">
                  <div className="cl-inv-meter-head">
                    <span className="cl-inv-meter-qty">
                      {item.quantity}<span className="unit"> {item.unit}</span>
                    </span>
                    <span className="cl-inv-meter-thresh">Refill at {item.refillThreshold}</span>
                  </div>
                  <div className="cl-inv-meter-bar">
                    <div className="cl-inv-meter-fill" style={{ width: `${pct}%` }} />
                    {item.refillThreshold > 0 && (
                      <span className="cl-inv-meter-thresh-mark" style={{ left: `calc(${threshPct}% - 1px)` }} />
                    )}
                  </div>
                  <div className="ir-updated">
                    Updated {new Date(item.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </div>
                </div>

                {/* 4th grid column — stays visible on mobile (the meter column
                    is hidden below 900px, which used to hide these actions). */}
                <div className="ir-actions" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className={`cl-action-btn${needsRefill && !pending ? " solid" : ""}`}
                    onClick={() => openRefill(item)}
                    disabled={pending}
                    title={pending ? "A refill request is already pending" : "Request a refill from the warehouse"}>
                    {pending ? "Refill requested" : "Request refill"}
                  </button>
                  <button
                    type="button"
                    className="cl-action-btn"
                    onClick={() => openEdit(item)}
                    title="Correct the count if what you have doesn't match">
                    Update count
                  </button>
                  <button
                    type="button"
                    className="cl-action-btn"
                    onClick={() => openDamage(item)}
                    disabled={item.quantity <= 0}>
                    Report damaged or lost
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Refill request */}
      {refillItem && (
        <Modal title={`Request refill: ${refillItem.productName}`} onClose={() => setRefillItem(null)}>
          <p style={{ marginTop: 8, fontSize: 13, color: "var(--primary-60)" }}>
            You have {refillItem.quantity} {refillItem.unit}. Admin gets a request and
            tops you up from the warehouse.
          </p>

          <label style={labelStyle}>How many {refillItem.unit} do you need?</label>
          <input
            type="number"
            min={1}
            value={refillQty}
            onChange={(e) => setRefillQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            style={inputStyle}
          />

          <label style={labelStyle}>Note (optional)</label>
          <textarea
            value={refillReason}
            onChange={(e) => setRefillReason(e.target.value)}
            rows={3}
            placeholder="e.g. need it before Friday's deep clean"
            style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
          />

          {refillError && (
            <p style={{ marginTop: 12, fontSize: 13, color: "var(--error-text)" }}>{refillError}</p>
          )}

          <div style={{ marginTop: 20, display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="cl-action-btn" onClick={() => setRefillItem(null)}>
              Cancel
            </button>
            <button type="button" className="cl-action-btn solid" onClick={submitRefill} disabled={refillBusy}>
              {refillBusy ? "Sending..." : "Send request"}
            </button>
          </div>
        </Modal>
      )}

      {/* Cleaner-side count correction */}
      {addOpen && (
        <Modal title="Add item I already have" onClose={() => setAddOpen(false)}>
          <p style={{ marginTop: 8, fontSize: 13, color: "var(--primary-60)" }}>
            Record supplies already in your kit (e.g. your starting inventory).
            The add is logged to the item&apos;s stock history.
          </p>

          <label style={labelStyle}>Product</label>
          <select
            value={addProductId}
            onChange={(e) => setAddProductId(e.target.value)}
            style={{ ...inputStyle, background: "#fff" }}>
            <option value="">Select a product…</option>
            {addable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.unit ? ` (${p.unit})` : ""}
              </option>
            ))}
          </select>

          <label style={labelStyle}>Quantity</label>
          <input
            type="number"
            min={1}
            value={addQty}
            onChange={(e) => setAddQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            style={inputStyle}
          />

          {addError && (
            <p style={{ marginTop: 12, fontSize: 13, color: "var(--error-text)" }}>{addError}</p>
          )}

          <div style={{ marginTop: 20, display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="cl-action-btn" onClick={() => setAddOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="cl-action-btn solid"
              onClick={submitAdd}
              disabled={addBusy || !addProductId}>
              {addBusy ? "Adding..." : "Add to my kit"}
            </button>
          </div>
        </Modal>
      )}

      {editItem && (
        <Modal title={`Update count: ${editItem.productName}`} onClose={() => setEditItem(null)}>
          <p style={{ marginTop: 8, fontSize: 13, color: "var(--primary-60)" }}>
            Recount what you actually have. The change is logged to the item&apos;s
            stock history so admin can see it.
          </p>

          <label style={labelStyle}>
            Actual count in {editItem.unit} (currently {editItem.quantity})
          </label>
          <input
            type="number"
            min={0}
            value={editQty}
            onChange={(e) => setEditQty(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
            style={inputStyle}
          />

          <label style={labelStyle}>Reason</label>
          <textarea
            value={editReason}
            onChange={(e) => setEditReason(e.target.value)}
            rows={3}
            placeholder="e.g. recounted the van — two bottles were already empty"
            style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
          />
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--primary-60)" }}>
            Damaged or lost items should go through <strong>Report damaged or lost</strong> so
            master stock is adjusted too.
          </div>

          {editError && (
            <p style={{ marginTop: 12, fontSize: 13, color: "var(--error-text)" }}>{editError}</p>
          )}

          <div style={{ marginTop: 20, display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="cl-action-btn" onClick={() => setEditItem(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="cl-action-btn solid"
              onClick={submitEdit}
              disabled={editBusy || !editReason.trim()}>
              {editBusy ? "Saving..." : "Save count"}
            </button>
          </div>
        </Modal>
      )}

      {/* Damage / loss report */}
      {damageItem && (
        <Modal title={`Report ${damageItem.productName}`} onClose={() => setDamageItem(null)}>
          <p style={{ marginTop: 8, fontSize: 13, color: "var(--primary-60)" }}>
            This will deduct from both your kit and master inventory, and alert admin.
          </p>

          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => setDamageKind("damaged")}
              style={{
                flex: 1,
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                background: damageKind === "damaged" ? "var(--primary)" : "#fff",
                color: damageKind === "damaged" ? "#fff" : "var(--ink)",
                border: `1px solid ${damageKind === "damaged" ? "var(--primary)" : "var(--primary-15)"}`,
                cursor: "pointer",
              }}>
              Damaged
            </button>
            <button
              type="button"
              onClick={() => setDamageKind("lost")}
              style={{
                flex: 1,
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                background: damageKind === "lost" ? "var(--primary)" : "#fff",
                color: damageKind === "lost" ? "#fff" : "var(--ink)",
                border: `1px solid ${damageKind === "lost" ? "var(--primary)" : "var(--primary-15)"}`,
                cursor: "pointer",
              }}>
              Lost
            </button>
          </div>

          <label style={labelStyle}>
            Quantity (you have {damageItem.quantity})
          </label>
          <input
            type="number"
            min={1}
            max={damageItem.quantity}
            value={damageQty}
            onChange={(e) => setDamageQty(Math.max(1, Number(e.target.value)))}
            style={inputStyle}
          />

          <label style={labelStyle}>What happened? (optional)</label>
          <textarea
            value={damageReason}
            onChange={(e) => setDamageReason(e.target.value)}
            rows={3}
            placeholder="e.g. spray nozzle broke during job #2438"
            style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
          />

          {damageError && (
            <p style={{ marginTop: 12, fontSize: 13, color: "var(--error-text)" }}>{damageError}</p>
          )}

          <div style={{ marginTop: 20, display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="cl-action-btn" onClick={() => setDamageItem(null)}>
              Cancel
            </button>
            {/* Red stays here only: this is the genuinely destructive confirm
                (it writes stock off both the kit and master inventory). */}
            <button
              type="button"
              onClick={submitDamage}
              disabled={damageBusy}
              style={{
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 600,
                background: "#dc2626",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                cursor: damageBusy ? "not-allowed" : "pointer",
                opacity: damageBusy ? 0.6 : 1,
              }}>
              {damageBusy ? "Reporting..." : "Report"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
