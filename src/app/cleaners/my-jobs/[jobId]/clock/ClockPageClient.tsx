"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clockIn } from "@/app/admin/actions/clockIn";
import { clockOut } from "@/app/admin/actions/clockOut";
import { createPortal } from "react-dom";
import { fmtClockTz, fmtShortTz } from "@/lib/time";
import { generateJobChecklist } from "@/app/admin/actions/generateJobChecklist";
import { getJobChecklist } from "@/app/admin/actions/getJobChecklist";
import { updateChecklistItem } from "@/app/admin/actions/updateChecklistItem";
import type { JobChecklistItemDTO } from "@/app/admin/actions/getJobChecklist.types";
import { markOnMyWay } from "../onMyWay";
import { getCoords } from "../OnMyWayButton";

type ProductCategory = "LIQUID_SPRAY" | "MOP_LIQUID" | "DISPOSABLE" | "OTHER";

interface InventoryRule { usagePerJob: number; refillThreshold: number; }
interface EmployeeProduct {
  id: string;
  productId: string;
  quantity: number;
  product: { id: string; name: string; unit: string; category: ProductCategory; inventoryRule?: InventoryRule | null; };
}

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

interface ClockPageClientProps {
  jobId: string;
  clientName: string;
  startTime: string | null;
  endTime: string | null;
  status: string;
  clockInTime: string | null;
  clockOutTime: string | null;
  onMyWayAt?: string | null;
  employeeProducts?: EmployeeProduct[];
}

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

const fmtClock = fmtClockTz;
const fmtShort = fmtShortTz;

function fmtDuration(ms: number) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function AnalogClock({ time }: { time: Date }) {
  const sec = time.getSeconds();
  const min = time.getMinutes() + sec / 60;
  const hr = (time.getHours() % 12) + min / 60;
  const secDeg = sec * 6;
  const minDeg = min * 6;
  const hourDeg = hr * 30;

  const ticks = Array.from({ length: 60 }, (_, i) => {
    const isHour = i % 5 === 0;
    const angle = i * 6;
    const inner = isHour ? 84 : 88;
    const rad = (angle * Math.PI) / 180;
    const sinA = Math.sin(rad);
    const cosA = Math.cos(rad);
    const r = (v: number) => Math.round(v * 1e4) / 1e4;
    return {
      x1: r(100 + sinA * inner),
      y1: r(100 - cosA * inner),
      x2: r(100 + sinA * 96),
      y2: r(100 - cosA * 96),
      isHour,
    };
  });

  const numerals = [
    { n: 12, x: 50, y: 13 },
    { n: 3, x: 87, y: 50 },
    { n: 6, x: 50, y: 88 },
    { n: 9, x: 13, y: 50 },
  ];

  return (
    <div className="clk-stage">
      <div className="clk-face">
        <svg className="clk-ticks" viewBox="0 0 200 200">
          {ticks.map((t, i) => (
            <line
              key={i}
              x1={t.x1}
              y1={t.y1}
              x2={t.x2}
              y2={t.y2}
              stroke={t.isHour ? "rgba(0,140,156, 0.5)" : "rgba(0,140,156, 0.2)"}
              strokeWidth={t.isHour ? 1.4 : 0.8}
              strokeLinecap="round"
            />
          ))}
        </svg>

        {numerals.map((n) => (
          <span
            key={n.n}
            className="clk-num"
            style={{ left: `${n.x}%`, top: `${n.y}%` }}
          >
            {n.n}
          </span>
        ))}

        <span
          className="clk-hand hour"
          style={{ transform: `translate(-50%, -100%) rotate(${hourDeg}deg)` }}
        />
        <span
          className="clk-hand minute"
          style={{ transform: `translate(-50%, -100%) rotate(${minDeg}deg)` }}
        />
        <span
          className="clk-hand second"
          style={{ transform: `translate(-50%, -100%) rotate(${secDeg}deg)` }}
        />
        <span className="clk-pivot" />
        <span className="clk-pivot-inner" />

        <div className="clk-readout">{fmtClock(time)}</div>
      </div>
    </div>
  );
}

