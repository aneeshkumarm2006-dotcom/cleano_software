"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { claimWashPayout } from "../../actions/claimWashPayout";
import { Sparkles, Wallet, CheckCircle2, AlertTriangle, ArrowLeft } from "lucide-react";

type PayoutStatus = "PENDING" | "COMPLETED" | "FAILED";

interface WashEntry {
  id: string;
  washDate: string;
  ragCount: number;
  padCount: number;
  notes: string | null;
}

interface JobEntry {
  id: string;
  jobNumber: number;
  clientName: string;
  clockOutTime: string | null;
  bedCount: number | null;
  bathCount: number | null;
  jobType: string | null;
  projectedRags: number | null;
  projectedPads: number | null;
  cappedRags: number | null;
  cappedPads: number | null;
  actualRags: number | null;
  actualPads: number | null;
  flagged: boolean;
}

interface PayoutEntry {
  id: string;
  amount: number;
  ragCreditsUsed: number;
  padCreditsUsed: number;
  status: PayoutStatus;
  createdAt: string;
}

interface MyRagWashClientProps {
  employeeId: string;
  ragCredits: number;
  padCredits: number;
  payable: {
    ragUnits: number;
    padUnits: number;
    ragCreditsConsumed: number;
    padCreditsConsumed: number;
    amount: number;
  };
  thresholds: {
    rag: { credits: number; amount: number };
    pad: { credits: number; amount: number };
  };
  washes: WashEntry[];
  jobs: JobEntry[];
  payouts: PayoutEntry[];
  totalRags: number;
  totalPads: number;
  totalWashes: number;
  lastWashDate: string | null;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function MyRagWashClient({
  employeeId,
  ragCredits,
  padCredits,
  payable,
  thresholds,
  washes,
  jobs,
  payouts,
  totalRags,
  totalPads,
  totalWashes,
  lastWashDate,
}: MyRagWashClientProps) {
  const router = useRouter();
  const [claiming, startClaim] = useTransition();
  const [claimResult, setClaimResult] = useState<{ type: "success" | "error"; text: string } | null>(null);

  function handleClaim() {
    if (payable.amount <= 0) return;
    setClaimResult(null);
    startClaim(async () => {
      const res = await claimWashPayout();
      if ("success" in res && res.success) {
        setClaimResult({
          type: "success",
          text: `Claimed $${res.amount.toFixed(2)} — payout is processing.`,
        });
        router.refresh();
      } else {
        setClaimResult({
          type: "error",
          text: "error" in res ? res.error : "Failed to claim.",
        });
      }
    });
  }

  const ragProgress = Math.min(100, (ragCredits / thresholds.rag.credits) * 100);
  const padProgress = Math.min(100, (padCredits / thresholds.pad.credits) * 100);

  return (
    <div className="cl-page-wrap">
      <div className="cl-page-head">
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 4,
            minWidth: 0,
          }}>
          <a
            href="/my-inventory"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 600,
              color: "var(--primary-60)",
              textDecoration: "none",
            }}>
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to inventory
          </a>
          <h1 className="cl-page-title" style={{ margin: 0 }}>Wash earnings</h1>
          <p className="cl-page-sub" style={{ margin: 0 }}>
            Wash your own rags + pads and cash out as credits build up.
          </p>
        </div>
      </div>

      {/* Hero: ledger + claim */}
      <div className="cl-rw-hero">
        <div className="cl-rw-hero-main">
          <span className="greet-label">Your wash funds</span>
          <h2>
            ${payable.amount.toFixed(2)}{" "}
            <em>ready to claim.</em>
          </h2>
          <p className="desc">
            You earn credits automatically as completed jobs are projected.
            {thresholds.rag.credits} rag credits = ${thresholds.rag.amount.toFixed(2)} ·{" "}
            {thresholds.pad.credits} pad credits = ${thresholds.pad.amount.toFixed(2)}.
          </p>
          <button
            type="button"
            onClick={handleClaim}
            disabled={payable.amount <= 0 || claiming}
            className="cl-inv-hero-btn">
            <Wallet className="w-3.5 h-3.5" />
            {claiming ? "Claiming…" : payable.amount > 0 ? "Claim wash funds" : "No funds yet"}
          </button>
          {claimResult && (
            <p
              style={{
                marginTop: 12,
                fontSize: 12.5,
                color: claimResult.type === "success" ? "#34d399" : "#fca5a5",
              }}>
              {claimResult.text}
            </p>
          )}
        </div>

        <div className="cl-rw-meter">
          <div className="meter-head">
            <span>Rag credits</span>
            <strong>
              {ragCredits} / {thresholds.rag.credits}
            </strong>
          </div>
          <div className="meter-bar">
            <div className="meter-fill" style={{ width: `${ragProgress}%` }} />
          </div>
          <span className="meter-sub">
            +${thresholds.rag.amount.toFixed(2)} per {thresholds.rag.credits} credits
          </span>
        </div>

        <div className="cl-rw-meter">
          <div className="meter-head">
            <span>Pad credits</span>
            <strong>
              {padCredits} / {thresholds.pad.credits}
            </strong>
          </div>
          <div className="meter-bar">
            <div className="meter-fill" style={{ width: `${padProgress}%` }} />
          </div>
          <span className="meter-sub">
            +${thresholds.pad.amount.toFixed(2)} per {thresholds.pad.credits} credits
          </span>
        </div>
      </div>

      {/* Recent payouts */}
      <div className="cl-inv-section">
        <h2>
          Payouts <span className="count">{payouts.length}</span>
        </h2>
      </div>
      {payouts.length === 0 ? (
        <div className="cl-empty-block">
          <div className="icon-bubble">
            <Wallet className="w-7 h-7" />
          </div>
          <div>No payouts yet — your first claim will show up here.</div>
        </div>
      ) : (
        <div className="cl-rw-payout-list">
          {payouts.map((p) => (
            <article key={p.id} className="cl-rw-payout-row">
              <div className="cl-rw-payout-amount">${p.amount.toFixed(2)}</div>
              <div>
                <div className="cl-rw-payout-meta">{fmtDate(p.createdAt)}</div>
                <div className="cl-rw-payout-detail">
                  {p.ragCreditsUsed} rag · {p.padCreditsUsed} pad credits used
                </div>
              </div>
              <span
                className={`cl-rw-payout-status status-${p.status.toLowerCase()}`}>
                {p.status === "COMPLETED" ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : null}
                {p.status}
              </span>
            </article>
          ))}
        </div>
      )}

      {/* Projection log per job */}
      <div className="cl-inv-section" style={{ marginTop: 28 }}>
        <h2>
          Recent jobs <span className="count">{jobs.length}</span>
        </h2>
      </div>
      {jobs.length === 0 ? (
        <div className="cl-empty-block">
          <div className="icon-bubble">
            <Sparkles className="w-7 h-7" />
          </div>
          <div>No completed jobs yet. Credits unlock automatically as you finish jobs.</div>
        </div>
      ) : (
        <div className="cl-rw-jobs">
          {jobs.map((j) => (
            <article key={j.id} className="cl-rw-job-row">
              <div className="cl-rw-job-head">
                <div>
                  <div className="cl-rw-job-name">{j.clientName}</div>
                  <div className="cl-rw-job-sub">
                    Job #{j.jobNumber} · {fmtDate(j.clockOutTime)} ·{" "}
                    {(j.bedCount ?? 0)}br / {(j.bathCount ?? 0)}ba
                  </div>
                </div>
                {j.flagged && (
                  <span className="cl-rw-job-flag">
                    <AlertTriangle className="w-3 h-3" />
                    Over projection
                  </span>
                )}
              </div>
              <div className="cl-rw-job-stats">
                <div>
                  <span className="lbl">Projected</span>
                  <span className="val">
                    {j.projectedRags ?? 0} rags · {j.projectedPads ?? 0} pads
                  </span>
                </div>
                <div>
                  <span className="lbl">Awarded (capped)</span>
                  <span className="val">
                    {j.cappedRags ?? 0} rags · {j.cappedPads ?? 0} pads
                  </span>
                </div>
                {j.actualRags !== null && (
                  <div>
                    <span className="lbl">Actual</span>
                    <span className="val">
                      {j.actualRags} rags · {j.actualPads ?? 0} pads
                    </span>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Manual wash log */}
      <div className="cl-inv-section" style={{ marginTop: 28 }}>
        <h2>
          Wash log <span className="count">{totalWashes}</span>
        </h2>
      </div>
      <div className="cl-rw-summary">
        <div>
          <span className="lbl">Total rags washed</span>
          <span className="val">{totalRags}</span>
        </div>
        <div>
          <span className="lbl">Total pads washed</span>
          <span className="val">{totalPads}</span>
        </div>
        <div>
          <span className="lbl">Last entry</span>
          <span className="val">{fmtDate(lastWashDate)}</span>
        </div>
      </div>
      {washes.length > 0 ? (
        <div className="cl-rw-log">
          {washes.map((w) => (
            <div key={w.id} className="cl-rw-log-row">
              <div>
                <div className="cl-rw-log-date">{fmtDate(w.washDate)}</div>
                {w.notes && <div className="cl-rw-log-notes">{w.notes}</div>}
              </div>
              <div className="cl-rw-log-counts">
                <span>{w.ragCount} rag</span>
                <span>·</span>
                <span>{w.padCount} pad</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}

    </div>
  );
}
