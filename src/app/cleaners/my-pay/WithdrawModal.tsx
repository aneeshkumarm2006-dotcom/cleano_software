"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DollarSign, Clock, Info, CheckCircle2 } from "lucide-react";
import { requestWithdrawal } from "@/app/admin/actions/requestWithdrawal";

interface WithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
  availableBalance: number;
}

const PAYMENT_METHODS = [
  { value: "E_TRANSFER", label: "E-Transfer" },
  { value: "CASH", label: "Direct Deposit" },
  { value: "CHEQUE", label: "Cheque" },
];

const INSTANT_FEE_PCT = 0.05;

export default function WithdrawModal({
  isOpen,
  onClose,
  availableBalance,
}: WithdrawModalProps) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("E_TRANSFER");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const requestedAmt = parseFloat(amount) || 0;
  const feeAmt = Math.round(requestedAmt * INSTANT_FEE_PCT * 100) / 100;
  const netAmt = Math.max(0, Math.round((requestedAmt - feeAmt) * 100) / 100);

  function reset() {
    setAmount("");
    setPaymentMethod("E_TRANSFER");
    setNotes("");
    setError(null);
    setSuccess(false);
  }

  function handleClose() {
    if (submitting) return;
    reset();
    onClose();
  }

  async function handleSubmit() {
    setError(null);
    const num = parseFloat(amount);
    if (!Number.isFinite(num) || num <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    if (num > availableBalance + 0.001) {
      setError(`Amount exceeds available balance ($${availableBalance.toFixed(2)}).`);
      return;
    }

    setSubmitting(true);
    const result = await requestWithdrawal({
      amount: netAmt,
      paymentMethod: paymentMethod as "CASH" | "CHEQUE" | "E_TRANSFER" | "CREDIT_CARD" | "OTHER",
      notes: notes.trim() || undefined,
    });
    setSubmitting(false);

    if (result.success) {
      setSuccess(true);
      router.refresh();
    } else {
      setError(result.error || "Failed to submit withdrawal request.");
    }
  }

  if (!isOpen) return null;

  return (
    <div className="cl-modal-overlay" onClick={handleClose}>
      <div className="cl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cl-modal-head">
          <h2 className="cl-modal-title">
            {success ? "Request submitted" : "Request withdrawal"}
          </h2>
          <button className="cl-modal-close" onClick={handleClose} aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {success ? (
          <div style={{ textAlign: "center", padding: "16px 0 8px" }}>
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(5,150,105,0.10)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
              <CheckCircle2 className="w-7 h-7" style={{ color: "#059669" }} />
            </div>
            <p style={{ fontSize: 17, fontWeight: 600, color: "var(--ink)", marginBottom: 6 }}>
              Withdrawal request submitted
            </p>
            <p style={{ fontSize: 13, color: "var(--primary-60)", marginBottom: 24 }}>
              Sent out within 0–3 hours during working hours.
            </p>
            <div className="cl-modal-foot" style={{ justifyContent: "center", borderTop: "none", marginTop: 0, paddingTop: 0 }}>
              <button className="cl-modal-confirm" onClick={handleClose}>Close</button>
            </div>
          </div>
        ) : (
          <>
            {/* Timing banner */}
            <div className="cl-modal-banner">
              <Clock className="w-4 h-4 flex-shrink-0" />
              <span><strong>Sent out within 0–3 hours.</strong> Only available during working hours.</span>
            </div>

            {/* Available balance */}
            <div className="cl-modal-balance">
              <div>
                <div className="cl-modal-balance-meta">Available balance</div>
                <div className="cl-modal-balance-val">${availableBalance.toFixed(2)}</div>
              </div>
              <div className="cl-modal-balance-icon">
                <DollarSign className="w-5 h-5" />
              </div>
            </div>

            {/* Amount */}
            <div className="cl-modal-section">
              <label className="label">Amount</label>
              <input
                className="cl-modal-amount"
                type="number"
                step="0.01"
                min="0"
                max={availableBalance}
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <button
                type="button"
                className="cl-modal-fullbtn"
                onClick={() => setAmount(availableBalance.toFixed(2))}>
                Withdraw full balance
              </button>
            </div>

            {/* 5% fee breakdown */}
            {requestedAmt > 0 && (
              <div className="cl-modal-section">
                <div style={{ background: "var(--primary-5)", border: "1px solid var(--primary-10)", borderRadius: 12, padding: "12px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--primary-60)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
                    <Info className="w-3 h-3" />
                    Instant payout breakdown
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--primary-70)", marginBottom: 6 }}>
                    <span>Amount requested</span>
                    <span>${requestedAmt.toFixed(2)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--primary-70)", marginBottom: 8 }}>
                    <span>Processing fee (5%)</span>
                    <span style={{ color: "#dc2626" }}>-${feeAmt.toFixed(2)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 600, color: "var(--ink)", paddingTop: 8, borderTop: "1px solid var(--primary-10)" }}>
                    <span>You&apos;ll receive</span>
                    <span>${netAmt.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Payment method */}
            <div className="cl-modal-section">
              <label className="label">Payment method</label>
              <div className="cl-modal-methods">
                {PAYMENT_METHODS.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    className={`cl-modal-method${paymentMethod === m.value ? " active" : ""}`}
                    onClick={() => setPaymentMethod(m.value)}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div className="cl-modal-section">
              <label className="label">Notes (optional)</label>
              <textarea
                className="cl-modal-textarea"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any details for the admin..."
              />
            </div>

            {error && (
              <div style={{ padding: "12px 16px", borderRadius: 12, fontSize: 13, background: "#fee2e2", color: "#dc2626", marginBottom: 8 }}>
                {error}
              </div>
            )}

            <div className="cl-modal-foot">
              <button className="cl-modal-cancel" onClick={handleClose} disabled={submitting}>
                Cancel
              </button>
              <button
                className="cl-modal-confirm"
                onClick={handleSubmit}
                disabled={submitting || availableBalance <= 0}>
                {submitting
                  ? "Submitting..."
                  : requestedAmt > 0
                    ? `Receive $${netAmt.toFixed(2)}`
                    : "Confirm withdrawal"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
