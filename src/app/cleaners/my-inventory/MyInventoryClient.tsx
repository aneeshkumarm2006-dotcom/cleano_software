"use client";

import { useState, useTransition } from "react";
import { reportDamagedItem } from "@/app/admin/actions/reportDamagedItem";

interface InventoryItem {
  id: string;
  productId: string;
  productName: string;
  productDescription: string | null;
  unit: string;
  quantity: number;
  refillThreshold: number;
  usagePerJob: number;
  assignedAt: string;
  updatedAt: string;
  isLow: boolean;
  isOutOfStock: boolean;
}

interface Location {
  id: string;
  name: string;
  address: string | null;
}

// Per the rag-washing spec, supplies are pre-allocated per job + add-ons, so
// cleaners no longer request refills manually. Restocking is driven by the
// post-job inventory survey + admin warehouse flow.
interface MyInventoryClientProps {
  items: InventoryItem[];
  locations?: Location[];
}

export default function MyInventoryClient({
  items,
}: MyInventoryClientProps) {
  const needAttn = items.filter((i) => i.isLow || i.isOutOfStock).length;
  const totalUnits = items.reduce((s, i) => s + i.quantity, 0);

  const [damageItem, setDamageItem] = useState<InventoryItem | null>(null);
  const [damageQty, setDamageQty] = useState(1);
  const [damageReason, setDamageReason] = useState("");
  const [damageKind, setDamageKind] = useState<"damaged" | "lost">("damaged");
  const [damageError, setDamageError] = useState<string | null>(null);
  const [, startDamage] = useTransition();

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

  return (
    <div className="cl-page-wrap">
      <div className="cl-page-head">
        <div>
          <h1 className="cl-page-title">My inventory</h1>
          <p className="cl-page-sub">Equipment and supplies assigned to you.</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <a href="/cleaners/my-inventory/rag-wash" className="cl-action-btn">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3c-1 2-6 7-6 11a6 6 0 0 0 12 0c0-4-5-9-6-11z" /></svg>
            Log rag washes
          </a>
        </div>
      </div>

      {/* Hero */}
      <div className="cl-inv-hero">
        <div className="cl-inv-hero-main">
          <span className="greet-label">Your kit</span>
          <h2>{items.length} item{items.length === 1 ? "" : "s"} <em>in your bag.</em></h2>
          <p className="desc">
            {needAttn === 0
              ? "You're fully stocked. Nice work keeping the kit topped up."
              : `${needAttn} ${needAttn === 1 ? "item is" : "items are"} running low — pick up replacements from storage when you can.`}
          </p>
          <div className="cl-inv-hero-actions">
            <a href="/cleaners/my-inventory/checkout" className="cl-inv-hero-btn">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></svg>
              Pick up from storage
            </a>
          </div>
        </div>

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
          <div className="sub">{needAttn === 0 ? "All items stocked" : `${needAttn} below refill threshold`}</div>
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
      </div>

      {/* Section header */}
      <div className="cl-inv-section">
        <h2>
          Assigned items
          <span className="count">{items.length}</span>
        </h2>
      </div>

      <>
          {items.length === 0 ? (
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
                      </div>
                      {item.productDescription && (
                        <p className="ir-desc">{item.productDescription}</p>
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
                      <button
                        type="button"
                        onClick={() => openDamage(item)}
                        disabled={item.quantity <= 0}
                        style={{
                          marginTop: 8,
                          padding: "6px 12px",
                          fontSize: 12,
                          fontWeight: 600,
                          background: item.quantity > 0 ? "#fef2f2" : "var(--primary-5)",
                          color: item.quantity > 0 ? "#b91c1c" : "var(--primary-40)",
                          border: `1px solid ${item.quantity > 0 ? "#fecaca" : "var(--primary-10)"}`,
                          borderRadius: 6,
                          cursor: item.quantity > 0 ? "pointer" : "not-allowed",
                        }}>
                        Report damaged or lost
                      </button>
                    </div>

                  </article>
                );
              })}
            </div>
          )}
        </>

      {damageItem && (
        <div
          onClick={() => setDamageItem(null)}
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
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              Report {damageItem.productName}
            </h3>
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

            <label style={{ display: "block", marginTop: 16, fontSize: 12, fontWeight: 600, color: "var(--primary-70)" }}>
              Quantity (you have {damageItem.quantity})
            </label>
            <input
              type="number"
              min={1}
              max={damageItem.quantity}
              value={damageQty}
              onChange={(e) => setDamageQty(Math.max(1, Number(e.target.value)))}
              style={{
                marginTop: 4,
                width: "100%",
                padding: "8px 12px",
                fontSize: 14,
                border: "1px solid var(--primary-15)",
                borderRadius: 8,
              }}
            />

            <label style={{ display: "block", marginTop: 12, fontSize: 12, fontWeight: 600, color: "var(--primary-70)" }}>
              What happened? (optional)
            </label>
            <textarea
              value={damageReason}
              onChange={(e) => setDamageReason(e.target.value)}
              rows={3}
              placeholder="e.g. spray nozzle broke during job #2438"
              style={{
                marginTop: 4,
                width: "100%",
                padding: "8px 12px",
                fontSize: 14,
                border: "1px solid var(--primary-15)",
                borderRadius: 8,
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />

            {damageError && (
              <p style={{ marginTop: 12, fontSize: 13, color: "#dc2626" }}>{damageError}</p>
            )}

            <div style={{ marginTop: 20, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setDamageItem(null)}
                style={{
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  background: "#fff",
                  color: "var(--ink)",
                  border: "1px solid var(--primary-15)",
                  borderRadius: 8,
                  cursor: "pointer",
                }}>
                Cancel
              </button>
              <button
                type="button"
                onClick={submitDamage}
                style={{
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  background: "#dc2626",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                }}>
                Report
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
