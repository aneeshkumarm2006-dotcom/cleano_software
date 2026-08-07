"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { clockOut } from "@/app/admin/actions/clockOut";
import {
  CHECKLIST_GATE_HINT,
  pendingRequiredItems,
} from "@/lib/job-checklist";

type ProductCategory = "LIQUID_SPRAY" | "MOP_LIQUID" | "DISPOSABLE" | "OTHER";

interface EmployeeProduct {
  id: string;
  productId: string;
  quantity: number;
  product: {
    id: string;
    name: string;
    unit: string;
    category: ProductCategory;
  };
}

interface ClockOutButtonProps {
  jobId: string;
  employeeProducts: EmployeeProduct[];
  /**
   * The job's checklist, already generated server-side (item 12.a).
   *
   * This button had NO checklist gate at all while the clock screen's button
   * did — and this is the one rendered on the job detail page, so the "required
   * items block clock-out" rule was bypassable by using the more obvious of the
   * two buttons. Passed in rather than fetched: the page has already ensured it.
   */
  checklistItems?: { id: string; title: string; isRequired: boolean; status: string; notes: string | null }[];
}

// Per the Post-Job Inventory Usage spec.
const SPRAY_OPTIONS = [
  { label: "None", sprays: 0 },
  { label: "Light use", hint: "10–20 sprays", sprays: 15 },
  { label: "Medium use", hint: "20–40 sprays", sprays: 30 },
  { label: "Heavy use", hint: "40+ sprays", sprays: 50 },
];
const MOP_OPTIONS = [
  { label: "None", mops: 0 },
  { label: "1 mop", mops: 1 },
  { label: "2 mops", mops: 2 },
  { label: "3+ mops", mops: 3 },
];
const DISPOSABLE_OPTIONS = [0, 1, 2, 3];
const ML_PER_SPRAY = 1.25;

