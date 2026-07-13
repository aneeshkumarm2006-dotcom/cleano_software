"use client";

import { useState } from "react";
import {
  Calendar,
  ArrowUpRight,
  Star,
  Droplets,
  ExternalLink,
} from "lucide-react";
import WithdrawModal from "./WithdrawModal";
import PaymentHistory from "./PaymentHistory";
import ProviderInvoiceView from "./ProviderInvoiceView";

type PayPeriod = {
  startDate: string;
  endDate: string;
  status: string;
  paidAt: string | null;
};

type Payout = {
  id: string;
  baseAmount: number;
  adjustments: number;
  deductions: number;
  reimbursements: number;
  finalAmount: number;
  jobCount: number;
  totalHours: number;
  payPeriod: PayPeriod;
};

/** The pay period that CONTAINS today. `isLive` = payroll hasn't cut it yet. */
type CurrentPeriod = {
  startDate: string;
  endDate: string;
  status: string;
  isLive: boolean;
  baseAmount: number;
  adjustments: number;
  deductions: number;
  reimbursements: number;
  finalAmount: number;
  jobCount: number;
  totalHours: number;
};

type Withdrawal = {
  id: string;
  amount: number;
  status: string;
  paymentMethod: string | null;
  createdAt: string;
  processedAt: string | null;
  notes: string | null;
};

interface RagWashEntry {
  id: string;
  washDate: string;
  ragCount: number;
  notes: string | null;
}

interface RagData {
  allTimeRags: number;
  allTimeCredit: number;
  periodRags: number;
  periodCredit: number;
  creditRate: number;
  recentWashes: RagWashEntry[];
}

interface MyPayClientProps {
  payouts: Payout[];
  withdrawals: Withdrawal[];
  walletBalance: number;
  pendingAmount: number;
  unprocessedEarnings?: number;
  /** Paid + still-pending earnings for work performed this year. */
  earnedYTD: number;
  /** Net of PAID payouts for work performed this year. */
  paidYTD: number;
  grossYTD: number;
  deductionsYTD: number;
  adjustmentsYTD: number;
  reimbursementsYTD: number;
  hoursYTD: number;
  jobsCompletedYTD: number;
  availableBalance: number;
  currentPeriod: CurrentPeriod | null;
  year: number;
  starRating?: number | null;
  ragData?: RagData;
}

const STATUS_STYLES: Record<string, string> = {
  OPEN: "bg-amber-50 text-amber-700",
  DRAFT: "bg-gray-100 text-gray-700",
  APPROVED: "bg-blue-50 text-blue-700",
  PAID: "bg-green-50 text-green-700",
  CANCELLED: "bg-red-50 text-red-700",
};

const STATUS_LABELS: Record<string, string> = {
  OPEN: "IN PROGRESS",
  DRAFT: "DRAFT",
  APPROVED: "APPROVED",
  PAID: "PAID",
  CANCELLED: "CANCELLED",
};

type Tab = "current" | "history" | "income";