export default function ClockPageClient({
  jobId,
  clientName,
  startTime,
  clockInTime,
  clockOutTime,
  onMyWayAt = null,
  employeeProducts = [],
}: ClockPageClientProps) {
  const router = useRouter();
  const [now, setNow] = useState(() => new Date());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otwSince, setOtwSince] = useState<string | null>(onMyWayAt);
  const [otwLoading, setOtwLoading] = useState(false);

  // Clock-out inventory modal state
  const [coOpen, setCoOpen] = useState(false);
  const [coLoading, setCoLoading] = useState(false);
  const [coError, setCoError] = useState<string | null>(null);
  const [sprayPick, setSprayPick] = useState<Record<string, number>>({});
  const [mopPick, setMopPick] = useState<Record<string, number>>({});
  const [dispPick, setDispPick] = useState<Record<string, number>>({});
  const [remaining, setRemaining] = useState<Record<string, string>>({});

  // Checklist state (wired into the clock-out modal)
  const [checklistItems, setChecklistItems] = useState<JobChecklistItemDTO[]>([]);
  const [checklistLoading, setChecklistLoading] = useState(false);
  const [checklistPending, setChecklistPending] = useState<string | null>(null);

  const { sprays, mops, disposables, others } = useMemo(() => ({
    sprays: employeeProducts.filter(ep => ep.product.category === "LIQUID_SPRAY"),
    mops: employeeProducts.filter(ep => ep.product.category === "MOP_LIQUID"),
    disposables: employeeProducts.filter(ep => ep.product.category === "DISPOSABLE"),
    others: employeeProducts.filter(ep => ep.product.category === "OTHER"),
  }), [employeeProducts]);

  async function openClockOut() {
    const sp: Record<string, number> = {};
    const mp: Record<string, number> = {};
    const dp: Record<string, number> = {};
    const rem: Record<string, string> = {};
    sprays.forEach(ep => (sp[ep.productId] = 0));
    mops.forEach(ep => (mp[ep.productId] = 0));
    disposables.forEach(ep => (dp[ep.productId] = 0));
    others.forEach(ep => (rem[ep.productId] = ep.quantity.toString()));
    setSprayPick(sp); setMopPick(mp); setDispPick(dp); setRemaining(rem);
    setCoError(null);
    setChecklistItems([]);
    setCoOpen(true);

    // Generate (idempotent) and fetch the job checklist
    setChecklistLoading(true);
    try {
      await generateJobChecklist(jobId);
      const res = await getJobChecklist(jobId);
      if (res.success && res.checklist) {
        setChecklistItems(res.checklist.items);
      }
    } catch {
      // non-fatal — checklist is optional
    }
    setChecklistLoading(false);
  }

  async function handleChecklistToggle(item: JobChecklistItemDTO) {
    if (checklistPending) return;
    const nextStatus = item.status === "COMPLETED" ? "PENDING" : "COMPLETED";
    setChecklistPending(item.id);
    setChecklistItems(prev =>
      prev.map(it => it.id === item.id ? { ...it, status: nextStatus as typeof item.status } : it)
    );
    await updateChecklistItem({ itemId: item.id, status: nextStatus as typeof item.status });
    setChecklistPending(null);
  }

  async function handleClockOut() {
    setCoLoading(true);
    setCoError(null);
    try {
      const usage = {
        sprays: sprays.map(ep => ({ productId: ep.productId, sprayCount: SPRAY_OPTIONS[sprayPick[ep.productId] ?? 0].sprays })),
        mops: mops.map(ep => ({ productId: ep.productId, mopCount: MOP_OPTIONS[mopPick[ep.productId] ?? 0].mops })),
        disposables: disposables.map(ep => ({ productId: ep.productId, quantity: DISPOSABLE_OPTIONS[dispPick[ep.productId] ?? 0] })),
        remaining: others.map(ep => ({ productId: ep.productId, inventoryAfter: parseFloat(remaining[ep.productId] ?? "0") })).filter(r => !isNaN(r.inventoryAfter)),
      };
      const result = await clockOut(jobId, usage);
      if (result.success) {
        setCoOpen(false);
        router.refresh();
      } else {
        setCoError(result.error || "Failed to clock out");
      }
    } catch {
      setCoError("Failed to clock out");
    } finally {
      setCoLoading(false);
    }
  }

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const isLive = !!clockInTime && !clockOutTime;
  const isDone = !!clockInTime && !!clockOutTime;

  const clockInDate = clockInTime ? new Date(clockInTime) : null;
  const clockOutDate = clockOutTime ? new Date(clockOutTime) : null;
  const startDate = startTime ? new Date(startTime) : null;

  const elapsedMs = isLive
    ? now.getTime() - clockInDate!.getTime()
    : isDone
    ? clockOutDate!.getTime() - clockInDate!.getTime()
    : 0;

  const earlyByMs = startDate ? startDate.getTime() - now.getTime() : 0;

  const initials = clientName
    .split(" ")
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  async function handleOnMyWay() {
    setOtwLoading(true);
    try {
      const coords = await getCoords();
      const res = await markOnMyWay(jobId, coords);
      if (res.success) {
        setOtwSince(res.onMyWayAt ?? new Date().toISOString());
        router.refresh();
      }
    } finally {
      setOtwLoading(false);
    }
  }

  async function handleClockIn() {
    setLoading(true);
    setError(null);
    try {
      const result = await clockIn(jobId);
      if (result.success) {
        router.refresh();
      } else {
        setError(result.error || "Failed to clock in");
      }
    } catch {
      setError("Failed to clock in");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="clk-shell">
      <header className="clk-top">
        <Link href={`/cleaners/my-jobs/${jobId}`} className="clk-back">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Back to job
        </Link>
        <div className="clk-job-pill">
          <span className="avatar">{initials}</span>
          <strong>{clientName}</strong>
        </div>
        <div className="clk-top-spacer" aria-hidden="true" />
      </header>

      <main className="clk-body">
        <div className={`clk-status${isLive ? " live" : ""}`}>
          <span className="dot" />
          {isLive && clockInDate
            ? `Clocked in · started ${fmtShort(clockInDate)}`
            : isDone
            ? "Shift complete"
            : startDate && earlyByMs > 0
            ? `Shift starts at ${fmtShort(startDate)}`
            : startDate
            ? `Running late by ${fmtDuration(Math.abs(earlyByMs))}`
            : "Ready to clock in"}
        </div>

        <AnalogClock time={now} />

        <div className="clk-panel">
          <h1 className="clk-greet">
            {isLive ? (
              <>You&apos;re <em>on the clock.</em></>
            ) : isDone ? (
              <>Great <em>work today!</em></>
            ) : (
              <>Ready to <em>clock in?</em></>
            )}
          </h1>
          <p className="clk-sub">
            {isLive
              ? "We're tracking your shift. Tap below when you're done."
              : isDone
              ? "Your shift has been logged. Head back to the job to view the summary."
              : "Tap the button when you arrive on site. Your shift starts the moment you clock in."}
          </p>

          {!isDone ? (
            isLive ? (
              <button
                className="clk-action out"
                onClick={openClockOut}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
                Clock out
              </button>
            ) : (
              <>
                {otwSince ? (
                  <div className="clk-otw-done">
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    On my way · since {fmtShort(new Date(otwSince))}
                  </div>
                ) : (
                  <button
                    className="clk-action otw"
                    onClick={handleOnMyWay}
                    disabled={otwLoading}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="3 11 22 2 13 21 11 13 3 11" />
                    </svg>
                    {otwLoading ? "Sharing…" : "On my way"}
                  </button>
                )}
                <button
                  className="clk-action"
                  onClick={handleClockIn}
                  disabled={loading}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  {loading ? "Clocking in…" : "Clock in"}
                </button>
              </>
            )
          ) : (
            <Link href={`/cleaners/my-jobs/${jobId}`} className="clk-action">
              View job summary
            </Link>
          )}
          {error && <p className="clk-error">{error}</p>}

          <div className="clk-meta">
            <div className="clk-meta-tile">
              <div className="lbl">Shift starts</div>
              <div className="val">{startDate ? fmtShort(startDate) : "—"}</div>
            </div>
            <div className="clk-meta-tile">
              <div className="lbl">{isLive ? "Worked so far" : "Time until start"}</div>
              <div className="val">
                {isLive
                  ? fmtDuration(elapsedMs)
                  : startDate && earlyByMs > 0
                  ? fmtDuration(earlyByMs)
                  : "—"}
              </div>
            </div>
            <div className="clk-meta-tile">
              <div className="lbl">Total today</div>
              <div className="val">{fmtDuration(elapsedMs)}</div>
            </div>
          </div>
        </div>

        <section className="clk-sessions">
          <div className="clk-sessions-head">
            <h3>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--primary)" }}>
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              Session log
            </h3>
            <span className="total">TOTAL · {fmtDuration(elapsedMs)}</span>
          </div>

          {isLive && clockInDate ? (
            <div className="clk-session-row active">
              <span className="clk-session-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              </span>
              <div className="clk-session-meta">
                <div className="clk-session-time">
                  {fmtClock(clockInDate)} → now <span className="live-dot" />
                </div>
                <div className="clk-session-date">
                  Live · started {clockInDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </div>
              </div>
              <div className="clk-session-dur" style={{ color: "var(--emerald-600)" }}>
                {fmtDuration(elapsedMs)}
              </div>
            </div>
          ) : isDone && clockInDate && clockOutDate ? (
            <div className="clk-session-row">
              <span className="clk-session-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
              <div className="clk-session-meta">
                <div className="clk-session-time">
                  {fmtClock(clockInDate)} → {fmtClock(clockOutDate)}
                </div>
                <div className="clk-session-date">
                  {clockInDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                </div>
              </div>
              <div className="clk-session-dur">{fmtDuration(elapsedMs)}</div>
            </div>
          ) : (
            <div className="clk-sessions-empty">No sessions logged yet. Tap Clock in to start.</div>
          )}
        </section>
      </main>

      {/* Clock-out inventory modal */}
      {coOpen && typeof window !== "undefined" && createPortal(
        <div className="co-overlay" onClick={() => !coLoading && setCoOpen(false)}>
          <div className="co-sheet" onClick={e => e.stopPropagation()}>
            <div className="co-head">
              <div className="co-head-left">
                <span className="co-head-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </span>
                <div>
                  <h2 className="co-title">Complete &amp; clock out</h2>
                  <p className="co-subtitle">Finish checklist and log inventory before clocking out.</p>
                </div>
              </div>
              <button className="co-close" onClick={() => !coLoading && setCoOpen(false)} aria-label="Close">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="co-body">
              {/* ── Checklist section ── */}
              {checklistLoading ? (
                <div style={{ padding: "16px 20px", fontSize: 13, color: "var(--primary-50)", display: "flex", alignItems: "center", gap: 8 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 1s linear infinite" }}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                  Preparing checklist…
                </div>
              ) : checklistItems.length > 0 ? (() => {
                const totalItems = checklistItems.length;
                const doneItems = checklistItems.filter(it => it.status === "COMPLETED").length;
                const pct = Math.round((doneItems / totalItems) * 100);
                const pendingRequired = checklistItems.filter(it => it.isRequired && it.status !== "COMPLETED");
                return (
                  <div className="pju-section" style={{ borderBottom: "1px solid rgba(0,140,156,0.08)", paddingBottom: 16 }}>
                    <div className="pju-section-head">
                      <span className="pju-section-icon">✓</span>
                      <div>
                        <h3>Job checklist</h3>
                        <p>{doneItems} of {totalItems} complete</p>
                      </div>
                      <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700, color: pct === 100 ? "#059669" : "var(--primary-60)" }}>
                        {pct}%
                      </span>
                    </div>
                    {/* Progress bar */}
                    <div style={{ height: 4, background: "rgba(0,140,156,0.08)", borderRadius: 2, margin: "0 0 14px", overflow: "hidden" }}>
                      <div style={{ height: "100%", background: pct === 100 ? "#059669" : "var(--primary)", borderRadius: 2, width: `${pct}%`, transition: "width 0.3s" }} />
                    </div>
                    {/* Items */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {checklistItems.map(item => {
                        const done = item.status === "COMPLETED";
                        const pending = checklistPending === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => !pending && handleChecklistToggle(item)}
                            disabled={pending}
                            style={{
                              display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px",
                              borderRadius: 10, border: done ? "1px solid rgba(5,150,105,0.2)" : "1px solid rgba(0,140,156,0.12)",
                              background: done ? "rgba(5,150,105,0.06)" : "rgba(0,140,156,0.03)",
                              cursor: pending ? "wait" : "pointer", textAlign: "left", width: "100%",
                              transition: "all 0.15s",
                            }}
                          >
                            <span style={{
                              width: 20, height: 20, borderRadius: 5, flexShrink: 0, marginTop: 1,
                              border: done ? "none" : "1.5px solid rgba(0,140,156,0.3)",
                              background: done ? "#059669" : "transparent",
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}>
                              {done && (
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              )}
                            </span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 500, color: done ? "rgba(0,140,156,0.5)" : "var(--ink)", textDecoration: done ? "line-through" : "none", lineHeight: 1.3 }}>
                                {item.title}
                                {item.isRequired && !done && (
                                  <span style={{ color: "#dc2626", marginLeft: 3, fontSize: 10, verticalAlign: "super" }}>*</span>
                                )}
                              </div>
                              {item.description && (
                                <div style={{ fontSize: 11, color: "var(--primary-50)", marginTop: 2 }}>{item.description}</div>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    {pendingRequired.length > 0 && (
                      <p style={{ fontSize: 11, color: "#dc2626", marginTop: 10, lineHeight: 1.4 }}>
                        {pendingRequired.length} required item{pendingRequired.length !== 1 ? "s" : ""} still pending. Complete them to clock out.
                      </p>
                    )}
                  </div>
                );
              })() : null}
              {sprays.length + mops.length + disposables.length + others.length === 0 ? (
                <div className="co-empty"><p>No products assigned. You can clock out now.</p></div>
              ) : (
                <>
                  {sprays.length > 0 && (
                    <div className="pju-section">
                      <div className="pju-section-head">
                        <span className="pju-section-icon">💧</span>
                        <div><h3>Liquid sprays</h3><p>How much did you spray?</p></div>
                      </div>
                      {sprays.map(ep => {
                        const pick = sprayPick[ep.productId] ?? 0;
                        const mlDeducted = SPRAY_OPTIONS[pick].sprays * ML_PER_SPRAY;
                        return (
                          <div key={ep.productId} className="pju-card">
                            <div className="pju-card-head">
                              <span className="pju-card-name">{ep.product.name}</span>
                              <span className="pju-card-stock">{ep.quantity.toFixed(1)} {ep.product.unit}</span>
                            </div>
                            <div className="pju-pills">
                              {SPRAY_OPTIONS.map((opt, idx) => (
                                <button key={idx} type="button" className={`pju-pill${pick === idx ? " selected" : ""}`} onClick={() => setSprayPick(p => ({ ...p, [ep.productId]: idx }))}>
                                  <span className="lbl">{opt.label}</span>
                                  {opt.hint && <span className="hint">{opt.hint}</span>}
                                </button>
                              ))}
                            </div>
                            {mlDeducted > 0 && <div className="pju-card-foot">Deducts {mlDeducted.toFixed(2)} ml</div>}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {mops.length > 0 && (
                    <div className="pju-section">
                      <div className="pju-section-head">
                        <span className="pju-section-icon">🧹</span>
                        <div><h3>Mop-based liquids</h3><p>How many mop uses?</p></div>
                      </div>
                      {mops.map(ep => {
                        const pick = mopPick[ep.productId] ?? 0;
                        return (
                          <div key={ep.productId} className="pju-card">
                            <div className="pju-card-head">
                              <span className="pju-card-name">{ep.product.name}</span>
                              <span className="pju-card-stock">{ep.quantity.toFixed(1)} {ep.product.unit}</span>
                            </div>
                            <div className="pju-pills">
                              {MOP_OPTIONS.map((opt, idx) => (
                                <button key={idx} type="button" className={`pju-pill${pick === idx ? " selected" : ""}`} onClick={() => setMopPick(p => ({ ...p, [ep.productId]: idx }))}>
                                  <span className="lbl">{opt.label}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {disposables.length > 0 && (
                    <div className="pju-section">
                      <div className="pju-section-head">
                        <span className="pju-section-icon">📦</span>
                        <div><h3>Disposables</h3><p>How many items did you use?</p></div>
                      </div>
                      <div className="pju-disp-grid">
                        {disposables.map(ep => {
                          const pick = dispPick[ep.productId] ?? 0;
                          return (
                            <div key={ep.productId} className="pju-disp-card">
                              <div className="pju-disp-name">{ep.product.name}</div>
                              <div className="pju-disp-stock">{ep.quantity.toFixed(0)} in stock</div>
                              <div className="pju-disp-pills">
                                {DISPOSABLE_OPTIONS.map((opt, idx) => (
                                  <button key={idx} type="button" className={`pju-disp-pill${pick === idx ? " selected" : ""}`} onClick={() => setDispPick(p => ({ ...p, [ep.productId]: idx }))}>
                                    {idx === 0 ? "0" : `+${opt}`}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {others.length > 0 && (
                    <div className="pju-section">
                      <div className="pju-section-head">
                        <span className="pju-section-icon">•••</span>
                        <div><h3>Other</h3><p>How much do you have remaining?</p></div>
                      </div>
                      {others.map(ep => (
                        <div key={ep.productId} className="pju-card">
                          <div className="pju-card-head">
                            <span className="pju-card-name">{ep.product.name}</span>
                            <span className="pju-card-stock">Started with {ep.quantity} {ep.product.unit}</span>
                          </div>
                          <input
                            className="co-input"
                            type="number"
                            step="0.01"
                            min="0"
                            max={ep.quantity}
                            value={remaining[ep.productId] ?? ""}
                            onChange={e => setRemaining(p => ({ ...p, [ep.productId]: e.target.value }))}
                            placeholder={`Remaining ${ep.product.unit}`}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {coError && (
              <div style={{ margin: "0 16px 12px", fontSize: 13, color: "#dc2626", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 12px" }}>
                {coError}
              </div>
            )}

            <div className="co-footer">
              <button className="co-btn-ghost" onClick={() => !coLoading && setCoOpen(false)} disabled={coLoading}>Cancel</button>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                {(() => {
                  const allRequiredDone = checklistItems.length === 0 || checklistItems.filter(it => it.isRequired).every(it => it.status === "COMPLETED");
                  return (
                    <>
                      <button className="co-btn-confirm" onClick={handleClockOut} disabled={coLoading || !allRequiredDone}>
                        {coLoading ? "Submitting…" : "Submit & clock out"}
                      </button>
                      {!allRequiredDone && (
                        <span style={{ fontSize: 11, color: "#dc2626", textAlign: "right" }}>
                          Complete all required checklist items first
                        </span>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
