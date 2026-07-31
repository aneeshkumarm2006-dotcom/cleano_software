"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Wallet, Check, X, Loader, AlertTriangle } from "lucide-react";
import type { PaymentType } from "@prisma/client";
import { processWithdrawal } from "../actions/processWithdrawal";

/**
 * Admin review queue for cleaner withdrawal requests (new fix list item 3).
 *
 * Cleaners submit an AMOUNT only; the payment method is picked here, at the
 * moment the payout is approved or marked paid. The four states the cleaner
 * sees — requested / approved / paid / rejected — are the stored
 * PENDING / APPROVED / COMPLETED / REJECTED enum, relabelled for humans.
 */

export type WithdrawalRow = {
  id: string;
  employeeName: string;
  employeeEmail: string | null;
  amount: number;
  status: "PENDING" | "APPROVED" | "REJECTED" | "COMPLETED";
  paymentMethod: string | null;
  notes: string | null;
  createdAt: string;
  processedAt: string | null;
};

const PAYMENT_METHODS: Array<{ value: PaymentType; label: string }> = [
  { value: "E_TRANSFER", label: "E-Transfer" },
  { value: "CASH", label: "Cash" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "CREDIT_CARD", label: "Card" },
  { value: "OTHER", label: "Other" },
];

const STATUS_PILL: Record<
  WithdrawalRow["status"],
  { bg: string; color: string; label: string }
> = {
  PENDING: { bg: "#fffbeb", color: "#d97706", label: "Requested" },
  APPROVED: { bg: "#eff6ff", color: "#1d4ed8", label: "Approved" },
  COMPLETED: { bg: "#dcfce7", color: "#15803d", label: "Paid" },
  REJECTED: { bg: "#fee2e2", color: "#b91c1c", label: "Rejected" },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function methodLabel(value: string | null) {
  if (!value) return null;
  return PAYMENT_METHODS.find((m) => m.value === value)?.label ?? value;
}

export default function WithdrawalsPanel({
  withdrawals,
}: {
  withdrawals: WithdrawalRow[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHandled, setShowHandled] = useState(false);
  // Per-row method choice, defaulted to whatever is already on the record.
  const [methods, setMethods] = useState<Record<string, string>>({});

  const open = useMemo(
    () => withdrawals.filter((w) => w.status === "PENDING" || w.status === "APPROVED"),
    [withdrawals]
  );
  const handled = useMemo(
    () => withdrawals.filter((w) => w.status === "COMPLETED" || w.status === "REJECTED"),
    [withdrawals]
  );
  const openTotal = open.reduce((s, w) => s + w.amount, 0);

  const methodFor = (w: WithdrawalRow): PaymentType =>
    (methods[w.id] ?? w.paymentMethod ?? "E_TRANSFER") as PaymentType;

  const run = async (
    w: WithdrawalRow,
    action: "APPROVE" | "REJECT" | "COMPLETE"
  ) => {
    setBusyId(w.id);
    setError(null);
    const result = await processWithdrawal(w.id, action, {
      // A rejection doesn't need a method; approving/paying records one.
      paymentMethod: action === "REJECT" ? undefined : methodFor(w),
    });
    setBusyId(null);
    if (!result.success) {
      setError(result.error ?? "Failed to process the withdrawal.");
      return;
    }
    router.refresh();
  };

  const rows = showHandled ? [...open, ...handled] : open;

  return (
    <div className="atable-wrap" style={{ overflow: "hidden", padding: 0 }}>
      <div
        style={{
          padding: "16px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          borderBottom: rows.length ? "1px solid var(--primary-10)" : "none",
        }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: "var(--primary-5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}>
            <Wallet size={18} style={{ color: "var(--primary)" }} />
          </div>
          <div>
            <div className="col-client">Withdrawal requests</div>
            <div style={{ fontSize: 12, color: "var(--primary-60)", marginTop: 4 }}>
              {open.length === 0
                ? "Nothing awaiting review"
                : `${open.length} open · $${openTotal.toFixed(2)}`}
            </div>
          </div>
        </div>
        {handled.length > 0 && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setShowHandled((v) => !v)}>
            {showHandled ? "Hide handled" : `Show handled (${handled.length})`}
          </button>
        )}
      </div>

      {error && (
        <div
          style={{
            background: "#fef2f2",
            borderBottom: "1px solid #fecaca",
            padding: "10px 20px",
            fontSize: 13,
            color: "#b91c1c",
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}>
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      {rows.length === 0 ? (
        <div
          style={{
            padding: "40px 20px",
            textAlign: "center",
            color: "var(--primary-60)",
            fontSize: 13,
          }}>
          No withdrawal requests to review.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {rows.map((w) => {
            const pill = STATUS_PILL[w.status];
            const isOpen = w.status === "PENDING" || w.status === "APPROVED";
            const busy = busyId === w.id;
            return (
              <div
                key={w.id}
                style={{
                  padding: "14px 20px",
                  borderTop: "1px solid var(--primary-10)",
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  flexWrap: "wrap",
                }}>
                <div style={{ minWidth: 200, flex: "1 1 220px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span className="col-client">{w.employeeName}</span>
                    <span
                      style={{
                        background: pill.bg,
                        color: pill.color,
                        fontSize: 10,
                        fontWeight: 700,
                        borderRadius: 20,
                        padding: "2px 8px",
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                      }}>
                      {pill.label}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--primary-60)", marginTop: 4 }}>
                    Requested {formatDate(w.createdAt)}
                    {w.processedAt ? ` · handled ${formatDate(w.processedAt)}` : ""}
                    {methodLabel(w.paymentMethod) ? ` · ${methodLabel(w.paymentMethod)}` : ""}
                    {w.notes ? ` · ${w.notes}` : ""}
                  </div>
                </div>

                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--primary)", minWidth: 90 }}>
                  ${w.amount.toFixed(2)}
                </div>

                {isOpen && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <select
                      className="input"
                      style={{ height: 36, width: 140 }}
                      value={methodFor(w)}
                      disabled={busy}
                      onChange={(e) =>
                        setMethods((m) => ({ ...m, [w.id]: e.target.value }))
                      }>
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                    {w.status === "PENDING" && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busy}
                        onClick={() => run(w, "APPROVE")}>
                        {busy ? <Loader size={14} className="animate-spin" /> : <Check size={14} />}
                        Approve
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() => run(w, "COMPLETE")}>
                      {busy ? <Loader size={14} className="animate-spin" /> : <Check size={14} />}
                      Mark paid
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ color: "#b91c1c" }}
                      disabled={busy}
                      onClick={() => run(w, "REJECT")}>
                      <X size={14} /> Reject
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