function formatDate(s: string) {
  return new Date(s).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function MyPayClient({
  payouts,
  withdrawals,
  walletBalance,
  pendingAmount,
  unprocessedEarnings = 0,
  earnedYTD,
  paidYTD,
  grossYTD,
  deductionsYTD,
  adjustmentsYTD,
  reimbursementsYTD,
  hoursYTD,
  jobsCompletedYTD,
  availableBalance,
  currentPeriod,
  year,
  starRating,
  ragData,
}: MyPayClientProps) {
  const [tab, setTab] = useState<Tab>("current");
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  // Convert withdrawals to history shape (Date objects)
  const historyPayouts = payouts.map((p) => ({
    id: p.id,
    finalAmount: p.finalAmount,
    payPeriod: {
      startDate: p.payPeriod.startDate,
      endDate: p.payPeriod.endDate,
      status: p.payPeriod.status,
      paidAt: p.payPeriod.paidAt,
    },
  }));

  // Income tiles — zero-value adjustment rows are hidden rather than shown as $0.00.
  const incomeTiles: Array<{
    label: string;
    value: string;
    hint?: string;
    tone?: "accent" | "neg";
    show: boolean;
  }> = [
    {
      label: `Earned ${year}`,
      value: `$${earnedYTD.toFixed(2)}`,
      hint: "Paid + still pending, for work done this year",
      show: true,
    },
    {
      label: `Paid ${year}`,
      value: `$${paidYTD.toFixed(2)}`,
      hint: "Net of paid pay periods",
      show: true,
    },
    {
      label: `Gross ${year}`,
      value: `$${grossYTD.toFixed(2)}`,
      hint: "Before adjustments and deductions",
      show: grossYTD > 0,
    },
    {
      label: "Adjustments",
      value: `$${adjustmentsYTD.toFixed(2)}`,
      tone: "accent",
      show: adjustmentsYTD !== 0,
    },
    {
      label: "Deductions",
      value: `-$${deductionsYTD.toFixed(2)}`,
      tone: "neg",
      show: deductionsYTD !== 0,
    },
    {
      label: "Reimbursements",
      value: `$${reimbursementsYTD.toFixed(2)}`,
      show: reimbursementsYTD !== 0,
    },
    {
      label: `Jobs completed ${year}`,
      value: String(jobsCompletedYTD),
      show: true,
    },
    {
      label: "Hours worked",
      value: `${hoursYTD.toFixed(1)}h`,
      show: hoursYTD > 0,
    },
  ];
  const visibleIncomeTiles = incomeTiles.filter((t) => t.show);

  return (
    <div className="cl-page-wrap">
      <div>
        <div className="cl-page-head">
          <div>
            <h1 className="cl-page-title">My pay</h1>
            <p className="cl-page-sub">Track your earnings and payment history.</p>
          </div>
        </div>

        {/* Star Rating (read-only) */}
        {starRating != null && (
          <div className="mb-4 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-3">
            <Star className="w-5 h-5 text-amber-400 fill-amber-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-[600] text-amber-800">
                Your Rating: {Math.min(5, Math.max(4, Math.round(starRating * 10) / 10)).toFixed(1)} / 5.0
              </p>
              <p className="text-xs text-amber-700/70">Based on customer feedback and performance</p>
            </div>
            <div className="flex gap-0.5 ml-auto">
              {[1, 2, 3, 4, 5].map((s) => (
                <Star
                  key={s}
                  className={`w-4 h-4 ${s <= Math.round(Math.min(5, Math.max(4, starRating))) ? "text-amber-400 fill-amber-400" : "text-amber-200 fill-amber-200"}`}
                />
              ))}
            </div>
          </div>
        )}

        <div className="cl-pay-hero">
          <div
            className={`cl-pay-tile featured${availableBalance > 0 ? " clickable" : ""}`}
            onClick={availableBalance > 0 ? () => setWithdrawOpen(true) : undefined}
            style={availableBalance > 0 ? { cursor: "pointer" } : undefined}>
            <div className="cl-pay-tile-head">
              <span>Wallet balance</span>
              <span>$</span>
            </div>
            <div className="cl-pay-tile-val">${walletBalance.toFixed(2)}</div>
            {availableBalance > 0 && (
              <div className="cl-pay-tile-cta">Tap to withdraw →</div>
            )}
          </div>
          <div className="cl-pay-tile">
            <div className="cl-pay-tile-head"><span>Pending</span></div>
            <div className="cl-pay-tile-val">${pendingAmount.toFixed(2)}</div>
            {unprocessedEarnings > 0 && (
              <div style={{ fontSize: 11, color: "rgba(0,140,156,0.55)", marginTop: 4 }}>
                incl. ${unprocessedEarnings.toFixed(2)} from completed jobs
              </div>
            )}
          </div>
          <div className="cl-pay-tile">
            <div className="cl-pay-tile-head"><span>Earned {year}</span></div>
            <div className="cl-pay-tile-val">${earnedYTD.toFixed(2)}</div>
          </div>
          <div className="cl-pay-tile">
            <div className="cl-pay-tile-head"><span>Hours {year}</span></div>
            <div className="cl-pay-tile-val">{hoursYTD.toFixed(1)}h</div>
          </div>
        </div>

        <div className="cl-pay-tabs">
          <button className={`cl-pay-tab ${tab === "current" ? "active" : ""}`} onClick={() => setTab("current")}>Current period</button>
          <button className={`cl-pay-tab ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}>Payment history</button>
          <button className={`cl-pay-tab ${tab === "income" ? "active" : ""}`} onClick={() => setTab("income")}>Income</button>
          <div className="cl-pay-tabs-spacer" />
          <button className="cl-pay-withdraw" onClick={() => setWithdrawOpen(true)}>
            <ArrowUpRight size={12} /> Withdraw
          </button>
        </div>

        {tab === "current" && (
          <>
            {currentPeriod ? (
              <div className="cl-block">
                <div className="cl-block-head">
                  <h2 className="cl-block-title">
                    <Calendar className="w-5 h-5" style={{ color: "var(--primary)" }} />
                    Current Pay Period
                  </h2>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-[500] ${STATUS_STYLES[currentPeriod.status] ?? STATUS_STYLES.DRAFT}`}>
                    {STATUS_LABELS[currentPeriod.status] ?? currentPeriod.status}
                  </span>
                </div>
                <p style={{ fontSize: 13, color: "var(--primary-60)", margin: 0 }}>
                  {formatDate(currentPeriod.startDate)} — {formatDate(currentPeriod.endDate)} · Mon–Sun
                </p>
                <div className="cl-block-stats">
                  <div>
                    <div className="cl-block-stat-label">
                      {currentPeriod.isLive ? "Earned so far" : "Base"}
                    </div>
                    <div className="cl-block-stat-val">${currentPeriod.baseAmount.toFixed(2)}</div>
                  </div>
                  {!currentPeriod.isLive && (
                    <>
                      <div>
                        <div className="cl-block-stat-label">Adjustments</div>
                        <div className="cl-block-stat-val" style={{ color: "#2563eb" }}>${currentPeriod.adjustments.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="cl-block-stat-label">Deductions</div>
                        <div className="cl-block-stat-val" style={{ color: "#dc2626" }}>-${currentPeriod.deductions.toFixed(2)}</div>
                      </div>
                    </>
                  )}
                  <div>
                    <div className="cl-block-stat-label">
                      {currentPeriod.isLive ? "Estimated total" : "Final"}
                    </div>
                    <div className="cl-block-stat-val pos">${currentPeriod.finalAmount.toFixed(2)}</div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: "var(--primary-60)", paddingTop: 4, borderTop: "1px solid rgba(0,140,156,0.07)" }}>
                  <span>{currentPeriod.jobCount} job{currentPeriod.jobCount === 1 ? "" : "s"}</span>
                  <span>·</span>
                  <span>{currentPeriod.totalHours.toFixed(1)} hours</span>
                  {currentPeriod.isLive && (
                    <>
                      <span>·</span>
                      <span>Estimate — this week closes Sunday</span>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="cl-empty-block" style={{ marginBottom: 14 }}>
                <div className="icon-bubble">
                  <Calendar size={28} />
                </div>
                <p style={{ margin: 0, color: "var(--ink-soft)" }}>No active pay period</p>
              </div>
            )}

            {/* Rag Wash & Credits */}
            {ragData && (
              <div className="cl-block">
                <div className="cl-block-head">
                  <h2 className="cl-block-title">
                    <Droplets className="w-5 h-5" style={{ color: "var(--primary)" }} />
                    Rag Wash Credits
                  </h2>
                  {/* Wash logging is admin-controlled — cleaners view credits only. */}
                </div>

                <div className="cl-block-stats">
                  <div>
                    <div className="cl-block-stat-label">Rags this period</div>
                    <div className="cl-block-stat-val">{ragData.periodRags}</div>
                  </div>
                  <div>
                    <div className="cl-block-stat-label">Credits this period</div>
                    <div className="cl-block-stat-val pos">+${ragData.periodCredit.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="cl-block-stat-label">All-time rags</div>
                    <div className="cl-block-stat-val">{ragData.allTimeRags}</div>
                  </div>
                  <div>
                    <div className="cl-block-stat-label">All-time credits</div>
                    <div className="cl-block-stat-val pos">+${ragData.allTimeCredit.toFixed(2)}</div>
                  </div>
                </div>

                {ragData.recentWashes.length > 0 ? (
                  <div style={{ borderTop: "1px solid rgba(0,140,156,0.07)", paddingTop: 12 }}>
                    <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--primary-50)", marginBottom: 8 }}>
                      Recent Washes
                    </p>
                    {ragData.recentWashes.map((w) => (
                      <div key={w.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}>
                        <span style={{ color: "var(--ink-soft)" }}>
                          {new Date(w.washDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          {w.notes ? ` · ${w.notes}` : ""}
                        </span>
                        <span style={{ color: "var(--primary-60)" }}>
                          {w.ragCount} rag{w.ragCount !== 1 ? "s" : ""} ·{" "}
                          <span style={{ color: "#059669", fontWeight: 600 }}>
                            +${(w.ragCount * ragData.creditRate).toFixed(2)}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ borderTop: "1px solid rgba(0,140,156,0.07)", paddingTop: 12, textAlign: "center" }}>
                    <p style={{ fontSize: 13, color: "var(--primary-50)" }}>
                      No washes logged yet. Your credits appear here once the
                      office records a wash.
                    </p>
                  </div>
                )}

                <div style={{ borderTop: "1px solid rgba(0,140,156,0.07)", paddingTop: 10, fontSize: 11, color: "var(--primary-50)" }}>
                  Rate: ${ragData.creditRate.toFixed(2)} per rag · Credits are added as adjustments by admin at period close
                </div>
              </div>
            )}

            <ProviderInvoiceView />
          </>
        )}

        {tab === "history" && (
          <PaymentHistory
            payouts={historyPayouts}
            withdrawals={withdrawals}
          />
        )}

        {tab === "income" && (
          <div className="cl-income-grid">
            {visibleIncomeTiles.map((t) => (
              <div className="cl-income-tile" key={t.label}>
                <div className="label">{t.label}</div>
                <div className={`val${t.tone ? ` ${t.tone}` : ""}`}>{t.value}</div>
                {t.hint && <div className="hint">{t.hint}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      <WithdrawModal
        isOpen={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        availableBalance={availableBalance}
      />
    </div>
  );
}