export default function ClockOutButton({
  jobId,
  employeeProducts,
  checklistItems = [],
}: ClockOutButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // category-keyed selections: productId → option index
  const [sprayPick, setSprayPick] = useState<Record<string, number>>({});
  const [mopPick, setMopPick] = useState<Record<string, number>>({});
  const [dispPick, setDispPick] = useState<Record<string, number>>({});
  // legacy "remaining" input for OTHER-category products
  const [remaining, setRemaining] = useState<Record<string, string>>({});

  const { sprays, mops, disposables, others } = useMemo(() => {
    return {
      sprays: employeeProducts.filter((ep) => ep.product.category === "LIQUID_SPRAY"),
      mops: employeeProducts.filter((ep) => ep.product.category === "MOP_LIQUID"),
      disposables: employeeProducts.filter((ep) => ep.product.category === "DISPOSABLE"),
      others: employeeProducts.filter((ep) => ep.product.category === "OTHER"),
    };
  }, [employeeProducts]);

  function handleOpen() {
    const sp: Record<string, number> = {};
    const mp: Record<string, number> = {};
    const dp: Record<string, number> = {};
    const rem: Record<string, string> = {};
    sprays.forEach((ep) => (sp[ep.productId] = 0));
    mops.forEach((ep) => (mp[ep.productId] = 0));
    disposables.forEach((ep) => (dp[ep.productId] = 0));
    others.forEach((ep) => (rem[ep.productId] = ep.quantity.toString()));
    setSprayPick(sp);
    setMopPick(mp);
    setDispPick(dp);
    setRemaining(rem);
    setError(null);
    setOpen(true);
  }

  async function handleConfirm() {
    setLoading(true);
    setError(null);
    try {
      const usage = {
        sprays: sprays.map((ep) => ({
          productId: ep.productId,
          sprayCount: SPRAY_OPTIONS[sprayPick[ep.productId] ?? 0].sprays,
        })),
        mops: mops.map((ep) => ({
          productId: ep.productId,
          mopCount: MOP_OPTIONS[mopPick[ep.productId] ?? 0].mops,
        })),
        disposables: disposables.map((ep) => ({
          productId: ep.productId,
          quantity: DISPOSABLE_OPTIONS[dispPick[ep.productId] ?? 0],
        })),
        remaining: others
          .map((ep) => ({
            productId: ep.productId,
            inventoryAfter: parseFloat(remaining[ep.productId] ?? "0"),
          }))
          .filter((r) => !isNaN(r.inventoryAfter)),
      };

      const result = await clockOut(jobId, usage);
      if (result.success) {
        setOpen(false);
      } else {
        setError(result.error || "Failed to clock out");
      }
    } catch {
      setError("Failed to clock out");
    } finally {
      setLoading(false);
    }
  }

  const hasAssignments =
    sprays.length + mops.length + disposables.length + others.length > 0;

  // The gate, from the same predicate the clock screen uses. An empty checklist
  // gates nothing, so jobs with no configured template are unaffected.
  const outstandingRequired = pendingRequiredItems(checklistItems);
  const gateBlocked = outstandingRequired.length > 0;

  const modal = open ? (
    <div className="co-overlay" onClick={() => !loading && setOpen(false)}>
      <div className="co-sheet" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="co-head">
          <div className="co-head-left">
            <span className="co-head-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </span>
            <div>
              <h2 className="co-title">Post-job inventory</h2>
              <p className="co-subtitle">Log what you used. Stock and restock alerts update automatically.</p>
            </div>
          </div>
          <button className="co-close" onClick={() => !loading && setOpen(false)} aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="co-body">
          {!hasAssignments ? (
            <div className="co-empty">
              <p>No products assigned to you. You can still close the job.</p>
            </div>
          ) : (
            <>
              {/* Liquid sprays */}
              {sprays.length > 0 && (
                <div className="pju-section">
                  <div className="pju-section-head">
                    <span className="pju-section-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 3h6v4l3 5v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-9l3-5z" />
                        <line x1="9" y1="7" x2="15" y2="7" />
                      </svg>
                    </span>
                    <div>
                      <h3>Liquid sprays</h3>
                      <p>How much did you spray?</p>
                    </div>
                  </div>
                  {sprays.map((ep) => {
                    const pick = sprayPick[ep.productId] ?? 0;
                    const sprayCount = SPRAY_OPTIONS[pick].sprays;
                    const mlDeducted = sprayCount * ML_PER_SPRAY;
                    return (
                      <div key={ep.productId} className="pju-card">
                        <div className="pju-card-head">
                          <span className="pju-card-name">{ep.product.name}</span>
                          <span className="pju-card-stock">
                            {ep.quantity.toFixed(1)} {ep.product.unit}
                          </span>
                        </div>
                        <div className="pju-pills">
                          {SPRAY_OPTIONS.map((opt, idx) => (
                            <button
                              key={idx}
                              type="button"
                              className={`pju-pill${pick === idx ? " selected" : ""}`}
                              onClick={() =>
                                setSprayPick((p) => ({ ...p, [ep.productId]: idx }))
                              }>
                              <span className="lbl">{opt.label}</span>
                              {opt.hint && <span className="hint">{opt.hint}</span>}
                            </button>
                          ))}
                        </div>
                        {mlDeducted > 0 && (
                          <div className="pju-card-foot">
                            Deducts {mlDeducted.toFixed(2)} ml ({sprayCount} sprays)
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Mop-based liquids */}
              {mops.length > 0 && (
                <div className="pju-section">
                  <div className="pju-section-head">
                    <span className="pju-section-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="3" x2="12" y2="14" />
                        <path d="M6 14h12l-2 7H8z" />
                      </svg>
                    </span>
                    <div>
                      <h3>Mop-based liquids</h3>
                      <p>How many mop uses?</p>
                    </div>
                  </div>
                  {mops.map((ep) => {
                    const pick = mopPick[ep.productId] ?? 0;
                    const mopCount = MOP_OPTIONS[pick].mops;
                    return (
                      <div key={ep.productId} className="pju-card">
                        <div className="pju-card-head">
                          <span className="pju-card-name">{ep.product.name}</span>
                          <span className="pju-card-stock">
                            {ep.quantity.toFixed(1)} {ep.product.unit}
                          </span>
                        </div>
                        <div className="pju-pills">
                          {MOP_OPTIONS.map((opt, idx) => (
                            <button
                              key={idx}
                              type="button"
                              className={`pju-pill${pick === idx ? " selected" : ""}`}
                              onClick={() =>
                                setMopPick((p) => ({ ...p, [ep.productId]: idx }))
                              }>
                              <span className="lbl">{opt.label}</span>
                            </button>
                          ))}
                        </div>
                        {mopCount > 0 && (
                          <div className="pju-card-foot">
                            Deducts {mopCount} mop use{mopCount === 1 ? "" : "s"}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Disposables */}
              {disposables.length > 0 && (
                <div className="pju-section">
                  <div className="pju-section-head">
                    <span className="pju-section-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                      </svg>
                    </span>
                    <div>
                      <h3>Disposables</h3>
                      <p>How many items did you use?</p>
                    </div>
                  </div>
                  <div className="pju-disp-grid">
                    {disposables.map((ep) => {
                      const pick = dispPick[ep.productId] ?? 0;
                      const used = DISPOSABLE_OPTIONS[pick];
                      return (
                        <div key={ep.productId} className="pju-disp-card">
                          <div className="pju-disp-icon">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                            </svg>
                          </div>
                          <div className="pju-disp-name">{ep.product.name}</div>
                          <div className="pju-disp-stock">
                            {ep.quantity.toFixed(0)} in stock
                          </div>
                          <div className="pju-disp-pills">
                            {DISPOSABLE_OPTIONS.map((opt, idx) => (
                              <button
                                key={idx}
                                type="button"
                                className={`pju-disp-pill${pick === idx ? " selected" : ""}`}
                                onClick={() =>
                                  setDispPick((p) => ({ ...p, [ep.productId]: idx }))
                                }>
                                {idx === 0 ? "0" : `+${opt}`}
                              </button>
                            ))}
                          </div>
                          {used > 0 && (
                            <div className="pju-disp-foot">−{used}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Other products — legacy "remaining" input */}
              {others.length > 0 && (
                <div className="pju-section">
                  <div className="pju-section-head">
                    <span className="pju-section-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                    </span>
                    <div>
                      <h3>Other</h3>
                      <p>How much do you have remaining?</p>
                    </div>
                  </div>
                  {others.map((ep) => (
                    <div key={ep.productId} className="pju-card">
                      <div className="pju-card-head">
                        <span className="pju-card-name">{ep.product.name}</span>
                        <span className="pju-card-stock">
                          Started with {ep.quantity} {ep.product.unit}
                        </span>
                      </div>
                      <input
                        className="co-input"
                        type="number"
                        step="0.01"
                        min="0"
                        max={ep.quantity}
                        value={remaining[ep.productId] ?? ""}
                        onChange={(e) =>
                          setRemaining((p) => ({ ...p, [ep.productId]: e.target.value }))
                        }
                        placeholder={`Remaining ${ep.product.unit}`}
                      />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {error && (
          <div style={{
            margin: "0 16px 12px",
            fontSize: 13,
            color: "#dc2626",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 10,
            padding: "10px 12px",
          }}>
            {error}
          </div>
        )}

        {/* Required checklist items still outstanding — the gate. Named, not
            just counted, so the cleaner knows what to go and do. */}
        {gateBlocked && (
          <div style={{
            margin: "0 0 12px",
            fontSize: 12.5,
            lineHeight: 1.5,
            color: "#b45309",
            background: "#fffbeb",
            border: "1px solid #fde68a",
            borderRadius: 10,
            padding: "10px 12px",
          }}>
            <strong>
              {outstandingRequired.length} required checklist item
              {outstandingRequired.length === 1 ? "" : "s"} still pending.
            </strong>{" "}
            Tick {outstandingRequired.length === 1 ? "it" : "them"} off on the job
            page before clocking out:{" "}
            {outstandingRequired.map((i) => i.title).join(", ")}.
          </div>
        )}

        {/* Footer */}
        <div className="co-footer">
          <button className="co-btn-ghost" onClick={() => !loading && setOpen(false)} disabled={loading}>
            Cancel
          </button>
          <button
            className="co-btn-confirm"
            onClick={handleConfirm}
            disabled={loading || gateBlocked}
            title={gateBlocked ? CHECKLIST_GATE_HINT : undefined}>
            {loading ? (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "co-spin 0.8s linear infinite" }}>
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                Submitting…
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Submit usage and close job
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button className="cl-jd-clock out" onClick={handleOpen}>
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
        Clock Out
      </button>
      {typeof window !== "undefined" && modal
        ? createPortal(modal, document.body)
        : null}
    </>
  );
}
